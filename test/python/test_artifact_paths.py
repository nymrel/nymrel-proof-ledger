import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'python'))
from nymrel_proof_ledger.receipt import create_receipt, verify_receipt

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((ROOT / 'test/fixtures/artifact-path-cases.json').read_text(encoding='utf-8'))
LEGACY = json.loads((ROOT / 'test/fixtures/protocol-v2-vectors.json').read_text(encoding='utf-8'))['legacyV1']
AUTH = {'public_key_or_secret': 'path-fixture-secret', 'expected_algorithm': 'HMAC-SHA256'}


class TestArtifactPaths(unittest.TestCase):
    def test_in_root_filenames(self):
        for artifact_path in CASES['acceptedPaths']:
            with self.subTest(path=artifact_path), tempfile.TemporaryDirectory() as cwd:
                full_path = Path(cwd) / artifact_path
                full_path.parent.mkdir(parents=True, exist_ok=True)
                full_path.write_bytes(b'path fixture')
                receipt = create_receipt(
                    task={'name': 'Path fixture'}, signing_key=AUTH['public_key_or_secret'],
                    signer_identity='fixture', cwd=cwd, artifacts=[{'path': artifact_path}],
                )
                self.assertEqual(receipt['artifacts'][0]['path'], artifact_path)
                result = verify_receipt(receipt, **AUTH, check_files_on_disk=True, cwd=cwd)
                self.assertTrue(result['valid'], result['errors'])
                self.assertTrue(result['trusted'])
                self.assertTrue(result['artifactsValid'])
                self.assertEqual(result['checkedArtifacts'], 1)

    def test_boundary_paths_do_not_read(self):
        for artifact_path in CASES['rejectedPaths']:
            with self.subTest(path=artifact_path):
                # Frozen v1 signatures do not bind paths; isolate the disk guard.
                receipt = copy.deepcopy(LEGACY['receipt'])
                receipt['artifacts'][0]['path'] = artifact_path
                with patch('builtins.open', side_effect=AssertionError('Unexpected artifact read')) as read:
                    result = verify_receipt(
                        receipt, public_key_or_secret=LEGACY['secret'],
                        expected_algorithm='HMAC-SHA256', check_files_on_disk=True,
                    )
                    self.assertTrue(result['merkleValid'])
                    self.assertTrue(result['signatureValid'])
                    self.assertFalse(result['valid'])
                    self.assertFalse(result['trusted'])
                    self.assertFalse(result['artifactsValid'])
                    self.assertEqual(result['checkedArtifacts'], 0)
                    self.assertIn('escapes verification root', '; '.join(result['errors']))
                    read.assert_not_called()

    def test_dot_prefixed_directory_symlinks(self):
        for outside in (False, True):
            with self.subTest(outside=outside), tempfile.TemporaryDirectory() as directory:
                cwd = Path(directory) / 'root'
                target = Path(directory) / 'root-sibling' if outside else cwd / '..cache'
                target.mkdir(parents=True)
                cwd.mkdir(exist_ok=True)
                (target / 'artifact.txt').write_bytes(b'path fixture')
                alias = cwd / '..alias'
                if os.name == 'nt':
                    subprocess.run(
                        [os.environ.get('ComSpec', r'C:\Windows\System32\cmd.exe'), '/c', 'mklink', '/J', str(alias), str(target)],
                        check=True, capture_output=True,
                    )
                else:
                    alias.symlink_to(target, target_is_directory=True)
                receipt = create_receipt(
                    task={'name': 'Symlink fixture'}, signing_key=AUTH['public_key_or_secret'],
                    signer_identity='fixture', cwd=str(cwd),
                    artifacts=[{'path': '..alias/artifact.txt', 'data': 'path fixture'}],
                )
                with patch('builtins.open', wraps=open) as read:
                    result = verify_receipt(receipt, **AUTH, check_files_on_disk=True, cwd=str(cwd))
                    self.assertTrue(result['merkleValid'])
                    self.assertTrue(result['signatureValid'])
                    self.assertEqual(result['valid'], not outside, result['errors'])
                    self.assertEqual(result['trusted'], not outside)
                    self.assertEqual(result['artifactsValid'], not outside)
                    self.assertEqual(result['checkedArtifacts'], 0 if outside else 1)
                    self.assertEqual(read.call_count, 0 if outside else 1)

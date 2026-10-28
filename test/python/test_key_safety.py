import contextlib
import io
import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'python'))

from nymrel_proof_ledger.cli import main
from nymrel_proof_ledger.signer import ProofSigner

ALGORITHMS = ('HMAC-SHA256', 'Ed25519')


def run_cli(args):
    stdout = io.StringIO()
    stderr = io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        try:
            main(args)
        except SystemExit as error:
            code = error.code
        else:
            code = 0
    return code, stdout.getvalue(), stderr.getvalue()


class TestKeySafety(unittest.TestCase):
    def test_attest_requires_a_key_before_generating_keys_or_output_files(self):
        for algorithm in ALGORITHMS:
            with self.subTest(algorithm=algorithm), tempfile.TemporaryDirectory() as directory:
                outputs = [Path(directory) / name for name in ('proof.json', 'badge.svg', 'certificate.html')]
                with patch.object(ProofSigner, 'generate_secret_key') as secret, patch.object(ProofSigner, 'generate_key_pair') as pair:
                    code, stdout, stderr = run_cli([
                        'attest', '--task', 'Missing key', '--algo', algorithm,
                        '--files', str(Path(directory) / 'missing-artifact'),
                        '--out', str(outputs[0]), '--badge', str(outputs[1]), '--html', str(outputs[2]),
                    ])
                    self.assertNotEqual(code, 0)
                    self.assertEqual(stdout, '')
                    self.assertRegex(stderr, r'Signing key required.*--key.*--key-file')
                    self.assertNotIn('ephemeral', stderr.lower())
                    secret.assert_not_called()
                    pair.assert_not_called()
                for output in outputs:
                    self.assertFalse(output.exists())

    def test_explicit_keygen_exports_key_material_to_stdout(self):
        for algorithm in ALGORITHMS:
            with self.subTest(algorithm=algorithm):
                code, stdout, stderr = run_cli(['keygen', '--algo', algorithm])
                self.assertEqual(code, 0, stderr)
                self.assertEqual(stderr, '')
                key = json.loads(stdout)
                self.assertEqual(key['algorithm'], algorithm)
                self.assertRegex(key['privateKey' if algorithm == 'Ed25519' else 'secretKey'], r'^[0-9a-f]{64}$')
                if algorithm == 'Ed25519':
                    self.assertRegex(key['publicKey'], r'^[0-9a-f]{64}$')

    def test_keygen_file_does_not_log_private_material(self):
        for algorithm in ALGORITHMS:
            with self.subTest(algorithm=algorithm), tempfile.TemporaryDirectory() as directory:
                file = Path(directory) / 'key.json'
                code, stdout, stderr = run_cli(['keygen', '--algo', algorithm, '--out', str(file)])
                self.assertEqual(code, 0, stderr)
                key = json.loads(file.read_text(encoding='utf-8'))
                self.assertEqual(key['algorithm'], algorithm)
                secret = key['privateKey' if algorithm == 'Ed25519' else 'secretKey']
                self.assertRegex(secret, r'^[0-9a-f]{64}$')
                self.assertNotIn(secret, stdout)
                self.assertEqual(stderr, '')

    def test_keygen_refuses_to_replace_an_existing_key_file(self):
        for algorithm in ALGORITHMS:
            with self.subTest(algorithm=algorithm), tempfile.TemporaryDirectory() as directory:
                file = Path(directory) / 'existing.key'
                file.write_text('keep this key', encoding='utf-8')
                file.chmod(0o644)
                original_mode = file.stat().st_mode
                code, stdout, _ = run_cli(['keygen', '--algo', algorithm, '--out', str(file)])
                self.assertNotEqual(code, 0)
                self.assertEqual(stdout, '')
                self.assertEqual(file.read_text(encoding='utf-8'), 'keep this key')
                self.assertEqual(file.stat().st_mode, original_mode)

    @unittest.skipIf(os.name == 'nt', 'Creating symlinks requires separate Windows privileges')
    def test_keygen_refuses_existing_and_dangling_symlinks(self):
        for algorithm in ALGORITHMS:
            for dangling in (False, True):
                with self.subTest(algorithm=algorithm, dangling=dangling), tempfile.TemporaryDirectory() as directory:
                    target = Path(directory) / 'target.key'
                    link = Path(directory) / 'link.key'
                    if not dangling:
                        target.write_text('keep target key', encoding='utf-8')
                    link.symlink_to(target)
                    code, stdout, _ = run_cli(['keygen', '--algo', algorithm, '--out', str(link)])
                    self.assertNotEqual(code, 0)
                    self.assertEqual(stdout, '')
                    self.assertTrue(link.is_symlink())
                    if dangling:
                        self.assertFalse(target.exists())
                    else:
                        self.assertEqual(target.read_text(encoding='utf-8'), 'keep target key')

    @unittest.skipUnless(os.name == 'posix', 'POSIX permission semantics')
    def test_keygen_output_stays_owner_only_under_a_permissive_umask(self):
        for algorithm in ALGORITHMS:
            with self.subTest(algorithm=algorithm), tempfile.TemporaryDirectory() as directory:
                file = Path(directory) / 'key.json'
                original_umask = os.umask(0)
                try:
                    code, _, stderr = run_cli(['keygen', '--algo', algorithm, '--out', str(file)])
                    self.assertEqual(code, 0, stderr)
                    self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o600)
                finally:
                    os.umask(original_umask)

    def test_keygen_rejects_unsupported_or_incomplete_flags_without_exporting_a_key(self):
        for args in (['--algo', 'RSA'], ['--algo'], ['--algo', ''], ['--out'], ['--out', '']):
            with self.subTest(args=args):
                code, stdout, stderr = run_cli(['keygen', *args])
                self.assertNotEqual(code, 0)
                self.assertEqual(stdout, '')
                self.assertTrue(stderr)

    def test_equals_form_keygen_flags_save_the_selected_ed25519_key_to_a_file(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'key.json'
            code, stdout, stderr = run_cli(['keygen', '--algo=Ed25519', f'--out={file}'])
            self.assertEqual(code, 0, stderr)
            key = json.loads(file.read_text(encoding='utf-8'))
            self.assertEqual(key['algorithm'], 'Ed25519')
            self.assertRegex(key['privateKey'], r'^[0-9a-f]{64}$')
            self.assertNotIn(key['privateKey'], stdout)
            self.assertEqual(stderr, '')
            if os.name == 'posix':
                self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o600)

    def test_misspelled_keygen_flags_do_not_export_secrets_or_create_an_output_file(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'key.json'
            for args in (['--output', str(file)], ['--algoo', 'Ed25519'], ['-out', str(file)]):
                with self.subTest(args=args):
                    code, stdout, stderr = run_cli(['keygen', *args])
                    self.assertNotEqual(code, 0)
                    self.assertEqual(stdout, '')
                    self.assertTrue(stderr)
                    self.assertFalse(file.exists())

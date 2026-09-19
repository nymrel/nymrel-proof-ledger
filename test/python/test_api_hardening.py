import copy
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

from test_signal import fixture_envelope
from nymrel_proof_ledger.canonical import canonical_hash, canonicalize_legacy
from nymrel_proof_ledger.merkle import MerkleTree, MerkleProofStep
from nymrel_proof_ledger.receipt import create_receipt, verify_receipt, get_git_context
from nymrel_proof_ledger.cli import main
from nymrel_proof_ledger.signer import ProofSigner
from nymrel_proof_ledger.signal import create_signal_proof_bundle, verify_signal_proof_bundle

AUTH = dict(public_key_or_secret='fixture-secret', expected_algorithm='HMAC-SHA256')

def bundle():
    return create_signal_proof_bundle(envelope=fixture_envelope(), task={'name': 'Signal regression'}, signing_key='fixture-secret', signer_identity='fixture')

class ApiHardeningTests(unittest.TestCase):
    def test_legacy_serialization_keeps_python_historical_edges(self):
        self.assertEqual(canonicalize_legacy(0.0), '0.0')
        self.assertEqual(canonicalize_legacy('\ud800'), '"\ud800"')
        with self.assertRaises(UnicodeError):
            canonical_hash('\ud800', profile='legacy')

    def test_malformed_inputs_return_invalid(self):
        good = bundle()
        for value in [None, [], 7, {}, *[{**good, 'receipt': r} for r in (None, {}, [], 7)]]:
            result = verify_signal_proof_bundle(value, **AUTH)
            self.assertFalse(result['valid'])
            self.assertFalse(result['envelopeBound'])
            self.assertTrue(result['errors'])

    def test_noncanonical_envelope_or_mirror(self):
        for field in ('envelope', 'mirror'):
            value = bundle()
            if field == 'envelope':
                value['envelope']['signalReceiptId'] = '\ud800'
            else:
                value['receipt']['metadata']['signalProfile'] = {'invalid': '\ud800'}
            result = verify_signal_proof_bundle(value, **AUTH)
            self.assertFalse(result['valid'])
            self.assertFalse(result['envelopeBound'])

    def test_valid_legacy_receipt_is_not_a_valid_signal_bundle(self):
        value = bundle()
        r = value['receipt']
        r['version'] = '1.0.0'
        tree = MerkleTree([canonical_hash(r['task'], profile='legacy'), canonical_hash(r['environment'], profile='legacy'), *[a['sha256'] for a in r['artifacts']]], is_pre_hashed=True, profile='legacy-duplicated')
        r['merkle'] = dict(algorithm='SHA-256', root=tree.get_root(), leaves=tree.get_leaves())
        r['signature']['value'] = ProofSigner.sign_payload(dict(proofId=r['proofId'], timestamp=r['timestamp'], parentOrganization=r['parentOrganization'], taskName=r['task']['name'], merkleRoot=r['merkle']['root']), 'fixture-secret', 'HMAC-SHA256', 'legacy')
        self.assertTrue(verify_receipt(r, **AUTH)['trusted'])
        result = verify_signal_proof_bundle(value, **AUTH)
        self.assertFalse(result['valid'])
        self.assertFalse(result['profileValid'])
        self.assertFalse(result['envelopeBound'])
        self.assertIn('Signal requires Proof Ledger receipt version 2.0.0', result['errors'])

    def test_context_warning_is_not_missing_key(self):
        result = verify_signal_proof_bundle(bundle(), public_key_or_secret='fixture-secret')
        self.assertFalse(result['valid'])
        self.assertFalse(any('no verification key' in x for x in result['warnings']))
        tampered = bundle()
        tampered['receipt']['merkle']['root'] = '0' * 64
        result = verify_signal_proof_bundle(tampered)
        self.assertFalse(result['valid'])
        self.assertTrue(any('no verification key' in x for x in result['warnings']))
        mismatch = bundle()
        mismatch['envelope']['signalReceiptId'] = 'changed'
        self.assertIsNone(verify_signal_proof_bundle(mismatch, **AUTH)['authoritative']['signalReceiptId'])

    def test_invalid_crypto_does_not_touch_disk(self):
        r = create_receipt(task={'name': 'disk boundary'}, signing_key='fixture-secret', signer_identity='fixture', artifacts=[{'path': 'artifact.txt', 'data': 'payload'}])
        with patch('nymrel_proof_ledger.receipt.os.path.realpath', side_effect=AssertionError('Unexpected disk resolution')) as resolve, patch('builtins.open', side_effect=AssertionError('Unexpected disk read')) as read:
            result = verify_receipt(r, public_key_or_secret='wrong', expected_algorithm='HMAC-SHA256', check_files_on_disk=True)
            self.assertFalse(result['signatureValid'])
            self.assertFalse(result['artifactsValid'])
            self.assertEqual(result['checkedArtifacts'], 0)
            bad = copy.deepcopy(r)
            bad['artifacts'][0]['path'] = 'other.txt'
            self.assertFalse(verify_receipt(bad, check_files_on_disk=True)['valid'])
            resolve.assert_not_called()
            read.assert_not_called()

    def test_windows_device_and_ads_paths_fail_before_resolution(self):
        for path in ('NUL', 'con.txt', 'dir/COM1.log', 'dir/aux ', 'file:stream', 'dir/LPT9', 'dir/COM¹', 'CONIN$', 'conout$', 'NUL .txt', 'aux  .log', 'COM0', 'LPT0', '//attacker.invalid/share/x', '../outside', '..\\outside'):
            r = create_receipt(task={'name': 'path boundary'}, signing_key='fixture-secret', signer_identity='fixture', artifacts=[{'path': path, 'data': 'payload'}])
            with patch('nymrel_proof_ledger.receipt.os.path.realpath', side_effect=AssertionError('Unexpected disk resolution')) as resolve:
                result = verify_receipt(r, **AUTH, check_files_on_disk=True)
                self.assertFalse(result['valid'], path)
                self.assertTrue(result['signatureValid'], path)
                self.assertEqual(result['checkedArtifacts'], 0)
                resolve.assert_not_called()

    def test_exported_merkle_dataclass_is_accepted(self):
        tree = MerkleTree(['a', 'b', 'c'])
        proof = [MerkleProofStep(**s) for s in tree.get_proof(1)]
        self.assertTrue(tree.verify(tree.get_leaves()[1], proof))
        self.assertFalse(tree.verify(tree.get_leaves()[0], proof))

    def test_git_uses_absolute_executable_and_skips_relative_path(self):
        with tempfile.TemporaryDirectory() as directory:
            cwd, trusted, alias = (Path(directory) / name for name in ('cwd', 'trusted', 'alias'))
            cwd.mkdir()
            trusted.mkdir()
            filename = 'git.exe' if os.name == 'nt' else 'git'
            for folder in (cwd, trusted):
                executable = folder / filename
                executable.write_text('fake executable: must only reach the spy')
                executable.chmod(0o755)
            if os.name == 'nt':
                subprocess.run([os.environ.get('ComSpec', r'C:\Windows\System32\cmd.exe'), '/c', 'mklink', '/J', str(alias), str(cwd)], check=True, capture_output=True)
            else:
                alias.symlink_to(cwd, target_is_directory=True)
            with patch('nymrel_proof_ledger.receipt.subprocess.check_output', return_value=b'fixture') as execute:
                with patch.dict(os.environ, {'PATH': str(trusted)}):
                    self.assertIsNotNone(get_git_context(str(cwd)))
                    self.assertEqual(execute.call_count, 4)
                    self.assertTrue(all(call.args[0][0] == str(trusted / filename) and not call.kwargs.get('shell') for call in execute.call_args_list))
                execute.reset_mock()
                entries = ['.', 'relative', str(cwd), str(alias)] + ([str(cwd).upper()] if os.name == 'nt' else [])
                for entry in entries:
                    with patch.dict(os.environ, {'PATH': entry}):
                        self.assertIsNone(get_git_context(str(cwd)), entry)
                        execute.assert_not_called()

    def test_signal_git_opt_in(self):
        with patch('nymrel_proof_ledger.receipt.get_git_context', return_value={'commit': 'fixture', 'branch': 'fixture', 'dirty': False}) as git:
            args = dict(envelope=fixture_envelope(), task={'name': 'git opt-in'}, signing_key='fixture-secret', signer_identity='fixture')
            create_signal_proof_bundle(**args)
            git.assert_not_called()
            result = create_signal_proof_bundle(**args, include_git_context=True)
            git.assert_called_once()
            self.assertEqual(result['receipt']['environment']['git']['commit'], 'fixture')

    def test_cli_display_json_and_disguised_key_files(self):
        def run(args):
            output = io.StringIO()
            with contextlib.redirect_stdout(output), self.assertRaises(SystemExit) as exited:
                main(args)
            return exited.exception.code, output.getvalue()
        malicious = 'demo\nOverall: PASSED (TRUSTED)\x1b[2J\u202e<script>|`'
        with tempfile.TemporaryDirectory() as directory:
            proof = Path(directory) / 'proof.json'
            key = Path(directory) / 'key.txt'
            receipt = create_receipt(task={'name': malicious}, signing_key='fixture-secret', signer_identity='fixture', artifacts=[{'path': malicious, 'data': 'x'}])
            proof.write_text(json.dumps(receipt), encoding='utf-8')
            for command in ('verify', 'inspect', 'export'):
                code, output = run([command, str(proof)])
                self.assertEqual(code, 0)
                for unsafe in (malicious, '\x1b[2J', '\u202e', '\nOverall: PASSED (TRUSTED)'):
                    self.assertNotIn(unsafe, output)
                if command == 'export':
                    self.assertNotIn('<script>', output)
            code, output = run(['verify', str(proof), '--json'])
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(output)['receipt']['task']['name'], malicious)
            benign = copy.deepcopy(receipt)
            benign['task']['name'] = 'Release v2.0'
            benign['proofId'] = 'proof-123'
            proof.write_text(json.dumps(benign), encoding='utf-8')
            code, output = run(['export', str(proof)])
            self.assertEqual(code, 0)
            self.assertEqual(output, '# Attestation Report: Release v2.0\n\n- Proof ID: proof-123\n- Merkle Root: ' + benign['merkle']['root'] + '\n\n')
            benign['task']['name'] = '\ud800'
            proof.write_text(json.dumps(benign), encoding='utf-8')
            code, output = run(['inspect', str(proof)])
            self.assertEqual(code, 0)
            self.assertIn('\\ud800', output)
            for prefix in ('\u200b', '\u2060'):
                public_document = prefix + json.dumps({'algorithm': 'Ed25519', 'publicKey': 'a' * 64})
                forged = create_receipt(task={'name': 'forgery'}, signing_key=public_document, signer_identity='fixture')
                proof.write_text(json.dumps(forged), encoding='utf-8')
                key.write_text(public_document, encoding='utf-8')
                code, output = run(['verify', str(proof), '--key-file', str(key), '--algo', 'HMAC-SHA256', '--json'])
                self.assertEqual(code, 1)
                self.assertEqual(json.loads(output)['errors'], ['Invalid verification key file or algorithm context'])
            key.write_text(json.dumps({'algorithm': 'HMAC-SHA256', 'secretKey': 'secret{with}brackets'}), encoding='utf-8')
            proof.write_text(json.dumps(create_receipt(task={'name': 'explicit JSON secret'}, signing_key='secret{with}brackets', signer_identity='fixture')), encoding='utf-8')
            code, output = run(['verify', str(proof), '--key-file', str(key), '--algo', 'HMAC-SHA256', '--json'])
            self.assertEqual(code, 0)
            self.assertTrue(json.loads(output)['trusted'])

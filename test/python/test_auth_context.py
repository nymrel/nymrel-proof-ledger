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
from nymrel_proof_ledger import verify_proof
from nymrel_proof_ledger.receipt import create_receipt, verify_receipt
from nymrel_proof_ledger.envelope import validate_receipt_envelope

ROOT = Path(__file__).resolve().parents[2]
VECTORS = json.loads((ROOT / 'test/fixtures/protocol-v2-vectors.json').read_text(encoding='utf-8'))
CASES = json.loads((ROOT / 'test/fixtures/auth-context-cases.json').read_text(encoding='utf-8'))


def input_for(row):
    receipt = None if 'receipt' in row and row['receipt'] is None else copy.deepcopy(VECTORS[row.get('vector', 'protocolV2')]['receipt'])
    for operation in row.get('operations', []):
        target = receipt
        for part in operation['path'][:-1]:
            target = target[part]
        key = operation['path'][-1]
        if operation.get('remove'):
            del target[key]
        else:
            target[key] = operation['value']
    return receipt


def options_for(options):
    return { {'publicKeyOrSecret': 'public_key_or_secret', 'expectedAlgorithm': 'expected_algorithm'}[key]: value for key, value in options.items() }


class TestAuthenticationContext(unittest.TestCase):
    def test_shared_cases(self):
        for row in CASES:
            with self.subTest(row=row['name']):
                result = verify_receipt(input_for(row), **options_for(row.get('options', {})))
                self.assertEqual(result['valid'], row['valid'], result['errors'])
                self.assertEqual(result['trusted'], row['trusted'])
                if row.get('warning'):
                    self.assertIn(row['warning'], result['warnings'])

    def test_forged_hmac_under_public_key(self):
        public = VECTORS['ed25519']['publicKey']
        forged = create_receipt(task={'name': 'attacker claim'}, signing_key=public, signer_identity='victim')
        for verify in (verify_receipt, verify_proof):
            for options in ({'public_key_or_secret': public, 'expected_algorithm': 'Ed25519'}, {'public_key_or_secret': public}):
                result = verify(forged, **options)
                self.assertFalse(result['valid'])
                self.assertFalse(result['trusted'])

    def test_git_context_opt_in(self):
        with patch('nymrel_proof_ledger.receipt.get_git_context', return_value={'commit': 'test', 'branch': 'test', 'dirty': False}) as git:
            args = dict(task={'name': 'no Git'}, signing_key='test-secret', signer_identity='test')
            receipt = create_receipt(**args)
            git.assert_not_called()
            self.assertNotIn('git', receipt['environment'])
            self.assertIn('git', create_receipt(**args, include_git_context=True)['environment'])
            git.assert_called_once()

    def test_cli_requires_algorithm(self):
        env = {**os.environ, 'PYTHONPATH': str(ROOT / 'python')}
        base = [sys.executable, '-m', 'nymrel_proof_ledger.cli', 'verify', 'test/fixtures/auth-context-cli-receipt.json', '--key', VECTORS['protocolV2']['secret'], '--json']
        for suffix, expected in [([], 1), (['--algo', 'HMAC-SHA256'], 0), (['--algo', 'Ed25519'], 1)]:
            run = subprocess.run(base + suffix, capture_output=True, text=True, cwd=ROOT, env=env)
            self.assertEqual(run.returncode, expected, run.stderr)
            self.assertEqual(json.loads(run.stdout)['trusted'], expected == 0)

    def test_unicode_labels_and_integral_float(self):
        for label in ('\u001f', '\u0085', '\ufeff'):
            receipt = copy.deepcopy(VECTORS['protocolV2']['receipt'])
            receipt['proofId'] = label
            receipt['artifacts'][0]['sizeBytes'] = 7.0
            self.assertTrue(validate_receipt_envelope(receipt)['valid'])

    def test_unsupported_metadata_returns_invalid(self):
        for value in (float('nan'), float('inf'), '\ud800', {1, 2}):
            receipt = copy.deepcopy(VECTORS['protocolV2']['receipt'])
            receipt['metadata']['unsupported'] = value
            result = verify_receipt(receipt)
            self.assertFalse(result['valid'])
            self.assertFalse(result['trusted'])

    def test_cli_key_file_algorithm_conflict(self):
        public = VECTORS['ed25519']['publicKey']
        forged = create_receipt(task={'name': 'fixture forgery'}, signing_key=public, signer_identity='fixture')
        env = {**os.environ, 'PYTHONPATH': str(ROOT / 'python')}
        with tempfile.TemporaryDirectory() as directory:
            proof = Path(directory) / 'receipt.json'
            key_file = Path(directory) / 'key.json'
            proof.write_text(json.dumps(forged))
            for key in ({'algorithm': 'Ed25519', 'publicKey': public}, {'publicKey': public}, {'algorithm': 'HMAC-SHA256', 'publicKey': public}):
                key_file.write_text(json.dumps(key))
                run = subprocess.run([sys.executable, '-m', 'nymrel_proof_ledger.cli', 'verify', str(proof), '--key-file', str(key_file), '--algo', 'HMAC-SHA256', '--json'], capture_output=True, text=True, env=env, cwd=ROOT)
                self.assertEqual(run.returncode, 1, run.stderr)
                self.assertFalse(json.loads(run.stdout)['trusted'])
                self.assertEqual(json.loads(run.stdout)['errors'], ['Invalid verification key file or algorithm context'])
            valid = create_receipt(task={'name': 'Ed fixture'}, signing_key=VECTORS['ed25519']['secretKey'], signer_identity='fixture', algorithm='Ed25519')
            proof.write_text(json.dumps(valid))
            key_file.write_text(json.dumps({'algorithm': 'Ed25519', 'publicKey': public}))
            run = subprocess.run([sys.executable, '-m', 'nymrel_proof_ledger.cli', 'verify', str(proof), '--key-file', str(key_file), '--algo', 'Ed25519', '--json'], capture_output=True, text=True, env=env, cwd=ROOT)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertTrue(json.loads(run.stdout)['trusted'])
            json_key = json.dumps({'algorithm': 'Ed25519', 'publicKey': public})
            for encoded in [('\ufeff' + json_key).encode('utf-8'), ('\ufeff' + json_key).encode('utf-16-le'), (' \ufeff\u0085' + json_key).encode('utf-8'), json_key.encode('utf-16-le'), json_key.encode('utf-16-be'), ('\ufffd' + json_key).encode('utf-8')]:
                old_raw = encoded.decode('utf-8', errors='replace').strip()
                encoded_forgery = create_receipt(task={'name': 'encoded JSON forgery'}, signing_key=old_raw, signer_identity='fixture')
                proof.write_text(json.dumps(encoded_forgery))
                key_file.write_bytes(encoded)
                run = subprocess.run([sys.executable, '-m', 'nymrel_proof_ledger.cli', 'verify', str(proof), '--key-file', str(key_file), '--algo', 'HMAC-SHA256', '--json'], capture_output=True, text=True, env=env, cwd=ROOT)
                self.assertEqual(run.returncode, 1, run.stderr)
                self.assertFalse(json.loads(run.stdout)['trusted'])
                self.assertEqual(json.loads(run.stdout)['errors'], ['Invalid verification key file or algorithm context'])
            proof.write_text(json.dumps(valid))
            key_file.write_bytes(('\ufeff' + json_key).encode('utf-8'))
            run = subprocess.run([sys.executable, '-m', 'nymrel_proof_ledger.cli', 'verify', str(proof), '--key-file', str(key_file), '--algo', 'Ed25519', '--json'], capture_output=True, text=True, env=env, cwd=ROOT)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertTrue(json.loads(run.stdout)['trusted'])

    def test_network_and_escaping_paths_do_not_resolve(self):
        with patch('nymrel_proof_ledger.receipt.os.path.realpath', side_effect=AssertionError('No filesystem lookup allowed')) as realpath:
            for value in ('//attacker.invalid/share/x', '\\\\attacker.invalid\\share\\x', 'C:\\outside\\file', 'C:relative', '../outside', '..\\outside'):
                # v1 labels are unsigned, so valid Merkle data reaches path preflight.
                receipt = copy.deepcopy(VECTORS['legacyV1']['receipt'])
                receipt['artifacts'][0]['path'] = value
                result = verify_receipt(receipt, check_files_on_disk=True)
                self.assertFalse(result['valid'])
                self.assertEqual(result['checkedArtifacts'], 0)
            realpath.assert_not_called()


if __name__ == '__main__':
    unittest.main()

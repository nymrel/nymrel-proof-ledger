import contextlib
import errno
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'python'))

from nymrel_proof_ledger.cli import main
from nymrel_proof_ledger.receipt import create_receipt, verify_receipt

PYTHON_SOURCE = str(Path(__file__).resolve().parents[2] / 'python')
READ_ERROR = (
    'Receipt file could not be read. '
    'Check the receipt path and read permissions, then retry.'
)
JSON_ERROR = (
    'Receipt file is not valid UTF-8 JSON. '
    'Supply a complete UTF-8 JSON receipt, then retry.'
)


def failed_loading_result(message):
    return {
        'valid': False,
        'trusted': False,
        'merkleValid': False,
        'signatureChecked': False,
        'signatureValid': None,
        'artifactsValid': False,
        'checkedArtifacts': 0,
        'receipt': None,
        'errors': [message],
        'warnings': [],
    }


class TestCliReceiptInputRecovery(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='proof-ledger-input-')
        self.directory = Path(self.temporary.name)
        receipt = create_receipt(
            task={'name': 'Customer release'},
            signing_key='local-consumer-test-key',
            signer_identity='test-consumer',
            artifacts=[{'path': 'artifact.txt', 'data': 'release output'}],
            metadata={'note': 'fixture metadata'},
        )
        encoded_receipt = json.dumps(receipt).encode('utf-8')
        self.proof = self.directory / 'proof.json'
        self.proof.write_bytes(encoded_receipt)
        self.key = self.directory / 'hmac.key'
        self.key.write_text(json.dumps({
            'algorithm': 'HMAC-SHA256', 'secretKey': 'local-consumer-test-key',
        }), encoding='utf-8')
        (self.directory / 'artifact.txt').write_text('release output', encoding='utf-8')
        receipt_directory = self.directory / 'receipt-directory'
        receipt_directory.mkdir()
        self.load_failures = [
            (self.directory / 'missing.json', READ_ERROR),
            (receipt_directory, READ_ERROR),
        ]
        for name, content in (
            ('malformed.json', b'{ broken json'),
            ('truncated.json', b'{"task":'),
            ('bom.json', b'\xef\xbb\xbf' + encoded_receipt),
            ('invalid-utf8.json', b'\xff'),
            ('invalid-task-utf8.json', encoded_receipt.replace(
                b'Customer release', b'Customer \xffrelease',
            )),
            ('invalid-metadata-utf8.json', encoded_receipt.replace(
                b'fixture metadata', b'fixture \xffmetadata',
            )),
            ('deep.json', b'[' * 10_000 + b'null' + b']' * 10_000),
        ):
            path = self.directory / name
            path.write_bytes(content)
            self.load_failures.append((path, JSON_ERROR))
        self.original_files = {
            path: path.read_bytes()
            for path in self.directory.iterdir() if path.is_file()
        }

    def tearDown(self):
        self.temporary.cleanup()

    def command(self, *arguments):
        return subprocess.run(
            [sys.executable, '-m', 'nymrel_proof_ledger.cli', *arguments],
            cwd=self.directory, encoding='utf-8', capture_output=True,
            env={**os.environ, 'PYTHONPATH': PYTHON_SOURCE}, check=False,
        )

    def verification_arguments(self, proof, structured=True):
        arguments = [
            'verify', str(proof), '--algo', 'HMAC-SHA256',
            '--key-file', str(self.key), '--check-files',
        ]
        return arguments + ['--json'] if structured else arguments

    def in_process(self, arguments):
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            with self.assertRaises(SystemExit) as exited:
                main(arguments)
        return exited.exception.code, output.getvalue(), errors.getvalue()

    def assert_inputs_unchanged(self):
        for path, original in self.original_files.items():
            self.assertEqual(path.read_bytes(), original, path.name)
        self.assertFalse((self.directory / 'missing.json').exists())
        self.assertTrue((self.directory / 'receipt-directory').is_dir())

    def test_loading_failures_return_the_complete_json_result(self):
        for path, message in self.load_failures:
            with self.subTest(input=path.name):
                result = self.command(*self.verification_arguments(path))
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stderr, '')
                self.assertEqual(json.loads(result.stdout), failed_loading_result(message))
        self.assert_inputs_unchanged()

    def test_loading_failures_print_an_actionable_human_report(self):
        for path, message in self.load_failures:
            with self.subTest(input=path.name):
                result = self.command(*self.verification_arguments(path, structured=False))
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stderr, '')
                self.assertIn('--- PROOF VERIFICATION REPORT ---', result.stdout)
                self.assertIn(message, result.stdout)
                self.assertIn('Overall: FAILED (UNVERIFIED)', result.stdout)
                self.assertNotIn('Traceback', result.stdout)
        self.assert_inputs_unchanged()

    def test_loading_failures_skip_key_signature_and_artifact_verification(self):
        for path, message in self.load_failures:
            with self.subTest(input=path.name):
                with patch('nymrel_proof_ledger.cli.verify_receipt') as verify, \
                        patch('nymrel_proof_ledger.cli._load_key_material') as load_key:
                    code, output, errors = self.in_process(self.verification_arguments(path))
                    self.assertEqual(code, 1)
                    self.assertEqual(errors, '')
                    self.assertEqual(json.loads(output), failed_loading_result(message))
                    load_key.assert_not_called()
                    verify.assert_not_called()
        self.assert_inputs_unchanged()

    def test_permission_denied_uses_the_read_failure_result_without_verification(self):
        # A mocked EACCES checks permission recovery even when tests run as root.
        for structured in (True, False):
            with self.subTest(structured=structured):
                with patch('builtins.open', side_effect=PermissionError(
                        errno.EACCES, 'Permission denied', str(self.proof),
                )), patch('nymrel_proof_ledger.cli.verify_receipt') as verify, \
                        patch('nymrel_proof_ledger.cli._load_key_material') as load_key:
                    code, output, errors = self.in_process(
                        self.verification_arguments(self.proof, structured),
                    )
                    self.assertEqual(code, 1)
                    self.assertEqual(errors, '')
                    if structured:
                        self.assertEqual(json.loads(output), failed_loading_result(READ_ERROR))
                    else:
                        self.assertIn(READ_ERROR, output)
                        self.assertIn('Overall: FAILED (UNVERIFIED)', output)
                        self.assertNotIn('Traceback', output)
                    load_key.assert_not_called()
                    verify.assert_not_called()
        self.assert_inputs_unchanged()

    def test_authenticated_v2_policy_fails_before_key_or_artifact_access(self):
        with patch('builtins.open', side_effect=PermissionError(errno.EACCES, 'Permission denied')) as read, \
                patch('nymrel_proof_ledger.cli.verify_receipt') as verify, \
                patch('nymrel_proof_ledger.cli._load_key_material') as load_key:
            code, output, errors = self.in_process([
                'verify', '--require-trusted-v2', str(self.proof), '--key-file', str(self.key),
                '--algo', 'HMAC-SHA256', '--check-files', '--json',
            ])
            self.assertEqual(code, 1)
            self.assertEqual(errors, '')
            result = json.loads(output)
            policy = result.pop('policy')
            self.assertEqual(result, failed_loading_result(READ_ERROR))
            self.assertEqual(policy['name'], 'authenticated-v2')
            self.assertFalse(policy['passed'])
            self.assertEqual(len(policy['errors']), 3)
            read.assert_called_once()
            load_key.assert_not_called()
            verify.assert_not_called()
        self.assert_inputs_unchanged()

    def test_parsed_invalid_envelopes_keep_the_verifiers_existing_results(self):
        for value in (None, [], 7, {}, {'task': {'name': 'Incomplete receipt'}}):
            with self.subTest(receipt=value):
                path = self.directory / 'invalid-envelope.json'
                encoded = json.dumps(value).encode('utf-8')
                path.write_bytes(encoded)
                result = self.command('verify', str(path), '--json')
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stderr, '')
                self.assertEqual(json.loads(result.stdout), verify_receipt(value))
                self.assertEqual(path.read_bytes(), encoded)
        self.assert_inputs_unchanged()

    def test_unexpected_verifier_errors_are_not_receipt_loading_failures(self):
        output, errors = io.StringIO(), io.StringIO()
        with patch('nymrel_proof_ledger.cli.verify_receipt', side_effect=RuntimeError(
                'unexpected verifier failure',
        )) as verify, contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            with self.assertRaisesRegex(RuntimeError, '^unexpected verifier failure$'):
                main(['verify', str(self.proof), '--json'])
            verify.assert_called_once()
        self.assertEqual(output.getvalue(), '')
        self.assertEqual(errors.getvalue(), '')
        self.assert_inputs_unchanged()

    def test_retry_after_each_loading_failure_preserves_receipt_and_key_files(self):
        for path, message in self.load_failures:
            with self.subTest(input=path.name):
                failed = self.command(*self.verification_arguments(path))
                self.assertEqual(failed.returncode, 1)
                self.assertEqual(json.loads(failed.stdout), failed_loading_result(message))
                retry = self.command(*self.verification_arguments(self.proof))
                self.assertEqual(retry.returncode, 0, retry.stderr)
                self.assertEqual(retry.stderr, '')
                verification = json.loads(retry.stdout)
                self.assertTrue(verification['trusted'])
                self.assertTrue(verification['signatureValid'])
                self.assertTrue(verification['artifactsValid'])
                self.assertEqual(verification['checkedArtifacts'], 1)
                self.assert_inputs_unchanged()


if __name__ == '__main__':
    unittest.main()

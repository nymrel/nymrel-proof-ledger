import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'python'))

from nymrel_proof_ledger.receipt import create_receipt, verify_receipt

PYTHON_SOURCE = str(Path(__file__).resolve().parents[2] / 'python')


class TestCliFirstUseAndRecovery(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='proof-ledger-cli-')
        self.directory = Path(self.temporary.name)
        receipt = create_receipt(
            task={'name': 'Customer release'},
            signing_key='local-consumer-test-key',
            signer_identity='test-consumer',
            artifacts=[{'path': 'artifact.txt', 'data': 'release output'}],
        )
        (self.directory / 'artifact.txt').write_text('release output', encoding='utf-8')
        (self.directory / 'proof.json').write_text(json.dumps(receipt), encoding='utf-8')
        (self.directory / 'hmac.key').write_text(json.dumps({
            'algorithm': 'HMAC-SHA256', 'secretKey': 'local-consumer-test-key',
        }), encoding='utf-8')
        (self.directory / 'invalid.json').write_text(
            '{"task":{"name":"Incomplete receipt"}}', encoding='utf-8',
        )

    def tearDown(self):
        self.temporary.cleanup()

    def command(self, *arguments):
        return subprocess.run(
            [sys.executable, '-m', 'nymrel_proof_ledger.cli', *arguments],
            cwd=self.directory, encoding='utf-8', capture_output=True,
            env={**os.environ, 'PYTHONPATH': PYTHON_SOURCE}, check=False,
        )

    def test_version_is_available_without_a_command(self):
        result = self.command('--version')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), '2.0.0')
        self.assertEqual(result.stderr, '')

    def test_boolean_flags_preserve_the_requested_receipt_and_equals_options_work(self):
        receipt = json.loads((self.directory / 'proof.json').read_text(encoding='utf-8'))
        receipt['task']['name'] = 'Requested tampered receipt'
        (self.directory / 'tampered.json').write_text(json.dumps(receipt), encoding='utf-8')
        result = self.command('verify', '--json', 'tampered.json')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)['receipt']['task']['name'], 'Requested tampered receipt')
        (self.directory / '-receipt.json').write_bytes((self.directory / 'proof.json').read_bytes())
        retry = self.command(
            'verify', '--json', '--algo=HMAC-SHA256', '--key-file=hmac.key',
            '--check-files', '--', '-receipt.json',
        )
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertTrue(json.loads(retry.stdout)['trusted'])

    def test_format_typos_and_missing_values_preserve_customer_output(self):
        target = self.directory / 'output.txt'
        target.write_text('customer existing output', encoding='utf-8')
        for command in ('badge', 'export'):
            with self.subTest(command=command):
                result = self.command(command, 'proof.json', '--format', 'banana', '--out', 'output.txt')
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(target.read_text(encoding='utf-8'), 'customer existing output')
        result = self.command('badge', '--format')
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.directory / 'badge.svg').exists())

    def test_unknown_flag_recovery_keeps_the_selected_receipt(self):
        result = self.command('verify', '--jsoon', 'proof.json')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')
        retry = self.command('verify', '--json', 'proof.json')
        self.assertEqual(retry.returncode, 0)
        self.assertTrue(json.loads(retry.stdout)['valid'])

    def test_incomplete_receipts_fail_before_display_or_export(self):
        for arguments in (
            ('inspect', 'invalid.json'),
            ('export', 'invalid.json', '--out', 'report.md'),
        ):
            with self.subTest(command=arguments[0]):
                result = self.command(*arguments)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, '')
                self.assertIn('Invalid proof receipt', result.stderr)
                self.assertNotIn('Traceback', result.stderr)
        self.assertFalse((self.directory / 'report.md').exists())

    def test_malformed_receipt_and_missing_algorithm_have_a_successful_safe_retry(self):
        proof_before = (self.directory / 'proof.json').read_bytes()
        key_before = (self.directory / 'hmac.key').read_bytes()
        (self.directory / 'broken.json').write_text('{ broken json', encoding='utf-8')
        malformed = self.command('verify', 'broken.json', '--json')
        self.assertEqual(malformed.returncode, 1)
        self.assertIn('Proof Ledger command failed', malformed.stderr)
        self.assertNotIn('Traceback', malformed.stderr)
        missing_algorithm = self.command('verify', 'proof.json', '--key-file', 'hmac.key', '--json')
        self.assertEqual(missing_algorithm.returncode, 1)
        self.assertFalse(json.loads(missing_algorithm.stdout)['trusted'])
        retry = self.command(
            'verify', 'proof.json', '--algo', 'HMAC-SHA256', '--key-file', 'hmac.key',
            '--check-files', '--json',
        )
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertTrue(json.loads(retry.stdout)['trusted'])
        self.assertEqual((self.directory / 'proof.json').read_bytes(), proof_before)
        self.assertEqual((self.directory / 'hmac.key').read_bytes(), key_before)

    def test_terminal_errors_are_bounded_but_verification_json_keeps_full_details(self):
        receipt = json.loads((self.directory / 'proof.json').read_text(encoding='utf-8'))
        receipt['protocol'] = '\x1b[2J\x07\u202e' + 'x' * 20_000 + '\n'
        input_text = json.dumps(receipt)
        (self.directory / 'oversized.json').write_text(input_text, encoding='utf-8')
        output = self.directory / 'report.md'
        output.write_text('customer existing output', encoding='utf-8')
        for arguments in (
            ('inspect', 'oversized.json'),
            ('export', 'oversized.json', '--out', 'report.md'),
            ('badge', 'oversized.json', '--out', 'report.md'),
        ):
            with self.subTest(command=arguments[0]):
                result = self.command(*arguments)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, '')
                self.assertLessEqual(len(result.stderr), 850)
                self.assertIn('Invalid proof receipt: protocol: Unsupported protocol identifier', result.stderr)
                self.assertIn('details shortened; check the receipt or options and retry', result.stderr)
                self.assertNotRegex(result.stderr.rstrip(), r'[\x00-\x1f\x7f-\x9f\u202e]|Traceback')
        structured = self.command('verify', 'oversized.json', '--json')
        self.assertEqual(structured.returncode, 1)
        self.assertEqual(structured.stderr, '')
        verification = json.loads(structured.stdout)
        self.assertFalse(verification['valid'])
        self.assertEqual(verification['errors'], verify_receipt(receipt)['errors'])
        self.assertGreater(len(verification['errors'][0]), 20_000)
        self.assertNotIn('details shortened', structured.stdout)
        self.assertEqual((self.directory / 'oversized.json').read_text(encoding='utf-8'), input_text)
        self.assertEqual(output.read_text(encoding='utf-8'), 'customer existing output')
        retry = self.command('inspect', 'proof.json')
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertIn('Customer release', retry.stdout)

    def test_short_native_error_details_remain_intact_for_recovery(self):
        result = self.command('inspect', 'missing-receipt.json')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertIn("[Errno 2] No such file or directory: 'missing-receipt.json'", result.stderr)
        self.assertNotRegex(result.stderr.rstrip(), r'details shortened|Traceback|[\x00-\x1f\x7f-\x9f]')
        self.assertLess(len(result.stderr), 300)


if __name__ == '__main__':
    unittest.main()

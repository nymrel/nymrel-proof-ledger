"""Shared executable CLI policy cases; imported by the cross-runtime check too."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python'))
from nymrel_proof_ledger.receipt import create_receipt  # noqa: E402 - source checkout

VECTORS = json.loads((ROOT / 'test/fixtures/protocol-v2-vectors.json').read_text())
CASES = json.loads((ROOT / 'test/fixtures/cli-gate-cases.json').read_text())
PAYLOAD = 'gate payload\n'


def prepare_case(row, directory):
    algorithm = 'HMAC-SHA256' if row.get('legacy') else row.get('algorithm', 'Ed25519')
    key = (VECTORS['legacyV1']['secret'] if row.get('legacy') else
           VECTORS['ed25519']['publicKey'] if algorithm == 'Ed25519' else
           VECTORS['protocolV2']['secret'])
    receipt = (copy.deepcopy(VECTORS['legacyV1']['receipt']) if row.get('legacy') else
               create_receipt(task={'name': 'gate reference'}, signer_identity='fixture',
                              algorithm=algorithm,
                              signing_key=VECTORS['ed25519']['secretKey'] if algorithm == 'Ed25519' else key,
                              artifacts=[{'path': 'artifact.txt', 'data': PAYLOAD}],
                              metadata={'purpose': 'test'}))
    if row.get('tamper') == 'metadata':
        receipt['metadata']['purpose'] = 'changed'
    if row.get('tamper') == 'artifact':
        receipt['artifacts'][0]['sha256'] = '00' * 32
    (directory / 'proof.json').write_text(json.dumps(None if row.get('malformed') else receipt))
    if row.get('inputFailure') == 'missing':
        (directory / 'proof.json').unlink()
    elif row.get('inputFailure') == 'json':
        (directory / 'proof.json').write_text('{ incomplete')
    elif row.get('inputFailure') == 'utf8':
        (directory / 'proof.json').write_bytes(b'\xff')
    elif row.get('inputFailure') == 'bom':
        (directory / 'proof.json').write_text('\ufeff' + json.dumps(receipt), encoding='utf-8')
    if row.get('disk') in ('match', 'changed'):
        (directory / 'artifact.txt').write_text(PAYLOAD if row['disk'] == 'match' else 'changed')
    flags = []
    if row['key'] != 'none':
        verification_key = '00' * 32 if row['key'] == 'wrong' else key
        if row.get('keyFile'):
            (directory / 'public.json').write_text(json.dumps({'algorithm': algorithm, 'publicKey': verification_key}))
            flags += ['--key-file', 'public.json']
        else:
            flags += ['--key', verification_key]
        if not row.get('omitAlgorithm'):
            flags += ['--algo', row.get('expectedAlgorithm', algorithm)]
    if row.get('disk'):
        flags += ['--check-files']
    return ['verify', *(['--require-trusted-v2'] if row['gate'] else []), 'proof.json', *flags]


class TestCliGate(unittest.TestCase):
    def test_shared_cli_cases(self):
        env = {**os.environ, 'PYTHONPATH': str(ROOT / 'python')}
        for row in CASES:
            with self.subTest(row=row['name']), tempfile.TemporaryDirectory() as directory:
                args = prepare_case(row, Path(directory))
                command = [sys.executable, '-m', 'nymrel_proof_ledger.cli', *args]
                run = subprocess.run([*command, '--json'], capture_output=True, text=True,
                                     cwd=directory, env=env, timeout=30, check=False)
                self.assertEqual(run.returncode, row['exit'], run.stderr)
                result = json.loads(run.stdout)
                self.assertEqual(result['valid'], row['valid'])
                self.assertEqual(result['trusted'], row['trusted'])
                if row.get('inputFailure'):
                    self.assertIsNone(result['receipt'])
                    self.assertFalse(result['signatureChecked'])
                    self.assertIsNone(result['signatureValid'])
                    self.assertEqual(result['checkedArtifacts'], 0)
                    self.assertIn('then retry.', result['errors'][0])
                if row['gate']:
                    self.assertEqual(result['policy']['name'], 'authenticated-v2')
                    self.assertEqual(result['policy']['passed'], row['exit'] == 0)
                    self.assertEqual(not result['policy']['errors'], row['exit'] == 0)
                    human = subprocess.run(command, capture_output=True, text=True,
                                           cwd=directory, env=env, timeout=30, check=False)
                    self.assertEqual(human.returncode, row['exit'], human.stderr)
                    if row['valid'] and row['exit'] == 1:
                        self.assertIn('FAILED (POLICY)', human.stdout)
                        self.assertNotIn('PASSED (TRUSTED)', human.stdout)
                        self.assertNotIn('PASSED (INTEGRITY ONLY)', human.stdout)
                else:
                    self.assertNotIn('policy', result)

    def test_policy_rejects_values(self):
        env = {**os.environ, 'PYTHONPATH': str(ROOT / 'python')}
        for args in [
            ['verify', '--require-trusted-v2=false', 'absent.json'],
            ['verify', '--require-trusted-v2', 'absent.json', 'false'],
            ['verify', str(ROOT / 'test/fixtures/auth-context-cli-receipt.json'), '--require-trusted-v2', '-require-trusted-v2', '', '--json'],
            ['verify', str(ROOT / 'test/fixtures/auth-context-cli-receipt.json'), '--require-trusted-v3', '--json'],
        ]:
            run = subprocess.run([sys.executable, '-m', 'nymrel_proof_ledger.cli', *args],
                                 capture_output=True, text=True, env=env, timeout=30, check=False)
            self.assertNotEqual(run.returncode, 0)

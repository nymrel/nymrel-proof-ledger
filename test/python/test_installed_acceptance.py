"""Release evidence must fail closed even when Python removes assert statements."""
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python'))
from nymrel_proof_ledger import ProofSigner, create_receipt  # noqa: E402


class TestInstalledAcceptance(unittest.TestCase):
    def run_script(self, script, *args, optimization='-O'):
        return subprocess.run(
            [sys.executable, optimization, '-c', script, *map(str, args)],
            cwd=ROOT, env={**os.environ, 'PYTHONPATH': str(ROOT / 'python')},
            capture_output=True, text=True, timeout=30, check=False,
        )

    def test_reference_consumer_reports_sanitized_artifact_reason_and_recovers(self):
        with tempfile.TemporaryDirectory(prefix='private-path-must-not-print-') as directory:
            root = Path(directory)
            keys = ProofSigner.generate_key_pair()
            original = b'synthetic public artifact'
            artifact = root / 'artifact.txt'
            artifact.write_bytes(original)
            receipt = create_receipt(
                task={'name': 'private receipt details must not print'}, signing_key=keys['privateKey'],
                signer_identity='fixture', algorithm='Ed25519', cwd=directory,
                artifacts=[{'path': 'artifact.txt'}], metadata={'purpose': 'private metadata must not print'},
            )
            (root / 'proof.json').write_text(json.dumps(receipt))
            (root / 'verifier-config.json').write_text(json.dumps({
                'algorithm': 'Ed25519', 'publicKey': keys['publicKey'],
            }))
            launcher = "import runpy,sys; sys.argv=['installed_consumer.py','verify',sys.argv[1]]; runpy.run_path('examples/installed_consumer.py',run_name='__main__')"
            for case, changed, diagnostic in (
                    ('missing', None, 'Verification failed: artifact missing or unreadable. Restore the original artifact.txt beside proof.json, check read access, then retry verification.'),
                    ('mismatch', b'changed artifact bytes', 'Verification failed: artifact bytes do not match the receipt. Restore the original artifact.txt beside proof.json, then retry verification.')):
                with self.subTest(case=case):
                    if changed is None:
                        artifact.unlink()
                    else:
                        artifact.write_bytes(changed)
                    try:
                        failed = self.run_script(launcher, directory)
                        self.assertEqual(failed.returncode, 1)
                        self.assertEqual(failed.stdout, '')
                        self.assertEqual(failed.stderr.strip(), diagnostic)
                        for sensitive in (directory, keys['publicKey'], keys['privateKey'],
                                          'private receipt details', 'private metadata'):
                            self.assertNotIn(sensitive, failed.stderr)
                    finally:
                        artifact.write_bytes(original)
                    recovered = self.run_script(launcher, directory)
                    self.assertEqual(recovered.returncode, 0, recovered.stderr)
                    self.assertEqual(len(json.loads(recovered.stdout)['checks']), 4)

    def test_reference_consumer_rejects_real_invalid_receipts_when_optimized(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            keys = ProofSigner.generate_key_pair()
            (root / 'artifact.txt').write_text('synthetic acceptance artifact')
            receipt = create_receipt(
                task={'name': 'optimization regression'}, signing_key=keys['privateKey'],
                signer_identity='fixture', algorithm='Ed25519', cwd=directory,
                artifacts=[{'path': 'artifact.txt'}], metadata={'purpose': 'regression'},
            )
            (root / 'verifier-config.json').write_text(json.dumps({
                'algorithm': 'Ed25519', 'publicKey': keys['publicKey'],
            }))
            launcher = "import runpy,sys; sys.argv=['installed_consumer.py','verify',sys.argv[1]]; runpy.run_path('examples/installed_consumer.py',run_name='__main__')"
            for optimization in ('-O', '-OO'):
                with self.subTest(optimization=optimization):
                    (root / 'proof.json').write_text(json.dumps(receipt))
                    good = self.run_script(launcher, directory, optimization=optimization)
                    self.assertEqual(good.returncode, 0, good.stderr)
                    self.assertEqual(len(json.loads(good.stdout)['checks']), 4)
                    changed = {**receipt, 'metadata': {'purpose': 'changed after signing'}}
                    (root / 'proof.json').write_text(json.dumps(changed))
                    bad = self.run_script(launcher, directory, optimization=optimization)
                    self.assertNotEqual(bad.returncode, 0)
                    self.assertNotIn('"status": "PASS"', bad.stdout)

    def test_reference_consumer_rejects_unexpected_authenticated_negative_verdict(self):
        # Simulate a regression that authenticates every receipt, including wrong keys.
        script = """
import runpy,sys
from unittest.mock import patch
with patch('nymrel_proof_ledger.verify_receipt', return_value={
    'valid':True,'trusted':True,'signatureChecked':True,'checkedArtifacts':1,
}):
    sys.argv=['installed_consumer.py','verify',sys.argv[1]]
    runpy.run_path('examples/installed_consumer.py',run_name='__main__')
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'proof.json').write_text('{"version":"2.0.0"}')
            (root / 'verifier-config.json').write_text(json.dumps({
                'algorithm': 'Ed25519', 'publicKey': '00' * 32,
            }))
            result = self.run_script(script, directory)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('"status": "PASS"', result.stdout)

    def test_harness_records_failed_subprocess_without_optimized_false_pass(self):
        script = """
import runpy,sys
from subprocess import CompletedProcess
from unittest.mock import patch
module=runpy.run_path('test/installed_consumers.py')
module['main'].__globals__['source_state']=lambda: {}
sys.argv=['installed_consumers.py','--output',sys.argv[1]]
with patch('subprocess.run', return_value=CompletedProcess(['node','--version'],1,'fake version','injected failure')):
    module['main']()
"""
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'evidence'
            result = self.run_script(script, output)
            self.assertNotEqual(result.returncode, 0)
            report = json.loads((output / 'acceptance.json').read_text())
            self.assertEqual(report['status'], 'FAIL')
            self.assertIn('node-version failed', report['error'])
            self.assertEqual(len(report['steps']), 1)
            self.assertNotIn('"status": "PASS"', result.stdout)

    def test_harness_refuses_broken_packaged_links_when_optimized(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'broken.tgz'
            with tarfile.open(archive, 'w:gz') as package:
                markdown = b'[missing guide](docs/missing.md)'
                info = tarfile.TarInfo('package/README.md')
                info.size = len(markdown)
                package.addfile(info, io.BytesIO(markdown))
            result = self.run_script(
                "import runpy,sys; runpy.run_path('test/installed_consumers.py')['check_npm_documentation'](sys.argv[1])",
                archive,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Broken packaged documentation link', result.stderr)


if __name__ == '__main__':
    unittest.main()

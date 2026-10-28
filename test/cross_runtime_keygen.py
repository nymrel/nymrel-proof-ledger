"""Use fresh keygen files from each CLI to sign and verify in both runtimes."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, 'PYTHONPATH': str(ROOT / 'python')}
CLIS = {
    'node': ['node', str(ROOT / 'bin/proof-ledger.js')],
    'python': [sys.executable, '-m', 'nymrel_proof_ledger.cli'],
}


def run_cli(runtime, arguments, directory, context):
    result = subprocess.run(
        [*CLIS[runtime], *arguments], cwd=directory, env=ENV,
        capture_output=True, text=True, encoding='utf-8', timeout=30, check=False,
    )
    # Captured output can contain secrets if a CLI regresses. Never print it.
    assert result.returncode == 0, f'{context}: {runtime} {arguments[0]} exited {result.returncode}'
    return result.stdout


keygen_cases = 0
attestations = 0
verification_checks = 0
with tempfile.TemporaryDirectory(prefix='proof-ledger-keygen-') as directory:
    artifact = Path(directory) / 'artifact.txt'
    artifact.write_text('Fresh cross-runtime keygen interoperability.\n', encoding='utf-8')
    for producer in CLIS:
        for algorithm in ('HMAC-SHA256', 'Ed25519'):
            context = f'{producer} {algorithm} key'
            key_file = Path(directory) / f'{producer}-{algorithm}.key.json'
            run_cli(producer, [
                'keygen', '--algo', algorithm, '--out', str(key_file),
            ], directory, context)
            assert key_file.is_file(), f'{context}: keygen did not create a key file'
            keygen_cases += 1

            for signer in CLIS:
                receipt_file = Path(directory) / f'{producer}-{algorithm}-{signer}.proof.json'
                run_cli(signer, [
                    'attest', '--task', 'cross-runtime keygen', '--files', str(artifact),
                    '--algo', algorithm, '--key-file', str(key_file), '--out', str(receipt_file),
                ], directory, context)
                attestations += 1
                for verifier in CLIS:
                    verification_context = f'{context}, {signer} receipt, {verifier} verifier'
                    output = run_cli(verifier, [
                        'verify', str(receipt_file), '--algo', algorithm,
                        '--key-file', str(key_file), '--check-files', '--json',
                    ], directory, verification_context)
                    try:
                        result = json.loads(output)
                    except json.JSONDecodeError:
                        raise AssertionError(f'{verification_context}: invalid JSON verdict') from None
                    assert isinstance(result, dict), f'{verification_context}: verdict is not an object'
                    for field in ('valid', 'trusted', 'signatureChecked', 'signatureValid',
                                  'merkleValid', 'artifactsValid'):
                        assert result.get(field) is True, f'{verification_context}: {field} is not true'
                    assert result.get('checkedArtifacts') == 1, f'{verification_context}: artifact not checked'
                    verification_checks += 1

print(json.dumps({
    'fresh_keygen_cases': keygen_cases,
    'cross_runtime_keygen_attestations': attestations,
    'trusted_keygen_verification_checks': verification_checks,
    'status': 'PASS',
}))

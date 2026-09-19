"""Compare actual runtime verdicts and cross-verify fresh HMAC/Ed25519 receipts."""
import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'test/python'))
from test_auth_context import CASES, VECTORS, input_for, options_for
from nymrel_proof_ledger.receipt import create_receipt, verify_receipt

ROOT = Path(__file__).resolve().parents[1]

def node(request):
    process = subprocess.run(
        ['node', 'test/auth-bridge.mjs'], input=json.dumps(request),
        capture_output=True, text=True, encoding='utf-8', cwd=ROOT, check=True,
    )
    return json.loads(process.stdout)


def verdict(result):
    return {key: result[key] for key in (
        'valid', 'trusted', 'signatureChecked', 'signatureValid',
        'merkleValid', 'artifactsValid', 'checkedArtifacts', 'errors', 'warnings',
    )}


requests = [{'receipt': input_for(row), 'options': row['options']} for row in CASES]
node_results = node(requests)
for row, request, actual in zip(CASES, requests, node_results, strict=True):
    expected = verify_receipt(request['receipt'], **options_for(request['options']))
    assert verdict(actual) == verdict(expected), (row['name'], verdict(actual), verdict(expected))
    assert actual['valid'] == row['valid'] and actual['trusted'] == row['trusted'], row['name']

checks = 0
for algorithm in ('HMAC-SHA256', 'Ed25519'):
    private = VECTORS['protocolV2']['secret'] if algorithm == 'HMAC-SHA256' else VECTORS['ed25519']['secretKey']
    public = private if algorithm == 'HMAC-SHA256' else VECTORS['ed25519']['publicKey']
    ts_options = {
        'task': {'name': 'cross-runtime authentication'}, 'algorithm': algorithm,
        'signingKey': private, 'signerIdentity': 'fixture',
        'artifacts': [{'path': 'unicode.txt', 'data': '\u20ac\U0001f600'}],
        'metadata': {'integerFloat': 7.0, 'tiny': 1e-7},
    }
    node_receipt = node([{'action': 'create', 'options': ts_options}])[0]
    python_receipt = create_receipt(
        task=ts_options['task'], algorithm=algorithm, signing_key=private,
        signer_identity='fixture', artifacts=ts_options['artifacts'], metadata=ts_options['metadata'],
    )
    for receipt in (node_receipt, python_receipt):
        for key, algo, trusted in ((public, algorithm, True), ('wrong-key', algorithm, False),
                                  (public, 'Ed25519' if algorithm == 'HMAC-SHA256' else 'HMAC-SHA256', False)):
            options = {'publicKeyOrSecret': key, 'expectedAlgorithm': algo}
            actual = node([{'receipt': receipt, 'options': options}])[0]
            expected = verify_receipt(receipt, **options_for(options))
            assert verdict(actual) == verdict(expected), (algorithm, verdict(actual), verdict(expected))
            assert actual['trusted'] is trusted
            checks += 1

print(json.dumps({'shared_cases': len(CASES), 'bidirectional_authentication_checks': checks, 'status': 'PASS'}))
subprocess.run([sys.executable, str(ROOT / 'test/cross_runtime_signal.py')], cwd=ROOT, check=True)

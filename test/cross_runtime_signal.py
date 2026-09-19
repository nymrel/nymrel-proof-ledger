"""Actual bidirectional Signal verification, including malformed portable JSON."""
import copy
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'test/python'))
from test_signal import fixture_envelope  # noqa: E402 - standalone test bootstrap
from test_auth_context import VECTORS  # noqa: E402
from nymrel_proof_ledger.signal import create_signal_proof_bundle, verify_signal_proof_bundle  # noqa: E402

def node(rows):
    run = subprocess.run(['node', 'test/signal-bridge.mjs'], input=json.dumps(rows), capture_output=True, text=True, encoding='utf-8', cwd=ROOT, check=True)
    return json.loads(run.stdout)

def verdict(result):
    return {**{key: result[key] for key in ('valid', 'structurallyValid', 'profileValid', 'envelopeBound', 'signatureChecked', 'signatureMode', 'signerIdentityTrust', 'doesNotProve')}, 'authoritative': {key: value for key, value in result['authoritative'].items() if value is not None}}

checks = 0
for algorithm in ('HMAC-SHA256', 'Ed25519'):
    private = 'fixture-secret' if algorithm == 'HMAC-SHA256' else VECTORS['ed25519']['secretKey']
    public = private if algorithm == 'HMAC-SHA256' else VECTORS['ed25519']['publicKey']
    options = dict(envelope=fixture_envelope(), task={'name': 'cross-runtime Signal'}, signingKey=private, signerIdentity='fixture', algorithm=algorithm)
    created = [node([{'action': 'create', 'options': options}])[0], create_signal_proof_bundle(envelope=options['envelope'], task=options['task'], signing_key=private, signer_identity='fixture', algorithm=algorithm)]
    for good in created:
        cases = [(good, True), *[({**good, 'receipt': value}, False) for value in (None, {}, [], 7)], (None, False), ([], False)]
        for field in ('evaluator', 'limitations'):
            bad = copy.deepcopy(good)
            bad['envelope'][field] = None
            cases.append((bad, False))
        for field in ('envelope', 'mirror'):
            bad = copy.deepcopy(good)
            if field == 'envelope':
                bad['envelope']['signalReceiptId'] = '\ud800'
            else:
                bad['receipt']['metadata']['signalProfile'] = {'invalid': '\ud800'}
            cases.append((bad, False))
        ts_options = dict(publicKeyOrSecret=public, expectedAlgorithm=algorithm)
        actual = node([{'bundle': value, 'options': ts_options} for value, _ in cases])
        for (value, valid), ts in zip(cases, actual, strict=True):
            py = verify_signal_proof_bundle(value, public_key_or_secret=public, expected_algorithm=algorithm)
            assert verdict(ts) == verdict(py), (algorithm, verdict(ts), verdict(py))
            assert ts['valid'] is valid
            checks += 1
print(json.dumps({'signal_cross_runtime_cases': checks, 'status': 'PASS'}))

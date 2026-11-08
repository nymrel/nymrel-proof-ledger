#!/usr/bin/env python3
"""Record a PermitMesh decision as an ordinary signed Ledger artifact.

Copy into a consuming project with both packages installed. This example records
a policy decision; it never dispatches a tool or changes authoritative replay state.
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

import nymrel_proof_ledger
import permitmesh
from nymrel_proof_ledger import ProofSigner, create_receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('contract', type=Path)
    parser.add_argument('request', type=Path)
    parser.add_argument('output', type=Path, help='New directory for decision.json and proof.json')
    parser.add_argument('--public-config', required=True, type=Path,
                        help='New public-only verifier configuration outside the output directory')
    parser.add_argument('--evaluation-time', required=True,
                        help='Explicit timezone-aware fixture clock; use a trusted host clock in production')
    args = parser.parse_args()
    now = datetime.fromisoformat(args.evaluation_time.replace('Z', '+00:00'))
    if now.tzinfo is None or now.utcoffset() is None:
        parser.error('--evaluation-time requires a timezone')
    root = args.output.resolve()
    config_path = args.public_config.resolve()
    if config_path.is_relative_to(root):
        parser.error('--public-config must be outside the artifact directory')

    contract = json.loads(args.contract.read_text(encoding='utf-8'))
    request = json.loads(args.request.read_text(encoding='utf-8'))
    decision = permitmesh.authorize(contract, request, now=now)
    # Preserve the native Decision.to_dict() projection without another receipt schema.
    decision_bytes = (json.dumps(decision.to_dict(), ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    root.mkdir(parents=True, exist_ok=False)
    (root / 'decision.json').write_bytes(decision_bytes)
    keys = ProofSigner.generate_key_pair()
    # Disposable example keys only. No signing key is written or printed.
    # Real verifiers must authenticate their public configuration independently.
    with config_path.open('x', encoding='utf-8') as stream:
        json.dump({'algorithm': 'Ed25519', 'publicKey': keys['publicKey']}, stream)
    receipt = create_receipt(
        task={'name': 'PermitMesh policy decision', 'status': 'ATTESTED'},
        artifacts=[{'path': 'decision.json', 'mimeType': 'application/json'}],
        signing_key=keys['privateKey'], algorithm='Ed25519',
        signer_identity='experimental-permitmesh-producer',
        metadata={
            'producer': 'permitmesh', 'producerVersion': permitmesh.__version__,
            'contractDigest': decision.contract_digest,
            'decisionDigest': permitmesh.decision_digest(decision),
            'evaluationTime': now.isoformat(),
        }, cwd=str(root),
    )
    with (root / 'proof.json').open('x', encoding='utf-8') as stream:
        json.dump(receipt, stream)
    print(json.dumps({
        'status': 'RECORDED', 'policyAllowed': decision.allowed,
        'reasonCodes': list(decision.reason_codes),
        'producerModule': permitmesh.__file__, 'producerVersion': permitmesh.__version__,
        'ledgerModule': nymrel_proof_ledger.__file__,
        'contractDigest': decision.contract_digest,
    }))


if __name__ == '__main__':
    main()

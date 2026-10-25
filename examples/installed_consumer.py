#!/usr/bin/env python3
"""Copy outside the checkout; install the local wheel before running."""
import argparse
import json
import platform
from copy import deepcopy
from pathlib import Path

import nymrel_proof_ledger
from nymrel_proof_ledger import ProofSigner, create_receipt, verify_receipt


def require(condition, message):
    """Keep acceptance checks active under Python -O/-OO and PYTHONOPTIMIZE."""
    if not condition:
        raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('create', 'verify'))
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    root = args.directory.resolve()
    receipt_path = root / 'proof.json'
    config_path = root / 'verifier-config.json'
    checks = []

    if args.action == 'create':
        root.mkdir(parents=True, exist_ok=True)
        # Experimental signing only. Never save or print the private key.
        keys = ProofSigner.generate_key_pair()
        # Real verifiers obtain this public configuration over an authenticated channel.
        with config_path.open('x', encoding='utf-8') as stream:
            json.dump({'algorithm': 'Ed25519', 'publicKey': keys['publicKey']}, stream)
        with (root / 'artifact.txt').open('x', encoding='utf-8', newline='') as stream:
            stream.write('Installed consumer artifact: \u20ac\U0001f600\n')
        receipt = create_receipt(
            task={'name': 'Installed Python consumer', 'status': 'ATTESTED'},
            artifacts=[{'path': 'artifact.txt'}], signing_key=keys['privateKey'],
            algorithm='Ed25519', signer_identity='experimental-python-consumer',
            metadata={'consumer': 'python', 'purpose': 'installed-package-acceptance'},
            cwd=str(root),
        )
        with receipt_path.open('x', encoding='utf-8') as stream:
            json.dump(receipt, stream)
    else:
        config = json.loads(config_path.read_text(encoding='utf-8'))
        require(sorted(config) == ['algorithm', 'publicKey'], 'Installed-consumer acceptance condition failed')
        require(config['algorithm'] == 'Ed25519', 'Installed-consumer acceptance condition failed')
        require(isinstance(config['publicKey'], str), 'Installed-consumer acceptance condition failed')
        receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
        require(receipt['version'] == '2.0.0', 'Installed-consumer acceptance condition failed')
        options = {
            'public_key_or_secret': config['publicKey'],
            'expected_algorithm': config['algorithm'],
            'check_files_on_disk': True, 'cwd': str(root),
        }
        original = verify_receipt(receipt, **options)
        require(original['valid'] and original['trusted'] and original['signatureChecked'], 'Installed-consumer acceptance condition failed')
        require(original['checkedArtifacts'] == 1, 'Installed-consumer acceptance condition failed')
        checks.append('trusted-v2-public-only')

        wrong_key = verify_receipt(receipt, **{
            **options, 'public_key_or_secret': ProofSigner.generate_key_pair()['publicKey'],
        })
        require(not wrong_key['valid'] and not wrong_key['trusted'], 'Installed-consumer acceptance condition failed')
        checks.append('wrong-key-rejected')

        tampered = deepcopy(receipt)
        tampered['metadata']['purpose'] = 'changed-after-signing'
        rejected = verify_receipt(tampered, **options)
        require(not rejected['valid'] and not rejected['trusted'], 'Installed-consumer acceptance condition failed')
        require(rejected['merkleValid'] and rejected['signatureValid'] is False, 'Installed-consumer acceptance condition failed')
        checks.append('signed-metadata-tampering-rejected')

        integrity = verify_receipt(receipt, check_files_on_disk=True, cwd=str(root))
        require(integrity['valid'] and not integrity['trusted'] and not integrity['signatureChecked'], 'Installed-consumer acceptance condition failed')
        checks.append('integrity-only-untrusted')

    print(json.dumps({
        'action': args.action, 'runtime': platform.python_version(),
        'module': nymrel_proof_ledger.__file__, 'version': nymrel_proof_ledger.__version__,
        'directory': str(root), 'checks': checks, 'status': 'PASS',
    }))


if __name__ == '__main__':
    main()

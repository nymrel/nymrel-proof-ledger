"""
CLI Driver for Python nymrel_proof_ledger package.
"""

import argparse
import json
import re
import sys

from .badge import generate_html_certificate, generate_shield_svg, generate_svg_badge
from .receipt import create_receipt, verify_receipt
from .signer import ProofSigner


def _load_key_material(key_file, role, algorithm):
    """
    Loads signing key material from a file.

    Supports both plain-text key files and the JSON envelopes written by
    `proof-ledger-py keygen`:
      - HMAC-SHA256: {"algorithm": "HMAC-SHA256", "secretKey": "<hex>"}
      - Ed25519:     {"algorithm": "Ed25519", "privateKey": "...", "publicKey": "..."}
    """
    with open(key_file, "r", encoding="utf-8-sig") as f:
        decoded = f.read()
    raw = re.sub(r'^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', decoded)
    if '\x00' in raw or '\ufffd' in raw:
        raise ValueError('Key files require valid UTF-8 text')

    if raw.startswith("{"):
        data = json.loads(raw)
        if algorithm not in ('HMAC-SHA256', 'Ed25519') or ('algorithm' in data and data['algorithm'] != algorithm):
            raise ValueError('Key file algorithm conflicts with configured algorithm')
        field = 'secretKey' if algorithm == 'HMAC-SHA256' else 'privateKey' if role == 'sign' else 'publicKey'
        material = data.get(field)
        if not isinstance(material, str) or not material:
            raise ValueError('Key file lacks material for configured algorithm and role')
        return material
    return raw


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="proof-ledger-py",
        description="Nymrel Proof Ledger (Python Engine) - Cryptographic Attestation Protocol",
    )
    subparsers = parser.add_subparsers(dest="command", help="Sub-command help")

    # keygen
    keygen_parser = subparsers.add_parser("keygen", help="Generate cryptographic keys")
    keygen_parser.add_argument(
        "--algo",
        default="HMAC-SHA256",
        choices=["HMAC-SHA256", "Ed25519"],
        help="Algorithm",
    )
    keygen_parser.add_argument("--out", help="Output file path")

    # attest
    attest_parser = subparsers.add_parser(
        "attest", help="Generate cryptographic attestation"
    )
    attest_parser.add_argument("--task", required=True, help="Task name")
    attest_parser.add_argument("--description", help="Task description")
    attest_parser.add_argument("--files", help="Comma-separated file paths")
    attest_parser.add_argument("--key", help="Signing key or secret")
    attest_parser.add_argument("--key-file", help="Path to file containing signing key")
    attest_parser.add_argument('--include-git-context', action='store_true', help='Collect Git context only from a trusted working directory and Git installation')
    attest_parser.add_argument(
        "--signer", default="nymrel-agent", help="Signer identity"
    )
    attest_parser.add_argument(
        "--algo",
        default="HMAC-SHA256",
        choices=["HMAC-SHA256", "Ed25519"],
        help="Algorithm",
    )
    attest_parser.add_argument(
        "--status",
        default="SUCCESS",
        choices=["SUCCESS", "FAILURE", "ATTESTED"],
        help="Status",
    )
    attest_parser.add_argument(
        "--out", default="proof.json", help="Output proof receipt JSON file"
    )
    attest_parser.add_argument("--badge", help="Optional output SVG badge file")
    attest_parser.add_argument("--html", help="Optional output HTML certificate file")

    # verify
    verify_parser = subparsers.add_parser("verify", help="Verify proof receipt")
    verify_parser.add_argument(
        "proof", nargs="?", default="proof.json", help="Proof receipt JSON path"
    )
    verify_parser.add_argument("--key", help="Public key or secret")
    verify_parser.add_argument("--key-file", help="Path to file containing key")
    verify_parser.add_argument('--algo', choices=['HMAC-SHA256', 'Ed25519'], help='Required with a key; independently configured expected algorithm, never taken from the receipt')
    verify_parser.add_argument(
        "--check-files", action="store_true", help="Verify disk file hashes"
    )
    verify_parser.add_argument(
        "--json", action="store_true", help="Output verification result as JSON"
    )

    # badge
    badge_parser = subparsers.add_parser(
        "badge", help="Generate SVG badge from proof.json"
    )
    badge_parser.add_argument(
        "proof", nargs="?", default="proof.json", help="Proof receipt JSON path"
    )
    badge_parser.add_argument("--out", default="badge.svg", help="Output file path")
    badge_parser.add_argument(
        "--format",
        default="svg",
        choices=["svg", "shield", "html"],
        help="Output format",
    )
    badge_parser.add_argument(
        "--compact", action="store_true", help="Compact SVG dimensions"
    )

    # inspect
    inspect_parser = subparsers.add_parser(
        "inspect", help="Display human-readable proof audit trail"
    )
    inspect_parser.add_argument(
        "proof", nargs="?", default="proof.json", help="Proof receipt JSON path"
    )

    # export
    export_parser = subparsers.add_parser("export", help="Export proof receipt")
    export_parser.add_argument(
        "proof", nargs="?", default="proof.json", help="Proof receipt JSON path"
    )
    export_parser.add_argument(
        "--format",
        default="markdown",
        choices=["markdown", "jsonld", "html"],
        help="Export format",
    )
    export_parser.add_argument("--out", help="Output destination file")

    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help()
        sys.exit(0)

    if args.command == "keygen":
        if args.algo == "Ed25519":
            kp = ProofSigner.generate_key_pair()
            out_str = json.dumps(kp, indent=2)
        else:
            sec = ProofSigner.generate_secret_key()
            out_str = json.dumps(
                {"algorithm": "HMAC-SHA256", "secretKey": sec}, indent=2
            )

        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(out_str)
            print(f"Key saved to {args.out}")
        else:
            print(out_str)
        sys.exit(0)

    if args.command == "attest":
        key = args.key
        if not key and args.key_file:
            key = _load_key_material(args.key_file, "sign", args.algo)
        if not key:
            key = ProofSigner.generate_secret_key()
            print(
                f"Warning: No key provided. Generated ephemeral key: {key}",
                file=sys.stderr,
            )

        file_list = []
        if args.files:
            file_list = [
                {"path": p.strip()} for p in args.files.split(",") if p.strip()
            ]

        task_data = {
            "name": args.task,
            "status": args.status,
            "runner": args.signer,
        }
        if args.description:
            task_data["description"] = args.description

        receipt = create_receipt(
            task=task_data,
            signing_key=key,
            include_git_context=args.include_git_context,
            signer_identity=args.signer,
            artifacts=file_list,
            algorithm=args.algo,
        )

        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(receipt, f, indent=2)

        print(f"Attestation generated: {args.out}")
        print(f"Proof ID:    {receipt['proofId']}")
        print(f"Merkle Root: {receipt['merkle']['root']}")

        if args.badge:
            svg = generate_svg_badge(receipt)
            with open(args.badge, "w", encoding="utf-8") as f:
                f.write(svg)
            print(f"SVG Badge:   {args.badge}")

        if args.html:
            html_doc = generate_html_certificate(receipt)
            with open(args.html, "w", encoding="utf-8") as f:
                f.write(html_doc)
            print(f"Certificate: {args.html}")
        sys.exit(0)

    if args.command == "verify":
        with open(args.proof, "r", encoding="utf-8") as f:
            receipt = json.load(f)

        key = args.key
        key_file_invalid = False
        if not key and args.key_file:
            try:
                key = _load_key_material(args.key_file, "verify", args.algo)
            except (OSError, ValueError, TypeError, RecursionError):
                key = ''
                key_file_invalid = True

        result = verify_receipt(
            receipt,
            public_key_or_secret=key,
            expected_algorithm=args.algo,
            check_files_on_disk=args.check_files,
        )
        if key_file_invalid:
            result['errors'] = ['Invalid verification key file or algorithm context']

        if args.json:
            print(json.dumps(result, indent=2))
            sys.exit(0 if result["valid"] else 1)

        print("\n--- PROOF VERIFICATION REPORT ---")
        if result['receipt'] is None:
            for error in result['errors']:
                print(f'  * {error}')
            print('\nOverall: FAILED (UNVERIFIED)\n')
            sys.exit(1)
        print(f"Proof ID:    {receipt.get('proofId')}")
        print(f"Task:        {receipt.get('task', {}).get('name')}")
        print(f"Merkle Root: {receipt.get('merkle', {}).get('root')}")
        print(f"Merkle Math: {'VALID' if result['merkleValid'] else 'INVALID'}")
        if result["signatureChecked"]:
            print(f"Signature:   {'VALID' if result['signatureValid'] else 'INVALID'}")
        else:
            print("Signature:   NOT CHECKED (no key supplied)")
        if args.check_files:
            print(
                f"Disk Files:  {'ALL MATCHED' if result['artifactsValid'] else 'TAMPERED/MISSING'} ({result['checkedArtifacts']} checked)"
            )

        if result["errors"]:
            print("\nErrors:")
            for err in result["errors"]:
                print(f"  * {err}")

        if result["warnings"]:
            print("\nWarnings:")
            for warning in result["warnings"]:
                print(f"  * {warning}")

        overall = (
            "PASSED (TRUSTED)"
            if result["trusted"]
            else "PASSED (INTEGRITY ONLY)"
            if result["valid"]
            else "FAILED (UNVERIFIED)"
        )
        print(f"\nOverall: {overall}\n")
        sys.exit(0 if result["valid"] else 1)

    if args.command == "badge":
        with open(args.proof, "r", encoding="utf-8") as f:
            receipt = json.load(f)

        if args.format == "html":
            content = generate_html_certificate(receipt)
        elif args.format == "shield":
            content = generate_shield_svg(receipt)
        else:
            content = generate_svg_badge(receipt, compact=args.compact)

        with open(args.out, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Badge generated: {args.out}")
        sys.exit(0)

    if args.command == "inspect":
        with open(args.proof, "r", encoding="utf-8") as f:
            receipt = json.load(f)

        print("\n=== NYMREL PROOF LEDGER AUDIT INSPECTOR ===")
        print(f"Protocol:    {receipt.get('protocol')} v{receipt.get('version')}")
        print(f"Parent Org:  {receipt.get('parentOrganization')}")
        print(f"Proof ID:    {receipt.get('proofId')}")
        print(f"Timestamp:   {receipt.get('timestamp')}")
        print(
            f"Task:        {receipt.get('task', {}).get('name')} ({receipt.get('task', {}).get('status')})"
        )
        print(f"Merkle Root: {receipt.get('merkle', {}).get('root')}")
        print(
            f"Signer:      {receipt.get('signature', {}).get('signerIdentity')} [{receipt.get('signature', {}).get('algorithm')}]"
        )
        print(f"Artifacts:   {len(receipt.get('artifacts', []))}")
        for idx, art in enumerate(receipt.get("artifacts", [])):
            print(
                f"  [{idx + 1}] {art.get('path')} -> SHA256: {art.get('sha256')} ({art.get('sizeBytes')} B)"
            )
        print()
        sys.exit(0)

    if args.command == "export":
        with open(args.proof, "r", encoding="utf-8") as f:
            receipt = json.load(f)

        if args.format == "html":
            out_str = generate_html_certificate(receipt)
        elif args.format == "jsonld":
            out_str = json.dumps(
                {
                    "@context": "https://schema.org",
                    "@type": "DigitalDocument",
                    "name": f"{receipt.get('task', {}).get('name')} Attestation",
                    "identifier": receipt.get("proofId"),
                    "dateCreated": receipt.get("timestamp"),
                    "parentOrganization": {
                        "@type": "Organization",
                        "name": "Nymrel",
                    },
                    "merkleRoot": receipt.get("merkle", {}).get("root"),
                },
                indent=2,
            )
        else:
            out_str = f"# Attestation Report: {receipt.get('task', {}).get('name')}\n\n- Proof ID: `{receipt.get('proofId')}`\n- Merkle Root: `{receipt.get('merkle', {}).get('root')}`\n"

        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(out_str)
            print(f"Exported to {args.out}")
        else:
            print(out_str)
        sys.exit(0)


if __name__ == "__main__":
    main()

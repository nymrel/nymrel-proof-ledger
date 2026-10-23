"""Transport real Ed25519 receipts and artifacts between Python and Node.

Build Node first, then run with the Python runtime dependencies installed:
    python examples/cross-runtime-demo.py
See docs/CROSS_RUNTIME_DEMO.md for a fresh-checkout command.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from nymrel_proof_ledger import ProofSigner, create_receipt, verify_receipt

ROOT = Path(__file__).resolve().parents[1]


def write_json(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)


def sign(root):
    # This child process owns the private key. Only public configuration,
    # receipt JSON, and artifact bytes leave it; no private key is saved.
    keys = ProofSigner.generate_key_pair()
    write_json(root / "verifier-config.json", {
        "algorithm": "Ed25519", "publicKey": keys["publicKey"],
    })
    receipt = create_receipt(
        task={"name": "Python artifact handoff", "status": "ATTESTED"},
        artifacts=[{"path": "build-manifest.json"}],
        signing_key=keys["privateKey"],
        algorithm="Ed25519",
        signer_identity="python-demo-signer",
        metadata={"purpose": "cross-runtime-demo", "label": "Release café 🚀"},
        cwd=str(root),
    )
    write_json(root / "proof.json", receipt)
    return {"status": "signed"}


def verify(root, authenticated):
    receipt = json.loads((root / "proof.json").read_text(encoding="utf-8"))
    options = {"cwd": str(root), "check_files_on_disk": True}
    if authenticated:
        # This is separately provisioned configuration, never receipt metadata.
        config = json.loads((root / "verifier-config.json").read_text(encoding="utf-8"))
        options.update(
            public_key_or_secret=config["publicKey"],
            expected_algorithm=config["algorithm"],
        )
    return verify_receipt(receipt, **options)


def run_worker(runtime, action, root):
    command = (
        ["node", str(ROOT / "examples/cross-runtime-worker.mjs")]
        if runtime == "Node"
        else [sys.executable, str(Path(__file__).resolve())]
    )
    # No shell, signing key, or receipt-selected command is used here.
    process = subprocess.run(
        [*command, action, str(root)], cwd=ROOT, capture_output=True,
        text=True, encoding="utf-8", timeout=60, check=False,
    )
    if process.returncode != 0:
        raise RuntimeError(f"{runtime} {action} worker failed:\n{process.stderr}")
    return json.loads(process.stdout)


def expect(label, result, **expected):
    # Explicit checks also run under python -O; an unexpected verdict must fail.
    for field, wanted in expected.items():
        if field not in result or result[field] != wanted:
            raise RuntimeError(
                f"{label}: expected {field}={wanted!r}, got {result.get(field)!r}; "
                f"errors={result.get('errors')!r}"
            )
    if not result["valid"] and not result["errors"]:
        raise RuntimeError(f"{label}: rejected result did not explain the failure")
    flags = ", ".join(
        f"{field}={str(result[field]).lower()}"
        for field in ("valid", "trusted", "signatureChecked")
    )
    print(f"  {label}: {flags}", flush=True)


def handoff(workspace, signer, verifier):
    signing_root = workspace / f"{signer.lower()}-signer"
    verification_root = workspace / f"{verifier.lower()}-verifier"
    signing_root.mkdir()
    verification_root.mkdir()
    artifact = signing_root / "build-manifest.json"
    artifact.write_bytes('{"build":"local-demo","message":"café 🚀"}\n'.encode())
    run_worker(signer, "sign", signing_root)

    # Simulate provisioning the public key over a separate trusted channel.
    # In production, authenticate this channel independently of the receipt.
    config = json.loads((signing_root / "verifier-config.json").read_text(encoding="utf-8"))
    if set(config) != {"algorithm", "publicKey"} or config["algorithm"] != "Ed25519":
        raise RuntimeError("The demo must transfer public-only Ed25519 configuration")
    shutil.copyfile(signing_root / "verifier-config.json", verification_root / "verifier-config.json")

    # Transport bytes, preserving the relative artifact path beneath a new root.
    for name in ("proof.json", "build-manifest.json"):
        shutil.copyfile(signing_root / name, verification_root / name)
    # Verification cannot accidentally use the signer's original artifact.
    shutil.rmtree(signing_root)
    print(f"{signer} -> {verifier}", flush=True)

    expect("Original receipt + public key + disk check",
           run_worker(verifier, "verify", verification_root),
           valid=True, trusted=True, signatureChecked=True, signatureValid=True,
           merkleValid=True, artifactsValid=True, checkedArtifacts=1, errors=[])
    expect("Original receipt without a verification key",
           run_worker(verifier, "integrity", verification_root),
           valid=True, trusted=False, signatureChecked=False, signatureValid=None,
           merkleValid=True, artifactsValid=True, checkedArtifacts=1, errors=[])

    receipt_path = verification_root / "proof.json"
    original_receipt = receipt_path.read_bytes()
    modified = json.loads(original_receipt)
    modified["metadata"]["purpose"] = "changed-after-signing"
    receipt_path.write_text(json.dumps(modified, ensure_ascii=False), encoding="utf-8")
    expect("Changed signed metadata",
           run_worker(verifier, "verify", verification_root),
           valid=False, trusted=False, signatureChecked=True, signatureValid=False,
           merkleValid=True, artifactsValid=False, checkedArtifacts=0)

    # Restore signed receipt bytes, then change only the transported artifact.
    receipt_path.write_bytes(original_receipt)
    with (verification_root / "build-manifest.json").open("ab") as stream:
        stream.write(b"changed-after-signing\n")
    expect("Changed artifact bytes",
           run_worker(verifier, "verify", verification_root),
           valid=False, trusted=False, signatureChecked=True, signatureValid=True,
           merkleValid=True, artifactsValid=False, checkedArtifacts=1)


def main():
    # Internal worker mode keeps each signer and verifier in a fresh process.
    if len(sys.argv) > 1:
        if len(sys.argv) != 3 or sys.argv[1] not in ("sign", "verify", "integrity"):
            raise SystemExit("Usage: python examples/cross-runtime-demo.py")
        action, directory = sys.argv[1:]
        root = Path(directory).resolve()
        result = sign(root) if action == "sign" else verify(root, action == "verify")
        print(json.dumps(result, ensure_ascii=False))
        return

    if not (ROOT / "dist/src/index.js").is_file():
        raise SystemExit("Build the Node package first: npm ci --ignore-scripts && npm run build")
    if shutil.which("node") is None:
        raise SystemExit("Install Node.js 22.12 through 26.x, then rerun the demo.")
    with TemporaryDirectory(prefix="nymrel-cross-runtime-demo-") as directory:
        workspace = Path(directory)
        handoff(workspace, "Node", "Python")
        handoff(workspace, "Python", "Node")
    print("All 8 expectations passed. Temporary files removed; no private key was saved.")
    print("Trust checks the signed fields under the configured key; it does not prove execution or signer identity.")


if __name__ == "__main__":
    main()

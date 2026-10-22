#!/usr/bin/env python3
"""Local adoption evaluation: existing PR30 signer -> existing PR31 verifier.

Usage: python run_adoption.py --pr30-source PATH --pr31-source PATH NEW_OUTPUT_DIRECTORY
No new signing protocol. Synthetic input; trust provisioning is simulated.
"""
import argparse
import copy
import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

PR30 = None
PR31 = None
EXPECTED_HEADS = {
    "pr30": "6c2b9878f0503aea4ac3e682aaf45ce1b398364f",
    "pr31": "59a2c48a01e910ce2420160dae5a335513f5dc8e",
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def write_json(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def worker(root):
    # Select the exact candidate explicitly; never import the original checkout.
    sys.path.insert(0, str(PR31 / "python"))
    import nymrel_proof_ledger
    from nymrel_proof_ledger import ProofSigner, verify_receipt

    recipient = root / "recipient"
    require(not (root / "signer").exists(), "Signer directory must be gone")
    config = json.loads((root / "trusted-config.json").read_text())
    policy = json.loads((root / "expected-context.json").read_text())
    receipt = json.loads((recipient / "proof.json").read_text())
    require(set(config) == {"algorithm", "publicKey"}, "Public-only config required")
    require(config["algorithm"] == "Ed25519", "Expected Ed25519")
    options = {
        "cwd": str(recipient), "check_files_on_disk": True,
        "public_key_or_secret": config["publicKey"],
        "expected_algorithm": config["algorithm"],
    }

    def accepted(result, expected):
        # Task/purpose are signer assertions. This application policy binds the
        # expected use; it neither proves execution nor grants authority.
        return bool(
            result["valid"] and result["trusted"]
            and result["receipt"]["version"] == "2.0.0"
            and result["receipt"]["task"]["name"] == expected["taskName"]
            and result["receipt"]["metadata"]["purpose"] == expected["purpose"]
        )

    cases = []

    def record(name, candidate, kwargs, expected_flags, expected_context=policy):
        result = verify_receipt(candidate, **kwargs)
        result["contextAccepted"] = accepted(result, expected_context)
        for key, wanted in expected_flags.items():
            require(result.get(key) == wanted, f"{name}: unexpected {key}: {result.get(key)!r}")
        cases.append({"name": name, "expected": expected_flags, "observed": result})

    record("retained artifact authenticated", receipt, options,
           {"valid": True, "trusted": True, "signatureValid": True,
            "artifactsValid": True, "checkedArtifacts": 1, "contextAccepted": True})
    record("no verification key", receipt,
           {"cwd": str(recipient), "check_files_on_disk": True},
           {"valid": True, "trusted": False, "signatureChecked": False,
            "contextAccepted": False})
    record("untrusted public key", receipt,
           {**options, "public_key_or_secret": ProofSigner.generate_key_pair()["publicKey"]},
           {"valid": False, "trusted": False, "contextAccepted": False})
    record("wrong expected algorithm", receipt,
           {**options, "expected_algorithm": "HMAC-SHA256"},
           {"valid": False, "trusted": False, "contextAccepted": False})
    record("missing expected algorithm", receipt,
           {key: value for key, value in options.items() if key != "expected_algorithm"},
           {"valid": False, "trusted": False, "contextAccepted": False})
    changed = copy.deepcopy(receipt)
    changed["metadata"]["purpose"] = "forged-purpose"
    record("signed metadata tamper", changed, options,
           {"valid": False, "trusted": False, "signatureValid": False,
            "contextAccepted": False})
    record("authentic receipt presented for wrong task", receipt, options,
           {"valid": True, "trusted": True, "contextAccepted": False},
           {**policy, "taskName": "Different expected task"})
    record("authentic receipt presented for wrong purpose", receipt, options,
           {"valid": True, "trusted": True, "contextAccepted": False},
           {**policy, "purpose": "production-release-approval"})
    artifact = recipient / "build-manifest.json"
    original = artifact.read_bytes()
    try:
        artifact.write_bytes(original + b"tampered\n")
        record("retained artifact tamper", receipt, options,
               {"valid": False, "trusted": False, "signatureValid": True,
                "artifactsValid": False, "contextAccepted": False})
    finally:
        artifact.write_bytes(original)
    # The retained positive bundle remains verifiable after negative testing.
    record("restored retained artifact authenticated", receipt, options,
           {"valid": True, "trusted": True, "contextAccepted": True})
    return {"status": "PASS", "cases": cases,
            "pythonModule": nymrel_proof_ledger.__file__,
            "python": sys.version, "optimization": sys.flags.optimize,
            "signerDirectoryRemoved": True, "sourceHeads": EXPECTED_HEADS}


def main():
    global PR30, PR31
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pr30-source", required=True, type=Path)
    parser.add_argument("--pr31-source", required=True, type=Path)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    PR30, PR31 = args.pr30_source.resolve(), args.pr31_source.resolve()
    for name, repo in (("pr30", PR30), ("pr31", PR31)):
        actual = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
        require(actual == EXPECTED_HEADS[name], f"{name} source head drift")
        clean = subprocess.run(["git", "-C", str(repo), "diff", "--quiet", "HEAD"], check=False)
        require(clean.returncode == 0, f"{name} tracked source changed")
    if args.worker:
        print(json.dumps(worker(args.output.resolve())))
        return
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=False)
    signer = root / "signer"
    signer.mkdir()
    recipient = root / "recipient"
    recipient.mkdir()
    (signer / "build-manifest.json").write_bytes(
        b'{"task":"proofgraph-adoption-evaluation","fixture":"synthetic","result":"retained artifact"}\n')
    try:
        subprocess.run(["node", str(PR30 / "examples/cross-runtime-worker.mjs"),
                        "sign", str(signer)], capture_output=True, text=True,
                       timeout=60, check=True)
        # Simulated trust provisioning: separate config outside recipient data.
        shutil.copyfile(signer / "verifier-config.json", root / "trusted-config.json")
        for name in ("proof.json", "build-manifest.json"):
            shutil.copyfile(signer / name, recipient / name)
    finally:
        shutil.rmtree(signer)
    write_json(root / "expected-context.json", {
        "taskName": "Node artifact handoff", "purpose": "cross-runtime-demo"})
    # Optimized verifier process proves checks do not depend on Python assert.
    result = subprocess.run([sys.executable, "-O", str(Path(__file__).resolve()),
                             "--pr30-source", str(PR30), "--pr31-source", str(PR31),
                             "--worker", str(root)], capture_output=True,
                            text=True, timeout=60, check=True)
    report = json.loads(result.stdout)
    report["observedAt"] = datetime.now(timezone.utc).isoformat()
    report["sourceHashes"] = {
        "pr30/examples/cross-runtime-worker.mjs": hashlib.sha256(
            (PR30 / "examples/cross-runtime-worker.mjs").read_bytes()).hexdigest(),
        "pr30/dist/src/core/receipt.js": hashlib.sha256(
            (PR30 / "dist/src/core/receipt.js").read_bytes()).hexdigest(),
        "pr31/python/nymrel_proof_ledger/receipt.py": hashlib.sha256(
            (PR31 / "python/nymrel_proof_ledger/receipt.py").read_bytes()).hexdigest(),
        "run_adoption.py": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    report["artifactHashes"] = {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*")) if path.is_file()}
    report["limits"] = ["Synthetic input; same local environment and operator",
                        "Public-key trust provisioning is simulated, not authenticated externally",
                        "Signature authenticates signer assertions; no execution, identity or authority proof",
                        "Task/purpose check is application policy; no freshness or replay ledger",
                        "No human adoption, host verification, cross-team approval or release"]
    write_json(root / "evaluation.json", report)
    print(json.dumps({"status": report["status"], "cases": len(report["cases"]),
                      "report": str(root / "evaluation.json")}))


if __name__ == "__main__":
    main()

"""
Cryptographic Proof-of-Execution Receipt Engine in Python.

Provides full parity with the TypeScript @nymrel/proof-ledger implementation.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
import hashlib
import os
import platform
import subprocess
import sys
from typing import List, Dict, Any, Optional, Union
from .canonical import canonical_hash
from .merkle import MerkleTree
from .signer import ProofSigner


def get_git_context(cwd: str = None) -> Optional[Dict[str, Any]]:
    """Gathers Git repository context safely."""
    cwd = cwd or os.getcwd()
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=cwd,
            stderr=subprocess.DEVNULL
        ).decode("utf-8").strip()

        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=cwd,
            stderr=subprocess.DEVNULL
        ).decode("utf-8").strip()

        status_out = subprocess.check_output(
            ["git", "status", "--porcelain"],
            cwd=cwd,
            stderr=subprocess.DEVNULL
        ).decode("utf-8").strip()

        remote = None
        try:
            remote = subprocess.check_output(
                ["git", "config", "--get", "remote.origin.url"],
                cwd=cwd,
                stderr=subprocess.DEVNULL
            ).decode("utf-8").strip()
        except Exception:
            pass

        ctx = {
            "commit": commit,
            "branch": branch,
            "dirty": len(status_out) > 0,
        }
        if remote:
            ctx["remote"] = remote
        return ctx
    except Exception:
        return None


def hash_artifact(artifact_path: str, data: Optional[Union[str, bytes]] = None, cwd: str = None) -> Dict[str, Any]:
    """Computes SHA-256 hash and size of a file or buffer."""
    cwd = cwd or os.getcwd()
    resolved_path = artifact_path if os.path.isabs(artifact_path) else os.path.abspath(os.path.join(cwd, artifact_path))

    if data is not None:
        buf = data.encode("utf-8") if isinstance(data, str) else bytes(data)
    else:
        with open(resolved_path, "rb") as f:
            buf = f.read()

    sha256 = hashlib.sha256(buf).hexdigest()
    try:
        rel_path = os.path.relpath(resolved_path, cwd).replace("\\", "/")
    except ValueError:
        rel_path = artifact_path

    return {
        "path": rel_path or artifact_path,
        "sha256": sha256,
        "sizeBytes": len(buf),
    }


def create_receipt(
    task: Dict[str, Any],
    signing_key: str,
    signer_identity: str,
    artifacts: Optional[List[Dict[str, Any]]] = None,
    key_id: Optional[str] = None,
    algorithm: str = "HMAC-SHA256",
    metadata: Optional[Dict[str, Any]] = None,
    cwd: Optional[str] = None,
    include_hostname: bool = False,
) -> Dict[str, Any]:
    """
    Generates a signed cryptographic proof receipt.
    """
    cwd = cwd or os.getcwd()
    ts_now = datetime.now(timezone.utc)
    proof_id = f"prf_{int(ts_now.timestamp()):x}_{os.urandom(6).hex()}"
    timestamp = ts_now.isoformat()

    # 1. Process Artifacts
    processed_artifacts = []
    if artifacts:
        for item in artifacts:
            art = hash_artifact(item["path"], item.get("data"), cwd)
            if "mimeType" in item:
                art["mimeType"] = item["mimeType"]
            processed_artifacts.append(art)

    # 2. Build Environment
    env_record: Dict[str, Any] = {
        "platform": platform.system().lower(),
        "arch": platform.machine().lower(),
        "runtime": f"python {platform.python_version()}",
    }
    if include_hostname:
        env_record["hostname"] = platform.node()
    git_ctx = get_git_context(cwd)
    if git_ctx:
        env_record["git"] = git_ctx

    # 3. Build Task Record
    task_record = {
        "name": task["name"],
        "runner": task.get("runner", "nymrel-agent"),
        "status": task.get("status", "SUCCESS"),
        "exitCode": task.get("exitCode", 0),
    }
    if "description" in task:
        task_record["description"] = task["description"]
    if "durationMs" in task:
        task_record["durationMs"] = task["durationMs"]
    if "command" in task:
        task_record["command"] = task["command"]

    # 4. Construct Merkle Leaves
    task_hash = canonical_hash(task_record)
    env_hash = canonical_hash(env_record)
    artifact_leaves = [a["sha256"] for a in processed_artifacts]

    raw_leaves = [task_hash, env_hash] + artifact_leaves
    merkle_tree = MerkleTree(raw_leaves, is_pre_hashed=True)
    merkle_root = merkle_tree.get_root()

    # 5. Sign the Proof Payload
    sign_payload_obj = {
        "proofId": proof_id,
        "timestamp": timestamp,
        "parentOrganization": "Nymrel -> JalenBuilds LLC",
        "taskName": task_record["name"],
        "merkleRoot": merkle_root,
    }

    resolved_key_id = key_id or ("ed25519-primary" if algorithm == "Ed25519" else "hmac-default")
    signature = ProofSigner.create_signature_record(
        sign_payload_obj,
        signing_key,
        signer_identity,
        resolved_key_id,
        algorithm,
    )

    return {
        "version": "1.0.0",
        "protocol": "nymrel-proof-ledger",
        "proofId": proof_id,
        "timestamp": timestamp,
        "parentOrganization": "Nymrel -> JalenBuilds LLC",
        "task": task_record,
        "environment": env_record,
        "artifacts": processed_artifacts,
        "merkle": {
            "algorithm": "SHA-256",
            "leaves": merkle_tree.get_leaves(),
            "root": merkle_root,
        },
        "signature": signature,
        "metadata": metadata or {},
    }


def verify_receipt(
    receipt: Dict[str, Any],
    public_key_or_secret: Optional[str] = None,
    check_files_on_disk: bool = False,
    cwd: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Verifies a proof receipt against mathematical Merkle invariants and cryptographic signature.
    """
    errors: List[str] = []
    warnings: List[str] = []
    cwd = cwd or os.getcwd()

    # 1. Protocol & Schema checks
    if receipt.get("protocol") != "nymrel-proof-ledger":
        errors.append(f"Invalid protocol identifier: expected 'nymrel-proof-ledger', got '{receipt.get('protocol')}'")
    if receipt.get("version") != "1.0.0":
        errors.append(f"Unsupported proof version: '{receipt.get('version')}'")
    if not receipt.get("proofId") or not receipt.get("merkle") or not receipt.get("signature"):
        errors.append("Malformed receipt structure: missing required core fields")

    # 2. Merkle Root Integrity
    task_hash = canonical_hash(receipt.get("task", {}))
    env_hash = canonical_hash(receipt.get("environment", {}))
    artifact_leaves = [a["sha256"] for a in receipt.get("artifacts", [])]
    expected_raw_leaves = [task_hash, env_hash] + artifact_leaves

    calculated_tree = MerkleTree(expected_raw_leaves, is_pre_hashed=True)
    calculated_root = calculated_tree.get_root()

    merkle_valid = True
    receipt_root = receipt.get("merkle", {}).get("root", "")
    if calculated_root.lower() != receipt_root.lower():
        merkle_valid = False
        errors.append(f"Merkle root mismatch! Expected '{receipt_root}', recalculated '{calculated_root}'")

    # 3. Artifact verification on disk
    artifacts_valid = True
    checked_artifacts = 0

    if check_files_on_disk and receipt.get("artifacts"):
        for art in receipt["artifacts"]:
            art_path = art["path"]
            full_path = art_path if os.path.isabs(art_path) else os.path.abspath(os.path.join(cwd, art_path))
            try:
                with open(full_path, "rb") as f:
                    actual_hash = hashlib.sha256(f.read()).hexdigest()
                checked_artifacts += 1
                if actual_hash.lower() != art["sha256"].lower():
                    artifacts_valid = False
                    errors.append(f"Artifact tampered: '{art_path}' (hash mismatch)")
            except Exception as e:
                artifacts_valid = False
                errors.append(f"Artifact missing on disk: '{art_path}' ({e})")

    # 4. Signature Verification
    signature_valid = True
    if public_key_or_secret:
        sign_payload_obj = {
            "proofId": receipt.get("proofId"),
            "timestamp": receipt.get("timestamp"),
            "parentOrganization": receipt.get("parentOrganization"),
            "taskName": receipt.get("task", {}).get("name"),
            "merkleRoot": receipt_root,
        }

        is_verified = ProofSigner.verify_signature(
            sign_payload_obj,
            receipt.get("signature", {}).get("value", ""),
            public_key_or_secret,
            receipt.get("signature", {}).get("algorithm", "HMAC-SHA256"),
        )

        if not is_verified:
            signature_valid = False
            errors.append("Cryptographic signature verification failed with provided key")
    else:
        warnings.append("Signature was not cryptographically verified (no public key / secret key provided)")

    valid = len(errors) == 0

    return {
        "valid": valid,
        "merkleValid": merkle_valid,
        "signatureValid": signature_valid,
        "artifactsValid": artifacts_valid,
        "errors": errors,
        "warnings": warnings,
        "checkedArtifacts": checked_artifacts,
        "receipt": receipt,
    }

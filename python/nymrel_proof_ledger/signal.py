"""Nymrel Signal customer-facing ProofReceipt attestation profile.

The profile binds Signal identifiers, disclosure/claim snapshots, evidence
references, and explicit attestation scopes as a normal Proof Ledger artifact.
It requires Proof Ledger v2 binding; legacy v1 core semantics remain unchanged.
"""

from datetime import datetime
import hashlib
import json
import re
from typing import Any, Dict, List, Optional

from .canonical import canonicalize
from .receipt import create_receipt, verify_receipt

SIGNAL_PROOF_PROFILE = "nymrel-signal-proof-receipt"
SIGNAL_PROOF_PROFILE_VERSION = "1.0.0"
SIGNAL_PROOF_BUNDLE_PROFILE = "nymrel-signal-proof-bundle"
SIGNAL_PROOF_BUNDLE_VERSION = "1.0.0"
SIGNAL_PROOF_ENVELOPE_PATH = "signal-proof-envelope.json"

SIGNAL_ATTESTED_SCOPES = (
    "artifact_integrity",
    "execution_observed",
    "timing_observed",
    "price_source_checked",
    "outcome_rubric_replayed",
    "identity_verified",
)

_DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
_ISO_TIMESTAMP_PATTERN = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$"
)
_ALLOWED_SCOPES = set(SIGNAL_ATTESTED_SCOPES)
_ALLOWED_OBSERVER_KINDS = {"self", "system", "independent"}
_ALLOWED_PRIVACY = {"public", "private", "restricted"}
_ENVELOPE_FIELDS = {
    "profile", "profileVersion", "signalReceiptId", "needDropId", "challengeId",
    "claimSnapshotDigest", "disclosureSnapshotDigest", "attestedScopes", "observer",
    "evaluator", "evidence", "limitations",
}
_OBSERVER_FIELDS = {"kind", "id", "observedAt", "method"}
_EVALUATOR_FIELDS = {"id", "version"}
_EVIDENCE_FIELDS = {"ref", "privacy", "digest"}


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _non_empty(value: Any) -> bool:
    return isinstance(value, str) and bool(re.search(r'[^\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', value))


def _is_digest(value: Any) -> bool:
    return isinstance(value, str) and bool(_DIGEST_PATTERN.fullmatch(value))


def _is_iso_timestamp(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    match = _ISO_TIMESTAMP_PATTERN.fullmatch(value)
    if match is None:
        return False
    year, month, day, hour, minute, second = (int(part) for part in match.groups()[:6])
    if not (
        year >= 1
        and 1 <= month <= 12
        and 0 <= hour <= 23
        and 0 <= minute <= 59
        and 0 <= second <= 59
    ):
        return False
    offset = match.group(7)
    if offset != "Z":
        offset_hour, offset_minute = (int(part) for part in offset[1:].split(":"))
        if offset_hour > 23 or offset_minute > 59:
            return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.tzinfo is not None and parsed.utcoffset() is not None
    except ValueError:
        return False


def _unknown_field_errors(value: Dict[str, Any], allowed: set[str], label: str) -> List[str]:
    return [f"Unknown {label} field: '{key}'" for key in value if key not in allowed]


def _normalize_artifact_path(value: str) -> str:
    value = value.replace("\\", "/")
    return value[2:] if value.startswith("./") else value


def _normalize_envelope(envelope: Dict[str, Any]) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {
        "profile": envelope["profile"],
        "profileVersion": envelope["profileVersion"],
        "signalReceiptId": envelope["signalReceiptId"].strip(),
        "claimSnapshotDigest": envelope["claimSnapshotDigest"].lower(),
        "disclosureSnapshotDigest": envelope["disclosureSnapshotDigest"].lower(),
        "attestedScopes": sorted(set(envelope["attestedScopes"])),
        "observer": {
            "kind": envelope["observer"]["kind"],
            "id": envelope["observer"]["id"].strip(),
            "observedAt": envelope["observer"]["observedAt"],
        },
        "evidence": [],
    }
    if envelope.get("needDropId"):
        normalized["needDropId"] = envelope["needDropId"].strip()
    if envelope.get("challengeId"):
        normalized["challengeId"] = envelope["challengeId"].strip()
    if envelope["observer"].get("method"):
        normalized["observer"]["method"] = envelope["observer"]["method"].strip()
    if envelope.get("evaluator"):
        normalized["evaluator"] = {
            "id": envelope["evaluator"]["id"].strip(),
            "version": envelope["evaluator"]["version"].strip(),
        }

    evidence = []
    for item in envelope.get("evidence", []):
        row = {"ref": item["ref"].strip(), "privacy": item["privacy"]}
        if item.get("digest"):
            row["digest"] = item["digest"].lower()
        evidence.append(row)
    normalized["evidence"] = sorted(
        evidence,
        key=lambda item: (item["ref"], item["privacy"], item.get("digest", "")),
    )

    if envelope.get("limitations") is not None:
        normalized["limitations"] = sorted(
            set(item.strip() for item in envelope["limitations"] if item.strip())
        )
    return normalized


def validate_signal_proof_envelope(value: Any) -> List[str]:
    """Returns profile validation errors without raising."""
    errors: List[str] = []
    if not _is_record(value):
        return ["Signal proof envelope must be an object"]

    errors.extend(_unknown_field_errors(value, _ENVELOPE_FIELDS, "Signal envelope"))

    if value.get("profile") != SIGNAL_PROOF_PROFILE:
        errors.append(f"Unsupported Signal profile: '{value.get('profile')}'")
    if value.get("profileVersion") != SIGNAL_PROOF_PROFILE_VERSION:
        errors.append(f"Unsupported Signal profile version: '{value.get('profileVersion')}'")
    if not _non_empty(value.get("signalReceiptId")):
        errors.append("signalReceiptId must be a non-empty string")
    if "needDropId" in value and not _non_empty(value.get("needDropId")):
        errors.append("needDropId must be a non-empty string when present")
    if "challengeId" in value and not _non_empty(value.get("challengeId")):
        errors.append("challengeId must be a non-empty string when present")
    if not _is_digest(value.get("claimSnapshotDigest")):
        errors.append("claimSnapshotDigest must use sha256:<64 lowercase hex> form")
    if not _is_digest(value.get("disclosureSnapshotDigest")):
        errors.append("disclosureSnapshotDigest must use sha256:<64 lowercase hex> form")

    scopes = value.get("attestedScopes")
    if not isinstance(scopes, list) or not scopes:
        errors.append("attestedScopes must contain at least one supported scope")
    else:
        seen = set()
        for scope in scopes:
            if not isinstance(scope, str) or scope not in _ALLOWED_SCOPES:
                errors.append(f"Unsupported attested scope: '{scope}'")
            elif scope in seen:
                errors.append(f"Duplicate attested scope: '{scope}'")
            if isinstance(scope, str):
                seen.add(scope)

    observer = value.get("observer")
    if not _is_record(observer):
        errors.append("observer must be an object")
    else:
        errors.extend(_unknown_field_errors(observer, _OBSERVER_FIELDS, "observer"))
        kind = observer.get("kind")
        if not isinstance(kind, str) or kind not in _ALLOWED_OBSERVER_KINDS:
            errors.append(f"Unsupported observer kind: '{observer.get('kind')}'")
        if not _non_empty(observer.get("id")):
            errors.append("observer.id must be a non-empty string")
        if not _is_iso_timestamp(observer.get("observedAt")):
            errors.append("observer.observedAt must be an ISO-8601 timestamp")
        if "method" in observer and not _non_empty(observer.get("method")):
            errors.append("observer.method must be a non-empty string when present")

    evaluator = value.get("evaluator")
    if "evaluator" in value:
        if not _is_record(evaluator):
            errors.append("evaluator must be an object when present")
        else:
            errors.extend(_unknown_field_errors(evaluator, _EVALUATOR_FIELDS, "evaluator"))
            if not _non_empty(evaluator.get("id")):
                errors.append("evaluator.id must be non-empty")
            if not _non_empty(evaluator.get("version")):
                errors.append("evaluator.version must be non-empty")

    evidence = value.get("evidence")
    if not isinstance(evidence, list):
        errors.append("evidence must be an array")
    else:
        for index, item in enumerate(evidence):
            if not _is_record(item):
                errors.append(f"evidence[{index}] must be an object")
                continue
            errors.extend(_unknown_field_errors(item, _EVIDENCE_FIELDS, f"evidence[{index}]"))
            if not _non_empty(item.get("ref")):
                errors.append(f"evidence[{index}].ref must be non-empty")
            privacy = item.get("privacy")
            if not isinstance(privacy, str) or privacy not in _ALLOWED_PRIVACY:
                errors.append(f"evidence[{index}].privacy is unsupported")
            if "digest" in item and not _is_digest(item.get("digest")):
                errors.append(f"evidence[{index}].digest must use sha256:<64 lowercase hex> form")

    limitations = value.get("limitations")
    if "limitations" in value:
        if not isinstance(limitations, list):
            errors.append("limitations must be an array when present")
        else:
            for index, item in enumerate(limitations):
                if not _non_empty(item):
                    errors.append(f"limitations[{index}] must be non-empty")

    return errors


def canonicalize_signal_proof_envelope(envelope: Dict[str, Any]) -> str:
    errors = validate_signal_proof_envelope(envelope)
    if errors:
        raise TypeError("; ".join(errors))
    return canonicalize(_normalize_envelope(envelope))


def digest_signal_proof_envelope(envelope: Dict[str, Any]) -> str:
    payload = canonicalize_signal_proof_envelope(envelope).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def _mirror_from_envelope(envelope: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _normalize_envelope(envelope)
    mirror: Dict[str, Any] = {
        "profile": normalized["profile"],
        "profileVersion": normalized["profileVersion"],
        "signalReceiptId": normalized["signalReceiptId"],
        "attestedScopes": normalized["attestedScopes"],
    }
    if normalized.get("needDropId"):
        mirror["needDropId"] = normalized["needDropId"]
    if normalized.get("challengeId"):
        mirror["challengeId"] = normalized["challengeId"]
    return mirror


def create_signal_proof_bundle(
    envelope: Dict[str, Any],
    task: Dict[str, Any],
    signing_key: str,
    signer_identity: str,
    artifacts: Optional[List[Dict[str, Any]]] = None,
    key_id: Optional[str] = None,
    algorithm: str = "HMAC-SHA256",
    metadata: Optional[Dict[str, Any]] = None,
    cwd: Optional[str] = None,
    include_hostname: bool = False,
    include_git_context: bool = False,
) -> Dict[str, Any]:
    """Creates a portable bundle with the Signal envelope bound as an artifact."""
    errors = validate_signal_proof_envelope(envelope)
    if errors:
        raise TypeError("; ".join(errors))

    for artifact in artifacts or []:
        if _normalize_artifact_path(artifact["path"]) == SIGNAL_PROOF_ENVELOPE_PATH:
            raise TypeError(
                f"Artifact path '{SIGNAL_PROOF_ENVELOPE_PATH}' is reserved by the Signal profile"
            )

    normalized = _normalize_envelope(envelope)
    envelope_data = canonicalize(normalized)
    receipt_metadata = dict(metadata or {})
    receipt_metadata["signalProfile"] = _mirror_from_envelope(normalized)

    receipt = create_receipt(
        task=task,
        artifacts=[
            {
                "path": SIGNAL_PROOF_ENVELOPE_PATH,
                "data": envelope_data,
                "mimeType": "application/json",
            }
        ] + list(artifacts or []),
        signing_key=signing_key,
        signer_identity=signer_identity,
        key_id=key_id,
        algorithm=algorithm,
        metadata=receipt_metadata,
        cwd=cwd,
        include_hostname=include_hostname,
        include_git_context=include_git_context,
    )

    return {
        "profile": SIGNAL_PROOF_BUNDLE_PROFILE,
        "bundleVersion": SIGNAL_PROOF_BUNDLE_VERSION,
        "envelope": normalized,
        "receipt": receipt,
    }


def _compare_mirror(receipt: Dict[str, Any], envelope: Dict[str, Any]) -> List[str]:
    mirror = receipt.get("metadata", {}).get("signalProfile")
    if mirror is None:
        return []
    if not _is_record(mirror):
        return ["receipt.metadata.signalProfile must be an object when present"]
    try:
        if canonicalize(mirror) != canonicalize(_mirror_from_envelope(envelope)):
            return [
                "Unbound receipt.metadata.signalProfile disagrees with the authoritative bound envelope"
            ]
        return []
    except (TypeError, ValueError):
        return ["receipt.metadata.signalProfile could not be canonicalized"]


def _does_not_prove(scopes: List[str]) -> List[str]:
    scope_set = set(scopes)
    boundaries = [
        "subjective product quality or universal customer fit",
        "testimonial neutrality or absence of bias",
        "signer identity or authority without an external trusted-key resolution policy",
    ]
    if "identity_verified" not in scope_set:
        boundaries.append("customer or participant identity")
    if "timing_observed" not in scope_set:
        boundaries.append("reported timing or duration")
    if "price_source_checked" not in scope_set:
        boundaries.append("current price or commercial terms")
    if "execution_observed" not in scope_set:
        boundaries.append("that the described execution occurred")
    if "outcome_rubric_replayed" not in scope_set:
        boundaries.append("that a qualitative outcome was independently reproduced")
    return boundaries


def _failed_core_verification() -> Dict[str, Any]:
    return {
        "valid": False,
        "trusted": False,
        "merkleValid": False,
        "signatureChecked": False,
        "signatureValid": None,
        "artifactsValid": False,
        "errors": ["Verification could not be completed safely"],
        "warnings": [],
        "checkedArtifacts": 0,
        "receipt": None,
    }


def _failed_signal_proof_verification() -> Dict[str, Any]:
    return {
        "valid": False,
        "structurallyValid": False,
        "profileValid": False,
        "envelopeBound": False,
        "signatureChecked": False,
        "signatureMode": "not_checked",
        "signerIdentityTrust": "unresolved",
        "core": _failed_core_verification(),
        "errors": ["Signal verification could not be completed safely"],
        "warnings": [],
        "authoritative": {
            "signalReceiptId": None,
            "needDropId": None,
            "challengeId": None,
            "attestedScopes": [],
            "publicEvidenceRefs": [],
            "nonPublicEvidenceCount": 0,
        },
        "doesNotProve": _does_not_prove([]),
    }


def _verify_signal_proof_bundle(
    bundle: Any,
    public_key_or_secret: Optional[str] = None,
    check_files_on_disk: bool = False,
    cwd: Optional[str] = None,
    *,
    expected_algorithm: Optional[str] = None,
) -> Dict[str, Any]:
    """Verifies core Proof Ledger integrity and the Signal-specific envelope binding."""
    errors: List[str] = []
    warnings: List[str] = []
    # Detach public input before validation so a dict subclass cannot change
    # fields between core verification and Signal admission.
    snapshot = json.loads(canonicalize(bundle))
    bundle_record = snapshot if _is_record(snapshot) else {}
    if not _is_record(snapshot):
        errors.append("Signal proof bundle must be an object")
    if bundle_record.get("profile") != SIGNAL_PROOF_BUNDLE_PROFILE:
        errors.append(f"Unsupported Signal bundle profile: '{bundle_record.get('profile')}'")
    if bundle_record.get("bundleVersion") != SIGNAL_PROOF_BUNDLE_VERSION:
        errors.append(f"Unsupported Signal bundle version: '{bundle_record.get('bundleVersion')}'")

    envelope = bundle_record.get("envelope")
    envelope_errors = validate_signal_proof_envelope(envelope)
    errors.extend(envelope_errors)
    profile_valid_before_binding = not errors

    try:
        core = verify_receipt(
            bundle_record.get("receipt"),
            public_key_or_secret=public_key_or_secret,
            check_files_on_disk=False,
            cwd=cwd,
            expected_algorithm=expected_algorithm,
        )
    except Exception:  # Public profile verification is total and fail-closed.
        core = _failed_core_verification()
    errors.extend("Proof Ledger: " + item for item in core.get("errors", []))
    warnings.extend("Proof Ledger: " + item for item in core.get("warnings", []))
    receipt = core['receipt']
    if receipt is not None and receipt['version'] != '2.0.0':
        errors.append('Signal requires Proof Ledger receipt version 2.0.0')

    envelope_bound = False
    normalized = None
    if profile_valid_before_binding and core['valid'] and core['merkleValid'] and receipt is not None and receipt['version'] == '2.0.0':
        try:
            normalized = _normalize_envelope(envelope)
            canonical_envelope = canonicalize(normalized)
            expected_hash = hashlib.sha256(canonical_envelope.encode("utf-8")).hexdigest()
            expected_size = len(canonical_envelope.encode("utf-8"))
            envelope_artifacts = [
                item
                for item in receipt['artifacts']
                if _normalize_artifact_path(item.get("path", "")) == SIGNAL_PROOF_ENVELOPE_PATH
            ]
            if len(envelope_artifacts) != 1:
                errors.append(
                    f"Signal bundle must bind exactly one '{SIGNAL_PROOF_ENVELOPE_PATH}' artifact; found {len(envelope_artifacts)}"
                )
            else:
                artifact = envelope_artifacts[0]
                if artifact.get("sha256", "").lower() != expected_hash:
                    errors.append("Bound Signal envelope digest does not match the portable envelope payload")
                elif artifact.get("sizeBytes") != expected_size:
                    errors.append("Bound Signal envelope size does not match the portable envelope payload")
                else:
                    envelope_bound = True
                if artifact.get("mimeType") and artifact.get("mimeType") != "application/json":
                    errors.append(
                        f"Signal envelope artifact has unexpected mimeType '{artifact.get('mimeType')}'"
                    )
            errors.extend(_compare_mirror(receipt, normalized))
        except (TypeError, ValueError, OverflowError, RecursionError, UnicodeError):
            normalized = None
            envelope_bound = False
            errors.append('Signal envelope or metadata mirror contains values outside canonical JSON')

    if check_files_on_disk:
        if not errors and envelope_bound and core['valid']:
            core = verify_receipt(receipt, public_key_or_secret=public_key_or_secret,
                                  expected_algorithm=expected_algorithm, check_files_on_disk=True, cwd=cwd)
            errors.extend('Proof Ledger: ' + item for item in core['errors'])
        else:
            message = 'Artifact disk checks skipped because Signal admission failed'
            core.update(artifactsValid=False, checkedArtifacts=0, valid=False, trusted=False)
            core['errors'].append(message)
            errors.append('Proof Ledger: ' + message)

    if core['errors']:
        envelope_bound = False
    signature_checked = core.get('signatureChecked', False)
    if not signature_checked:
        warnings.append(
            'Signal validity is not established because no verification key was supplied'
            if public_key_or_secret is None and expected_algorithm is None
            else 'Signal validity is not established because verification context or receipt validation prevented signature checking'
        )

    signature_mode = "not_checked"
    if signature_checked and core.get("signatureValid") and _is_record(receipt):
        signature_mode = (
            "asymmetric_signature"
            if receipt.get("signature", {}).get("algorithm") == "Ed25519"
            else "shared_secret_integrity"
        )

    profile_errors = [item for item in errors if not item.startswith("Proof Ledger:")]
    profile_valid = profile_valid_before_binding and not profile_errors
    structurally_valid = bool(
        envelope_bound
        and profile_valid
        and core.get("merkleValid")
        and core.get("artifactsValid")
        and not core.get("errors")
    )
    valid = bool(structurally_valid and core.get("trusted"))

    authoritative = normalized if valid else None
    evidence = authoritative.get("evidence", []) if authoritative else []
    scopes = authoritative.get("attestedScopes", []) if authoritative else []
    return {
        "valid": valid,
        "structurallyValid": structurally_valid,
        "profileValid": profile_valid,
        "envelopeBound": envelope_bound,
        "signatureChecked": signature_checked,
        "signatureMode": signature_mode,
        "signerIdentityTrust": "unresolved",
        "core": core,
        "errors": errors,
        "warnings": warnings,
        "authoritative": {
            "signalReceiptId": authoritative.get("signalReceiptId") if authoritative else None,
            "needDropId": authoritative.get("needDropId") if authoritative else None,
            "challengeId": authoritative.get("challengeId") if authoritative else None,
            "attestedScopes": scopes,
            "publicEvidenceRefs": [item["ref"] for item in evidence if item["privacy"] == "public"],
            "nonPublicEvidenceCount": len([item for item in evidence if item["privacy"] != "public"]),
        },
        "doesNotProve": _does_not_prove(scopes),
    }


def verify_signal_proof_bundle(
    bundle: Any,
    public_key_or_secret: Optional[str] = None,
    check_files_on_disk: bool = False,
    cwd: Optional[str] = None,
    *,
    expected_algorithm: Optional[str] = None,
) -> Dict[str, Any]:
    """Verifies a Signal bundle without raising for adversarial public input."""
    try:
        return _verify_signal_proof_bundle(
            bundle,
            public_key_or_secret=public_key_or_secret,
            check_files_on_disk=check_files_on_disk,
            cwd=cwd,
            expected_algorithm=expected_algorithm,
        )
    except Exception:
        return _failed_signal_proof_verification()

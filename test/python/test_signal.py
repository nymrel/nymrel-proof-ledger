import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python")))

from nymrel_proof_ledger.signal import (
    SIGNAL_PROOF_PROFILE,
    SIGNAL_PROOF_PROFILE_VERSION,
    canonicalize_signal_proof_envelope,
    create_signal_proof_bundle,
    digest_signal_proof_envelope,
    validate_signal_proof_envelope,
    verify_signal_proof_bundle,
)
from nymrel_proof_ledger.signer import ProofSigner


EXPECTED_FIXTURE_DIGEST = "sha256:dbad113cf71570d27242476d5d9fc9f21328d21d3ce5082f98d1fe7ce5436dcb"


def fixture_envelope():
    return {
        "profile": SIGNAL_PROOF_PROFILE,
        "profileVersion": SIGNAL_PROOF_PROFILE_VERSION,
        "signalReceiptId": "receipt-demo-001",
        "needDropId": "need-demo-001",
        "challengeId": "challenge-demo-001",
        "claimSnapshotDigest": "sha256:" + "a" * 64,
        "disclosureSnapshotDigest": "sha256:" + "b" * 64,
        "attestedScopes": ["execution_observed", "artifact_integrity"],
        "observer": {
            "kind": "system",
            "id": "signal-evaluator",
            "observedAt": "2026-08-21T22:00:00Z",
            "method": "screen-recorded run",
        },
        "evaluator": {
            "id": "rubric-v1",
            "version": "1.0.0",
        },
        "evidence": [
            {
                "ref": "artifact://output",
                "privacy": "public",
                "digest": "sha256:" + "c" * 64,
            },
            {
                "ref": "artifact://private-input",
                "privacy": "private",
                "digest": "sha256:" + "d" * 64,
            },
        ],
        "limitations": ["Fictional demonstration — not a customer result"],
    }


class TestSignalProofProfile(unittest.TestCase):
    def test_algorithm_context_cannot_be_chosen_by_bundle(self):
        public = ProofSigner.generate_key_pair()['publicKey']
        bundle = create_signal_proof_bundle(
            envelope=fixture_envelope(), task={'name': 'forged'},
            signing_key=public, signer_identity='victim', algorithm='HMAC-SHA256',
        )
        for options in ({'public_key_or_secret': public, 'expected_algorithm': 'Ed25519'}, {'public_key_or_secret': public}):
            result = verify_signal_proof_bundle(bundle, **options)
            self.assertFalse(result['valid'])
            self.assertFalse(result['signatureChecked'])

    def test_shared_unicode_whitespace(self):
        for value in ('\u001f', '\u0085', '\ufeff', '\u00a0'):
            envelope = fixture_envelope()
            envelope['signalReceiptId'] = value
            self.assertTrue(validate_signal_proof_envelope(envelope))

    def test_cross_language_fixture_digest(self):
        canonical = canonicalize_signal_proof_envelope(fixture_envelope())
        self.assertTrue(canonical.startswith("{"))
        self.assertEqual(digest_signal_proof_envelope(fixture_envelope()), EXPECTED_FIXTURE_DIGEST)

    def test_hmac_bundle_and_private_evidence_boundary(self):
        secret = ProofSigner.generate_secret_key()
        bundle = create_signal_proof_bundle(
            envelope=fixture_envelope(),
            task={"name": "Signal fictional challenge fixture", "status": "ATTESTED"},
            artifacts=[{"path": "output.txt", "data": "fictional output"}],
            signing_key=secret,
            signer_identity="signal-internal-verifier",
            algorithm="HMAC-SHA256",
        )

        self.assertEqual(bundle["receipt"]["artifacts"][0]["path"], "signal-proof-envelope.json")
        result = verify_signal_proof_bundle(bundle, expected_algorithm='HMAC-SHA256', public_key_or_secret=secret)

        self.assertTrue(result["valid"])
        self.assertTrue(result["structurallyValid"])
        self.assertTrue(result["envelopeBound"])
        self.assertEqual(result["signatureMode"], "shared_secret_integrity")
        self.assertEqual(result["signerIdentityTrust"], "unresolved")
        self.assertEqual(result["authoritative"]["publicEvidenceRefs"], ["artifact://output"])
        self.assertEqual(result["authoritative"]["nonPublicEvidenceCount"], 1)
        self.assertIn(
            "signer identity or authority without an external trusted-key resolution policy",
            result["doesNotProve"],
        )

    def test_unchecked_signature_is_not_valid(self):
        secret = ProofSigner.generate_secret_key()
        bundle = create_signal_proof_bundle(
            envelope=fixture_envelope(),
            task={"name": "Unchecked signature fixture"},
            signing_key=secret,
            signer_identity="signal-internal-verifier",
        )

        result = verify_signal_proof_bundle(bundle)
        self.assertFalse(result["valid"])
        self.assertTrue(result["structurallyValid"])
        self.assertFalse(result["signatureChecked"])
        self.assertEqual(result["signatureMode"], "not_checked")
        self.assertTrue(any("no verification key" in warning for warning in result["warnings"]))

    def test_asymmetric_verification_does_not_resolve_identity(self):
        keypair = ProofSigner.generate_key_pair()
        bundle = create_signal_proof_bundle(
            envelope=fixture_envelope(),
            task={"name": "Public verification fixture"},
            signing_key=keypair["privateKey"],
            signer_identity="declared-signal-verifier",
            algorithm="Ed25519",
        )

        result = verify_signal_proof_bundle(bundle, expected_algorithm='Ed25519', public_key_or_secret=keypair["publicKey"])
        self.assertTrue(result["valid"])
        self.assertEqual(result["signatureMode"], "asymmetric_signature")
        self.assertEqual(result["signerIdentityTrust"], "unresolved")

    def test_portable_envelope_tampering_is_detected(self):
        secret = ProofSigner.generate_secret_key()
        original = create_signal_proof_bundle(
            envelope=fixture_envelope(),
            task={"name": "Envelope tamper fixture"},
            signing_key=secret,
            signer_identity="signal-internal-verifier",
        )
        tampered = copy.deepcopy(original)
        tampered["envelope"]["signalReceiptId"] = "receipt-tampered"

        result = verify_signal_proof_bundle(tampered, expected_algorithm='HMAC-SHA256', public_key_or_secret=secret)
        self.assertTrue(result["core"]["valid"])
        self.assertFalse(result["valid"])
        self.assertFalse(result["envelopeBound"])
        self.assertTrue(any("digest does not match" in error for error in result["errors"]))

    def test_signed_metadata_mirror_disagreement_is_detected(self):
        secret = ProofSigner.generate_secret_key()
        original = create_signal_proof_bundle(
            envelope=fixture_envelope(),
            task={"name": "Metadata mirror fixture"},
            signing_key=secret,
            signer_identity="signal-internal-verifier",
        )
        tampered = copy.deepcopy(original)
        tampered["receipt"]["metadata"]["signalProfile"]["signalReceiptId"] = "metadata-only-tamper"

        result = verify_signal_proof_bundle(tampered, expected_algorithm='HMAC-SHA256', public_key_or_secret=secret)
        self.assertFalse(result["core"]["valid"])
        self.assertFalse(result["valid"])
        self.assertTrue(result["envelopeBound"])
        self.assertTrue(any("signature verification failed" in error for error in result["core"]["errors"]))
        self.assertTrue(any("disagrees" in error for error in result["errors"]))

    def test_unknown_version_and_reserved_path_fail_closed(self):
        unsupported = fixture_envelope()
        unsupported["profileVersion"] = "2.0.0"
        self.assertTrue(any("version" in error for error in validate_signal_proof_envelope(unsupported)))

        with self.assertRaisesRegex(TypeError, "reserved"):
            create_signal_proof_bundle(
                envelope=fixture_envelope(),
                task={"name": "Reserved artifact fixture"},
                artifacts=[{"path": "./signal-proof-envelope.json", "data": "{}"}],
                signing_key=ProofSigner.generate_secret_key(),
                signer_identity="signal-internal-verifier",
            )

    def test_validator_rejects_uppercase_digests_and_unknown_nested_fields(self):
        envelope = fixture_envelope()
        envelope["claimSnapshotDigest"] = "sha256:" + "A" * 64
        envelope["unreviewedClaim"] = {"claim": "must not be dropped"}
        envelope["observer"]["unreviewedObserverClaim"] = True
        envelope["evaluator"]["unreviewedEvaluatorClaim"] = True
        envelope["evidence"][0]["unreviewedEvidenceClaim"] = True

        errors = validate_signal_proof_envelope(envelope)

        self.assertIn("claimSnapshotDigest must use sha256:<64 lowercase hex> form", errors)
        self.assertEqual(
            [error for error in errors if error.startswith("Unknown")],
            [
                "Unknown Signal envelope field: 'unreviewedClaim'",
                "Unknown observer field: 'unreviewedObserverClaim'",
                "Unknown evaluator field: 'unreviewedEvaluatorClaim'",
                "Unknown evidence[0] field: 'unreviewedEvidenceClaim'",
            ],
        )

    def test_validator_never_raises_for_unhashable_scope_kind_or_privacy(self):
        envelope = fixture_envelope()
        envelope["attestedScopes"] = [["execution_observed"]]
        envelope["observer"]["kind"] = []
        envelope["evidence"][0]["privacy"] = {}

        errors = validate_signal_proof_envelope(envelope)

        self.assertTrue(any(error.startswith("Unsupported attested scope") for error in errors))
        self.assertTrue(any(error.startswith("Unsupported observer kind") for error in errors))
        self.assertIn("evidence[0].privacy is unsupported", errors)

    def test_timestamp_requires_a_real_calendar_date_and_offset(self):
        for timestamp in ["2026-08-21T22:00:00", "2026-02-30T22:00:00Z"]:
            envelope = fixture_envelope()
            envelope["observer"]["observedAt"] = timestamp
            self.assertIn(
                "observer.observedAt must be an ISO-8601 timestamp",
                validate_signal_proof_envelope(envelope),
            )

        valid_offset = fixture_envelope()
        valid_offset["observer"]["observedAt"] = "2026-02-28T22:00:00.123+05:30"
        self.assertNotIn(
            "observer.observedAt must be an ISO-8601 timestamp",
            validate_signal_proof_envelope(valid_offset),
        )


if __name__ == "__main__":
    unittest.main()

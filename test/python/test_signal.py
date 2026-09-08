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
        result = verify_signal_proof_bundle(bundle, public_key_or_secret=secret)

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

        result = verify_signal_proof_bundle(bundle, public_key_or_secret=keypair["publicKey"])
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

        result = verify_signal_proof_bundle(tampered, public_key_or_secret=secret)
        self.assertTrue(result["core"]["valid"])
        self.assertFalse(result["valid"])
        self.assertFalse(result["envelopeBound"])
        self.assertTrue(any("digest does not match" in error for error in result["errors"]))

    def test_unbound_metadata_mirror_disagreement_is_detected(self):
        secret = ProofSigner.generate_secret_key()
        original = create_signal_proof_bundle(
            envelope=fixture_envelope(),
            task={"name": "Metadata mirror fixture"},
            signing_key=secret,
            signer_identity="signal-internal-verifier",
        )
        tampered = copy.deepcopy(original)
        tampered["receipt"]["metadata"]["signalProfile"]["signalReceiptId"] = "metadata-only-tamper"

        result = verify_signal_proof_bundle(tampered, public_key_or_secret=secret)
        self.assertTrue(result["core"]["valid"])
        self.assertFalse(result["valid"])
        self.assertTrue(result["envelopeBound"])
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


if __name__ == "__main__":
    unittest.main()

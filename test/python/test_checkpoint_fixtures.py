"""Existing primitive compatibility for a design draft, not a profile verifier."""

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))

from nymrel_proof_ledger.canonical import canonical_hash, canonicalize
from nymrel_proof_ledger.receipt import verify_receipt


FIXTURE = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures/checkpoint-v0.1-vectors.json")
    .read_text(encoding="utf-8")
)


class CheckpointFixtureTests(unittest.TestCase):
    def verify(self, receipt, key=None):
        if key is None:
            return verify_receipt(receipt)
        return verify_receipt(
            receipt, expected_algorithm="Ed25519", public_key_or_secret=key,
        )

    def test_shared_canonical_checkpoint_and_trust_bundle_pins(self):
        self.assertEqual(canonicalize(FIXTURE["checkpoint"]), FIXTURE["checkpointCanonical"])
        self.assertEqual(
            "sha256:" + canonical_hash(FIXTURE["checkpoint"]), FIXTURE["checkpointDigest"],
        )
        for item in FIXTURE["trustBundles"]:
            with self.subTest(name=item["name"]):
                self.assertEqual(canonicalize(item["bundle"]), item["canonical"])
                self.assertEqual("sha256:" + canonical_hash(item["bundle"]), item["digest"])

    def test_existing_v2_receipt_authenticates_with_external_public_key(self):
        receipt = FIXTURE["receipt"]
        result = self.verify(receipt, FIXTURE["publicKey"])
        self.assertEqual(receipt["version"], "2.0.0")
        for field in ("valid", "trusted", "signatureChecked", "signatureValid"):
            self.assertIs(result[field], True)
        self.assertEqual(result["checkedArtifacts"], 0)
        for field in ("signerIdentity", "keyId"):
            self.assertEqual(receipt["signature"][field], FIXTURE["checkpoint"][field])
        self.assertEqual(receipt["artifacts"], [{
            "path": "checkpoint.json",
            "sha256": FIXTURE["checkpointDigest"][len("sha256:"):],
            "sizeBytes": len(FIXTURE["checkpointCanonical"].encode("utf-8")),
            "mimeType": "application/json",
        }])

    def test_integrity_only_is_untrusted_and_wrong_key_is_rejected(self):
        integrity = self.verify(FIXTURE["receipt"])
        self.assertIs(integrity["valid"], True)
        self.assertIs(integrity["trusted"], False)
        self.assertIs(integrity["signatureChecked"], False)
        wrong = self.verify(FIXTURE["receipt"], FIXTURE["wrongPublicKey"])
        self.assertIs(wrong["signatureChecked"], True)
        for field in ("valid", "trusted", "signatureValid"):
            self.assertIs(wrong[field], False)

    def test_detached_checkpoint_changes_need_profile_binding(self):
        changed_checkpoint = {**FIXTURE["checkpoint"], "eventCount": 1, "highestSequence": 0}
        digest = canonical_hash(changed_checkpoint)
        self.assertNotEqual(digest, FIXTURE["receipt"]["artifacts"][0]["sha256"])
        # Core receipt verification cannot validate a separate profile object.
        self.assertIs(self.verify(FIXTURE["receipt"], FIXTURE["publicKey"])["trusted"], True)
        changed_receipt = copy.deepcopy(FIXTURE["receipt"])
        changed_receipt["artifacts"][0]["sha256"] = digest
        result = self.verify(changed_receipt, FIXTURE["publicKey"])
        self.assertIs(result["valid"], False)
        self.assertIs(result["trusted"], False)
        self.assertIs(result["signatureValid"], True)
        self.assertIs(result["merkleValid"], False)

    def test_signed_metadata_tamper_and_bundle_policy_pin_change(self):
        changed_receipt = copy.deepcopy(FIXTURE["receipt"])
        changed_receipt["metadata"] = {"injected": True}
        result = self.verify(changed_receipt, FIXTURE["publicKey"])
        self.assertIs(result["signatureValid"], False)
        self.assertIs(result["trusted"], False)
        active = next(item for item in FIXTURE["trustBundles"] if item["name"] == "active")
        changed_bundle = {**active["bundle"], "revision": 999}
        self.assertNotEqual("sha256:" + canonical_hash(changed_bundle), active["digest"])


if __name__ == "__main__":
    unittest.main()

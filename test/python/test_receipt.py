import json
import os
import sys
import unittest

sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python"))
)

from nymrel_proof_ledger.receipt import (
    create_receipt,
    sanitize_git_remote,
    verify_receipt,
)
from nymrel_proof_ledger.signer import ProofSigner

FIXTURE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "fixtures", "protocol-v2-vectors.json"
)
with open(FIXTURE_PATH, encoding="utf-8") as fixture_file:
    VECTORS = json.load(fixture_file)


class TestReceipt(unittest.TestCase):
    def test_create_and_trust_v2_receipt(self):
        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "Python Suite", "status": "SUCCESS"},
            signing_key=secret,
            signer_identity="nymrel-python",
            artifacts=[
                {"path": "test.txt", "data": "content", "mimeType": "text/plain"}
            ],
        )
        self.assertEqual(receipt["version"], "2.0.0")
        self.assertEqual(receipt["parentOrganization"], "Nymrel")
        self.assertEqual(receipt["merkle"]["algorithm"], "RFC6962-SHA256")
        result = verify_receipt(receipt, expected_algorithm='HMAC-SHA256', public_key_or_secret=secret)
        self.assertTrue(result["valid"])
        self.assertTrue(result["trusted"])
        self.assertTrue(result["merkleValid"])
        self.assertTrue(result["signatureChecked"])
        self.assertTrue(result["signatureValid"])

    def test_integrity_only_is_not_trusted(self):
        receipt = create_receipt(
            task={"name": "Integrity Only"},
            signing_key=ProofSigner.generate_secret_key(),
            signer_identity="nymrel-python",
        )
        result = verify_receipt(receipt)
        self.assertTrue(result["valid"])
        self.assertFalse(result["trusted"])
        self.assertFalse(result["signatureChecked"])
        self.assertIsNone(result["signatureValid"])
        self.assertIn("not cryptographically verified", result["warnings"][0])

    def test_tamper_detection(self):
        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "Audit Task"},
            signing_key=secret,
            signer_identity="auditor",
            artifacts=[{"path": "data.csv", "data": "a,b,c"}],
        )
        tampered = json.loads(json.dumps(receipt))
        tampered["artifacts"][0]["path"] = "renamed.csv"
        result = verify_receipt(tampered, expected_algorithm='HMAC-SHA256', public_key_or_secret=secret)
        self.assertFalse(result["valid"])
        self.assertFalse(result["merkleValid"])

        metadata_tamper = json.loads(json.dumps(receipt))
        metadata_tamper["metadata"]["claim"] = "rewritten"
        metadata_result = verify_receipt(metadata_tamper, expected_algorithm='HMAC-SHA256', public_key_or_secret=secret)
        self.assertTrue(metadata_result["merkleValid"])
        self.assertFalse(metadata_result["signatureValid"])

        identity_tamper = json.loads(json.dumps(receipt))
        identity_tamper["signature"]["signerIdentity"] = "impostor"
        identity_result = verify_receipt(identity_tamper, expected_algorithm='HMAC-SHA256', public_key_or_secret=secret)
        self.assertFalse(identity_result["signatureValid"])

    def test_legacy_v1_vector_verifies(self):
        vector = VECTORS["legacyV1"]
        result = verify_receipt(
            vector["receipt"], expected_algorithm='HMAC-SHA256', public_key_or_secret=vector["secret"]
        )
        self.assertTrue(result["valid"], result["errors"])
        self.assertTrue(result["trusted"])
        self.assertTrue(result["merkleValid"])
        self.assertTrue(result["signatureValid"])

    def test_shared_cross_runtime_v2_vector_verifies(self):
        vector = VECTORS["protocolV2"]
        result = verify_receipt(
            vector["receipt"], expected_algorithm='HMAC-SHA256', public_key_or_secret=vector["secret"]
        )
        self.assertTrue(result["trusted"], result["errors"])
        self.assertTrue(result["merkleValid"])
        self.assertTrue(result["signatureValid"])

    def test_raw_hex_ed25519_receipt(self):
        keypair = ProofSigner.generate_key_pair()
        receipt = create_receipt(
            task={"name": "Ed25519"},
            signing_key=keypair["privateKey"],
            signer_identity="governance",
            algorithm="Ed25519",
        )
        result = verify_receipt(receipt, expected_algorithm='Ed25519', public_key_or_secret=keypair["publicKey"])
        self.assertTrue(result["trusted"])

    def test_remote_sanitization_and_artifact_traversal(self):
        self.assertEqual(
            sanitize_git_remote(
                "https://user:token@github.com/nymrel/repo.git?token=also#fragment"
            ),
            "https://github.com/nymrel/repo.git",
        )
        self.assertIsNone(sanitize_git_remote(r"C:\private\repo"))

        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "Traversal Guard"},
            signing_key=secret,
            signer_identity="nymrel-python",
            artifacts=[{"path": "../outside.txt", "data": "not written"}],
        )
        result = verify_receipt(
            receipt,
            expected_algorithm='HMAC-SHA256', public_key_or_secret=secret,
            check_files_on_disk=True,
        )
        self.assertTrue(result["merkleValid"])
        self.assertFalse(result["artifactsValid"])
        self.assertIn("escapes verification root", "\n".join(result["errors"]))

    def test_malformed_envelope_fails_before_crypto(self):
        result = verify_receipt({"protocol": "nymrel-proof-ledger"})
        self.assertFalse(result["valid"])
        self.assertIsNone(result["receipt"])
        self.assertIn("Envelope VERSION_MISSING", result["errors"][0])


if __name__ == "__main__":
    unittest.main()

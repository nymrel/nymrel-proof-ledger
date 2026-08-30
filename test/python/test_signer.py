import json
import os
import sys
import unittest

sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python"))
)

from nymrel_proof_ledger.signer import ProofSigner

FIXTURE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "fixtures", "protocol-v2-vectors.json"
)
with open(FIXTURE_PATH, encoding="utf-8") as fixture_file:
    ED25519_VECTOR = json.load(fixture_file)["ed25519"]


class TestSigner(unittest.TestCase):
    def test_hmac_signing(self):
        secret = ProofSigner.generate_secret_key()
        payload = {"task": "Verify Suite", "root": "abc123"}
        signature = ProofSigner.sign_payload(payload, secret)
        self.assertEqual(len(signature), 64)
        self.assertTrue(ProofSigner.verify_signature(payload, signature, secret))
        self.assertFalse(ProofSigner.verify_signature(payload, "zz", secret))

    def test_rfc8032_vector_one(self):
        signature = ProofSigner.sign_payload(
            ED25519_VECTOR["message"],
            ED25519_VECTOR["secretKey"],
            "Ed25519",
        )
        self.assertEqual(signature, ED25519_VECTOR["signature"])
        self.assertTrue(
            ProofSigner.verify_signature(
                ED25519_VECTOR["message"],
                signature,
                ED25519_VECTOR["publicKey"],
                "Ed25519",
            )
        )

    def test_raw_hex_key_generation(self):
        keypair = ProofSigner.generate_key_pair()
        self.assertEqual(keypair["encoding"], "raw-hex")
        self.assertEqual(len(keypair["privateKey"]), 64)
        self.assertEqual(len(keypair["publicKey"]), 64)
        signature = ProofSigner.sign_payload(
            {"proof": 1}, keypair["privateKey"], "Ed25519"
        )
        self.assertTrue(
            ProofSigner.verify_signature(
                {"proof": 1}, signature, keypair["publicKey"], "Ed25519"
            )
        )

    def test_invalid_ed25519_material_fails_closed(self):
        with self.assertRaises(ValueError):
            ProofSigner.sign_payload("payload", "not-a-private-key", "Ed25519")
        self.assertFalse(
            ProofSigner.verify_signature(
                "payload", "00" * 64, "not-a-public-key", "Ed25519"
            )
        )


if __name__ == "__main__":
    unittest.main()

import unittest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python")))

from nymrel_proof_ledger.signer import ProofSigner


class TestSigner(unittest.TestCase):
    def test_hmac_signing(self):
        secret = ProofSigner.generate_secret_key()
        self.assertEqual(len(secret), 64)

        payload = {"task": "Verify Suite", "timestamp": "2026-08-21T12:00:00Z", "root": "abc123"}
        signature = ProofSigner.sign_payload(payload, secret, "HMAC-SHA256")
        self.assertEqual(len(signature), 64)

        is_valid = ProofSigner.verify_signature(payload, signature, secret, "HMAC-SHA256")
        self.assertTrue(is_valid)

        is_invalid = ProofSigner.verify_signature(payload, signature, "wrong-key", "HMAC-SHA256")
        self.assertFalse(is_invalid)

    def test_ed25519_signing_pure(self):
        kp = ProofSigner.generate_key_pair()
        self.assertEqual(kp["algorithm"], "Ed25519")
        self.assertEqual(len(kp["privateKey"]), 64)
        self.assertEqual(len(kp["publicKey"]), 64)

        payload = {"proofId": "prf_123", "root": "8f7e3a9c"}
        signature = ProofSigner.sign_payload(payload, kp["privateKey"], "Ed25519")
        self.assertEqual(len(signature), 128)  # 64 bytes in hex = 128 chars

        is_valid = ProofSigner.verify_signature(payload, signature, kp["publicKey"], "Ed25519")
        self.assertTrue(is_valid)

        other_kp = ProofSigner.generate_key_pair()
        is_invalid = ProofSigner.verify_signature(payload, signature, other_kp["publicKey"], "Ed25519")
        self.assertFalse(is_invalid)


if __name__ == "__main__":
    unittest.main()

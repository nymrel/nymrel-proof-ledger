import unittest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python")))

from nymrel_proof_ledger.receipt import create_receipt, verify_receipt
from nymrel_proof_ledger.signer import ProofSigner


class TestReceipt(unittest.TestCase):
    def test_create_and_verify_receipt(self):
        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "Python Suite", "status": "SUCCESS"},
            signing_key=secret,
            signer_identity="nymrel-python-bot",
            artifacts=[{"path": "test.txt", "data": "content data"}],
        )

        self.assertEqual(receipt["protocol"], "nymrel-proof-ledger")
        self.assertEqual(receipt["version"], "1.0.0")
        self.assertEqual(receipt["parentOrganization"], "Nymrel -> JalenBuilds LLC")
        self.assertEqual(len(receipt["merkle"]["root"]), 64)

        result = verify_receipt(receipt, public_key_or_secret=secret)
        self.assertTrue(result["valid"])
        self.assertTrue(result["merkleValid"])
        self.assertTrue(result["signatureValid"])
        self.assertEqual(len(result["errors"]), 0)

    def test_tamper_detection(self):
        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "Audit Task", "status": "SUCCESS"},
            signing_key=secret,
            signer_identity="auditor",
            artifacts=[{"path": "data.csv", "data": "a,b,c"}],
        )

        # Modify task name
        tampered = dict(receipt)
        tampered["task"] = dict(receipt["task"])
        tampered["task"]["name"] = "Altered Task"

        result = verify_receipt(tampered, public_key_or_secret=secret)
        self.assertFalse(result["valid"])
        self.assertFalse(result["merkleValid"])


if __name__ == "__main__":
    unittest.main()

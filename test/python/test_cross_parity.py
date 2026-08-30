import json
import os
import sys
import unittest

sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python"))
)

from nymrel_proof_ledger.canonical import canonical_hash, canonicalize
from nymrel_proof_ledger.merkle import MerkleTree
from nymrel_proof_ledger.signer import ProofSigner

FIXTURE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "fixtures", "protocol-v2-vectors.json"
)
with open(FIXTURE_PATH, encoding="utf-8") as fixture_file:
    VECTORS = json.load(fixture_file)


class TestCrossLanguageParity(unittest.TestCase):
    def test_rfc8785_shared_vectors(self):
        canonical = VECTORS["canonical"]
        self.assertEqual(
            canonicalize(canonical["sample"]), canonical["sampleCanonical"]
        )
        self.assertEqual(
            canonicalize(canonical["numeric"]), canonical["numericCanonical"]
        )
        self.assertEqual(
            canonicalize({"דּ": "hebrew", "😀": "emoji", "€": "euro"}),
            '{"€":"euro","😀":"emoji","דּ":"hebrew"}',
        )

    def test_rfc6962_shared_vectors(self):
        vector = VECTORS["merkle"]
        self.assertEqual(MerkleTree().get_root(), vector["emptyRoot"])
        tree = MerkleTree(vector["items"])
        self.assertEqual(tree.get_leaves(), vector["leaves"])
        self.assertEqual(tree.get_root(), vector["threeLeafRoot"])

    def test_hmac_is_deterministic_over_jcs(self):
        secret = "0123456789abcdef" * 4
        payload = {"merkleRoot": "1234", "task": "Parity"}
        signature = ProofSigner.sign_payload(payload, secret)
        self.assertTrue(ProofSigner.verify_signature(payload, signature, secret))
        self.assertEqual(len(canonical_hash(payload)), 64)


if __name__ == "__main__":
    unittest.main()

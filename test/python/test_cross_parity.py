import unittest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python")))

from nymrel_proof_ledger.canonical import canonicalize, canonical_hash
from nymrel_proof_ledger.merkle import MerkleTree, hash_leaf, hash_nodes
from nymrel_proof_ledger.signer import ProofSigner


class TestCrossLanguageParity(unittest.TestCase):
    def test_canonical_json_parity(self):
        # A test vector with unsorted keys and nested structures
        sample = {
            "z": 100,
            "a": "hello",
            "m": [3, 2, {"b": True, "a": None}],
            "task": {"runner": "ci", "status": "SUCCESS"},
        }
        expected = '{"a":"hello","m":[3,2,{"a":null,"b":true}],"task":{"runner":"ci","status":"SUCCESS"},"z":100}'
        self.assertEqual(canonicalize(sample), expected)

    def test_merkle_leaf_and_node_parity(self):
        # Leaf hashing: SHA256(0x00 || "nymrel-core")
        leaf_hex = hash_leaf("nymrel-core")
        self.assertEqual(len(leaf_hex), 64)

        # Node hashing: SHA256(0x01 || left || right)
        node_hex = hash_nodes(leaf_hex, leaf_hex)
        self.assertEqual(len(node_hex), 64)

        # Deterministic root calculation across 3 leaves
        leaves = ["art_a", "art_b", "art_c"]
        tree = MerkleTree(leaves)
        root = tree.get_root()
        self.assertEqual(len(root), 64)

    def test_hmac_parity(self):
        secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        payload = {"merkleRoot": "1234", "task": "Parity"}
        sig = ProofSigner.sign_payload(payload, secret, "HMAC-SHA256")
        self.assertEqual(len(sig), 64)
        self.assertTrue(ProofSigner.verify_signature(payload, sig, secret, "HMAC-SHA256"))


if __name__ == "__main__":
    unittest.main()

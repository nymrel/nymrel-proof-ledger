import json
import os
import sys
import unittest

sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python"))
)

from nymrel_proof_ledger.merkle import MerkleTree, hash_leaf, hash_nodes

FIXTURE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "fixtures", "protocol-v2-vectors.json"
)
with open(FIXTURE_PATH, encoding="utf-8") as fixture_file:
    VECTORS = json.load(fixture_file)["merkle"]


class TestMerkleTree(unittest.TestCase):
    def test_rfc_vectors(self):
        self.assertEqual(MerkleTree().get_root(), VECTORS["emptyRoot"])
        tree = MerkleTree(VECTORS["items"])
        self.assertEqual(tree.get_leaves(), VECTORS["leaves"])
        self.assertEqual(tree.get_root(), VECTORS["threeLeafRoot"])

    def test_odd_node_proofs(self):
        tree = MerkleTree(VECTORS["items"])
        self.assertEqual(len(tree.get_proof(2)), 1)
        for index, leaf in enumerate(tree.get_leaves()):
            self.assertTrue(
                MerkleTree.verify_proof(leaf, tree.get_proof(index), tree.get_root())
            )

    def test_legacy_profile_is_explicit(self):
        modern = MerkleTree(VECTORS["items"])
        legacy = MerkleTree(VECTORS["items"], profile="legacy-duplicated")
        self.assertNotEqual(modern.get_root(), legacy.get_root())
        self.assertEqual(len(legacy.get_proof(2)), 2)

    def test_hash_validation_fails_closed(self):
        with self.assertRaises(ValueError):
            hash_leaf("not-hex", is_hex=True)
        with self.assertRaises(ValueError):
            hash_nodes("00", "11")
        tree = MerkleTree(["a", "b"])
        self.assertFalse(
            MerkleTree.verify_proof(
                tree.get_leaves()[0],
                [{"position": "right", "hash": "zz"}],
                tree.get_root(),
            )
        )

    def test_domain_separation(self):
        leaf = hash_leaf("hello")
        self.assertNotEqual(leaf, hash_nodes(leaf, leaf))


if __name__ == "__main__":
    unittest.main()

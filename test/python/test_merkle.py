import unittest
import sys
import os

# Add python directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python")))

from nymrel_proof_ledger.merkle import MerkleTree, hash_leaf, hash_nodes


class TestMerkleTree(unittest.TestCase):
    def test_domain_separation(self):
        leaf = hash_leaf("hello")
        interior = hash_nodes(leaf, leaf)
        self.assertEqual(len(leaf), 64)
        self.assertEqual(len(interior), 64)
        self.assertNotEqual(leaf, interior)

    def test_deterministic_roots(self):
        items = ["art1", "art2", "art3", "art4"]
        t1 = MerkleTree(items)
        t2 = MerkleTree(items)
        self.assertEqual(t1.get_root(), t2.get_root())
        self.assertEqual(len(t1.get_leaves()), 4)

    def test_odd_leaves(self):
        items = ["a", "b", "c"]
        tree = MerkleTree(items)
        self.assertEqual(len(tree.get_leaves()), 3)
        self.assertEqual(len(tree.get_root()), 64)

    def test_audit_proofs(self):
        items = ["leaf0", "leaf1", "leaf2", "leaf3", "leaf4"]
        tree = MerkleTree(items)
        root = tree.get_root()
        leaves = tree.get_leaves()

        for i, leaf in enumerate(leaves):
            proof = tree.get_proof(i)
            self.assertTrue(len(proof) > 0)
            is_valid = MerkleTree.verify_proof(leaf, proof, root)
            self.assertTrue(is_valid, f"Failed verifying leaf index {i}")

    def test_tamper_detection(self):
        items = ["alpha", "beta"]
        tree = MerkleTree(items)
        root = tree.get_root()
        proof = tree.get_proof(0)

        fake_leaf = hash_leaf("tampered")
        self.assertFalse(MerkleTree.verify_proof(fake_leaf, proof, root))


if __name__ == "__main__":
    unittest.main()

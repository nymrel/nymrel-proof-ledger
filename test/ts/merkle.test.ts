import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MerkleTree, hashLeaf, hashNodes } from '../../src/core/merkle.js';

describe('RFC 6962 Domain-Separated Merkle Tree', () => {
  it('applies domain separation prefixes to prevent second-preimage attacks', () => {
    const leaf = hashLeaf('hello');
    assert.match(leaf, /^[0-9a-f]{64}$/);

    const interior = hashNodes(leaf, leaf);
    assert.match(interior, /^[0-9a-f]{64}$/);
    assert.notStrictEqual(leaf, interior);
  });

  it('calculates deterministic roots for various leaf counts', () => {
    const data = ['artifact-1', 'artifact-2', 'artifact-3', 'artifact-4'];
    const tree1 = new MerkleTree(data);
    const tree2 = new MerkleTree(data);

    assert.strictEqual(tree1.getRoot(), tree2.getRoot());
    assert.strictEqual(tree1.getLeaves().length, 4);
    assert.strictEqual(tree1.getLayers().length, 3); // 4 leaves -> 2 interior -> 1 root
  });

  it('correctly balances odd number of leaves deterministically', () => {
    const data3 = ['a', 'b', 'c'];
    const tree = new MerkleTree(data3);
    assert.strictEqual(tree.getLeaves().length, 3);
    assert.match(tree.getRoot(), /^[0-9a-f]{64}$/);
  });

  it('generates and verifies valid audit paths (Merkle Proofs)', () => {
    const items = ['leaf-0', 'leaf-1', 'leaf-2', 'leaf-3', 'leaf-4'];
    const tree = new MerkleTree(items);
    const root = tree.getRoot();
    const leaves = tree.getLeaves();

    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.getProof(i);
      assert.ok(proof.length > 0);
      const isValid = MerkleTree.verifyProof(leaves[i], proof, root);
      assert.strictEqual(isValid, true, `Proof verification failed for leaf index ${i}`);
    }
  });

  it('rejects tampered leaves and invalid proofs', () => {
    const items = ['alpha', 'beta', 'gamma'];
    const tree = new MerkleTree(items);
    const root = tree.getRoot();
    const leaves = tree.getLeaves();

    const proof0 = tree.getProof(0);
    const fakeLeaf = hashLeaf('tampered-alpha');

    const isValid = MerkleTree.verifyProof(fakeLeaf, proof0, root);
    assert.strictEqual(isValid, false);

    // Corrupt proof step hash
    const corruptedProof = [{ ...proof0[0], hash: '0000000000000000000000000000000000000000000000000000000000000000' }];
    assert.strictEqual(MerkleTree.verifyProof(leaves[0], corruptedProof, root), false);
  });

  it('handles empty trees safely', () => {
    const emptyTree = new MerkleTree([]);
    assert.match(emptyTree.getRoot(), /^[0-9a-f]{64}$/);
    assert.strictEqual(emptyTree.getLeaves().length, 0);
  });
});

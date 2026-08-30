import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { MerkleTree, hashLeaf, hashNodes } from '../../src/core/merkle.js';

interface MerkleVectors {
  merkle: {
    items: string[];
    emptyRoot: string;
    leaves: string[];
    threeLeafRoot: string;
  };
}

const vectors = JSON.parse(
  readFileSync('test/fixtures/protocol-v2-vectors.json', 'utf8')
) as MerkleVectors;

describe('RFC 6962 Merkle Tree', () => {
  it('matches the RFC empty-tree and three-leaf shared vectors', () => {
    assert.strictEqual(new MerkleTree().getRoot(), vectors.merkle.emptyRoot);
    const tree = new MerkleTree(vectors.merkle.items);
    assert.deepStrictEqual(tree.getLeaves(), vectors.merkle.leaves);
    assert.strictEqual(tree.getRoot(), vectors.merkle.threeLeafRoot);
  });

  it('promotes odd nodes and produces valid RFC audit paths', () => {
    const tree = new MerkleTree(vectors.merkle.items);
    const leaves = tree.getLeaves();
    assert.strictEqual(tree.getProof(2).length, 1);
    leaves.forEach((leaf, index) => {
      assert.strictEqual(
        MerkleTree.verifyProof(leaf, tree.getProof(index), tree.getRoot()),
        true
      );
    });
  });

  it('retains duplicated-odd v1 roots only behind the legacy profile', () => {
    const modern = new MerkleTree(vectors.merkle.items);
    const legacy = new MerkleTree(vectors.merkle.items, { profile: 'legacy-duplicated' });
    assert.notStrictEqual(modern.getRoot(), legacy.getRoot());
    assert.strictEqual(legacy.getProof(2).length, 2);
  });

  it('enforces exact hash encodings and rejects malformed proofs', () => {
    assert.throws(() => hashLeaf('not-hex', true), /Pre-hashed leaf/);
    assert.throws(() => hashNodes('00', '11'), /Left child hash/);
    const tree = new MerkleTree(['a', 'b']);
    assert.strictEqual(
      MerkleTree.verifyProof(tree.getLeaves()[0], [{ position: 'right', hash: 'zz' }], tree.getRoot()),
      false
    );
  });

  it('keeps leaf and interior domains distinct', () => {
    const leaf = hashLeaf('hello');
    assert.notStrictEqual(leaf, hashNodes(leaf, leaf));
  });
});

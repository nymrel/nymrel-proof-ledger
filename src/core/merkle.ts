/**
 * RFC 6962 Domain-Separated Cryptographic Merkle Tree Engine.
 *
 * Implements SHA-256 leaf and interior node hashing with distinct domain prefixes:
 * - Leaf Prefix: 0x00
 * - Interior Node Prefix: 0x01
 *
 * This guarantees resistance against second-preimage attacks and ensures deterministic
 * root calculations across TypeScript and Python runtimes.
 *
 * @module @nymrel/proof-ledger/core/merkle
 */

import { createHash } from 'node:crypto';

export interface MerkleProofStep {
  position: 'left' | 'right';
  hash: string;
}

export interface MerkleTreeOptions {
  /** If true, leaf inputs are already 32-byte hex hashes rather than raw data. */
  isPreHashed?: boolean;
}

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

/**
 * Hashes a leaf value with RFC 6962 domain separation prefix (0x00).
 *
 * @param data - The leaf data (string, Buffer, or hex string).
 * @param isHex - Whether the input is already a hex-encoded string.
 * @returns 64-character lowercase hex SHA-256 hash.
 */
export function hashLeaf(data: string | Uint8Array, isHex = false): string {
  let buf: Buffer;
  if (typeof data === 'string') {
    buf = isHex && /^[0-9a-fA-F]{64}$/.test(data) ? Buffer.from(data, 'hex') : Buffer.from(data, 'utf8');
  } else {
    buf = Buffer.from(data);
  }

  return createHash('sha256')
    .update(LEAF_PREFIX)
    .update(buf)
    .digest('hex');
}

/**
 * Hashes two child hashes together with RFC 6962 domain separation prefix (0x01).
 *
 * @param leftHex - 64-character hex hash of the left node.
 * @param rightHex - 64-character hex hash of the right node.
 * @returns 64-character lowercase hex SHA-256 hash.
 */
export function hashNodes(leftHex: string, rightHex: string): string {
  const leftBuf = Buffer.from(leftHex, 'hex');
  const rightBuf = Buffer.from(rightHex, 'hex');

  return createHash('sha256')
    .update(NODE_PREFIX)
    .update(leftBuf)
    .update(rightBuf)
    .digest('hex');
}

/**
 * Merkle Tree implementation supporting deterministic audit paths and verification.
 */
export class MerkleTree {
  private readonly leaves: string[];
  private readonly layers: string[][];

  /**
   * Constructs a new Merkle Tree.
   *
   * @param items - Array of data items or pre-computed hashes.
   * @param options - Tree construction options.
   */
  constructor(items: (string | Uint8Array)[] = [], options: MerkleTreeOptions = {}) {
    const isPreHashed = options.isPreHashed ?? false;

    if (items.length === 0) {
      // Empty tree root
      const emptyRoot = createHash('sha256').update(LEAF_PREFIX).digest('hex');
      this.leaves = [];
      this.layers = [[emptyRoot]];
      return;
    }

    // Build leaf layer
    this.leaves = items.map((item) => hashLeaf(item, isPreHashed));
    this.layers = this.buildLayers(this.leaves);
  }

  /**
   * Computes all layers from the leaf layer up to the root.
   */
  private buildLayers(leaves: string[]): string[][] {
    const layers: string[][] = [[...leaves]];
    let currentLevel = [...leaves];

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        if (i + 1 < currentLevel.length) {
          const right = currentLevel[i + 1];
          nextLevel.push(hashNodes(left, right));
        } else {
          // Odd node: pair with itself for balanced deterministic binary tree
          nextLevel.push(hashNodes(left, left));
        }
      }
      layers.push(nextLevel);
      currentLevel = nextLevel;
    }

    return layers;
  }

  /**
   * Returns the 64-character hex Merkle Root.
   */
  public getRoot(): string {
    const topLayer = this.layers[this.layers.length - 1];
    return topLayer ? topLayer[0] : '';
  }

  /**
   * Returns all leaf hashes in the tree.
   */
  public getLeaves(): string[] {
    return [...this.leaves];
  }

  /**
   * Returns all layers from leaves to root.
   */
  public getLayers(): string[][] {
    return this.layers.map((layer) => [...layer]);
  }

  /**
   * Generates a cryptographic audit path (Merkle Proof) for a given leaf index.
   *
   * @param index - Index of the leaf.
   * @returns Array of proof steps needed to reconstruct the root.
   */
  public getProof(index: number): MerkleProofStep[] {
    if (index < 0 || index >= this.leaves.length) {
      throw new RangeError(`Leaf index ${index} out of bounds (0..${this.leaves.length - 1})`);
    }

    const proof: MerkleProofStep[] = [];
    let currentIndex = index;

    for (let layerIndex = 0; layerIndex < this.layers.length - 1; layerIndex++) {
      const currentLayer = this.layers[layerIndex];
      const isRightNode = currentIndex % 2 === 1;
      const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < currentLayer.length) {
        proof.push({
          position: isRightNode ? 'left' : 'right',
          hash: currentLayer[siblingIndex],
        });
      } else {
        // Sibling was paired with itself
        proof.push({
          position: 'right',
          hash: currentLayer[currentIndex],
        });
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return proof;
  }

  /**
   * Verifies an audit path against an expected root.
   *
   * @param leafHash - The leaf hash being verified.
   * @param proof - The audit path steps.
   * @param expectedRoot - The target Merkle Root.
   * @returns True if the path reconstructs the root, false otherwise.
   */
  public static verifyProof(leafHash: string, proof: MerkleProofStep[], expectedRoot: string): boolean {
    let currentHash = leafHash;

    for (const step of proof) {
      if (step.position === 'left') {
        currentHash = hashNodes(step.hash, currentHash);
      } else {
        currentHash = hashNodes(currentHash, step.hash);
      }
    }

    return currentHash.toLowerCase() === expectedRoot.toLowerCase();
  }

  /**
   * Verifies an audit path against this tree's root.
   */
  public verifyProof(leafHash: string, proof: MerkleProofStep[]): boolean {
    return MerkleTree.verifyProof(leafHash, proof, this.getRoot());
  }

  /**
   * Returns a JSON representation of the Merkle Tree.
   */
  public toJSON() {
    return {
      root: this.getRoot(),
      leafCount: this.leaves.length,
      leaves: this.getLeaves(),
      depth: this.layers.length,
    };
  }
}

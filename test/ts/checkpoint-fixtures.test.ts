/** Existing primitive compatibility for a proposed profile; no profile verifier. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalHash, canonicalize } from '../../src/core/canonical.js';
import { verifyReceipt, type ProofReceipt } from '../../src/core/receipt.js';

interface CheckpointFixture {
  checkpoint: Record<string, unknown>;
  checkpointCanonical: string;
  checkpointDigest: string;
  publicKey: string;
  wrongPublicKey: string;
  receipt: ProofReceipt;
  trustBundles: Array<{
    name: string;
    bundle: unknown;
    canonical: string;
    digest: string;
  }>;
}

const fixture = JSON.parse(readFileSync(
  'test/fixtures/checkpoint-v0.1-vectors.json', 'utf8',
)) as CheckpointFixture;

describe('Checkpoint draft fixture compatibility with existing primitives', () => {
  it('matches shared canonical checkpoint and pinned trust-bundle digests', () => {
    assert.equal(canonicalize(fixture.checkpoint), fixture.checkpointCanonical);
    assert.equal(`sha256:${canonicalHash(fixture.checkpoint)}`, fixture.checkpointDigest);
    for (const item of fixture.trustBundles) {
      assert.equal(canonicalize(item.bundle), item.canonical, item.name);
      assert.equal(`sha256:${canonicalHash(item.bundle)}`, item.digest, item.name);
    }
  });

  it('authenticates the existing v2 receipt using only an external public key', async () => {
    const result = await verifyReceipt(fixture.receipt, {
      expectedAlgorithm: 'Ed25519', publicKeyOrSecret: fixture.publicKey,
    });
    assert.equal(fixture.receipt.version, '2.0.0');
    assert.equal(result.valid, true);
    assert.equal(result.trusted, true);
    assert.equal(result.signatureChecked, true);
    assert.equal(result.signatureValid, true);
    assert.equal(result.checkedArtifacts, 0);
    assert.equal(fixture.receipt.signature.signerIdentity, fixture.checkpoint.signerIdentity);
    assert.equal(fixture.receipt.signature.keyId, fixture.checkpoint.keyId);
    assert.deepEqual(fixture.receipt.artifacts, [{
      path: 'checkpoint.json',
      sha256: fixture.checkpointDigest.slice('sha256:'.length),
      sizeBytes: Buffer.byteLength(fixture.checkpointCanonical, 'utf8'),
      mimeType: 'application/json',
    }]);
  });

  it('leaves an unchecked signature untrusted and rejects a wrong public key', async () => {
    const integrity = await verifyReceipt(fixture.receipt);
    assert.equal(integrity.valid, true);
    assert.equal(integrity.trusted, false);
    assert.equal(integrity.signatureChecked, false);
    const wrongKey = await verifyReceipt(fixture.receipt, {
      expectedAlgorithm: 'Ed25519', publicKeyOrSecret: fixture.wrongPublicKey,
    });
    assert.equal(wrongKey.signatureChecked, true);
    assert.equal(wrongKey.signatureValid, false);
    assert.equal(wrongKey.valid, false);
    assert.equal(wrongKey.trusted, false);
  });

  it('distinguishes detached checkpoint changes from authenticated receipt data', async () => {
    const changedCheckpoint = { ...fixture.checkpoint, eventCount: 1, highestSequence: 0 };
    assert.notEqual(canonicalHash(changedCheckpoint), fixture.receipt.artifacts[0].sha256);
    // Core receipt verification alone cannot validate a separate profile object.
    assert.equal((await verifyReceipt(fixture.receipt, {
      expectedAlgorithm: 'Ed25519', publicKeyOrSecret: fixture.publicKey,
    })).trusted, true);

    const changedReceipt = structuredClone(fixture.receipt);
    changedReceipt.artifacts[0].sha256 = canonicalHash(changedCheckpoint);
    const result = await verifyReceipt(changedReceipt, {
      expectedAlgorithm: 'Ed25519', publicKeyOrSecret: fixture.publicKey,
    });
    assert.equal(result.valid, false);
    assert.equal(result.trusted, false);
    assert.equal(result.signatureValid, true);
    assert.equal(result.merkleValid, false);
  });

  it('rejects changed signed metadata and changes the pin when bundle policy changes', async () => {
    const changed = structuredClone(fixture.receipt);
    changed.metadata = { injected: true };
    const result = await verifyReceipt(changed, {
      expectedAlgorithm: 'Ed25519', publicKeyOrSecret: fixture.publicKey,
    });
    assert.equal(result.signatureValid, false);
    assert.equal(result.trusted, false);
    const active = fixture.trustBundles.find(item => item.name === 'active')!;
    const changedBundle = { ...(active.bundle as Record<string, unknown>), revision: 999 };
    assert.notEqual(`sha256:${canonicalHash(changedBundle)}`, active.digest);
  });
});

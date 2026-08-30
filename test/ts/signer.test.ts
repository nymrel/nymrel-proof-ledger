import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { ProofSigner } from '../../src/core/signer.js';

interface SignerVectors {
  ed25519: {
    secretKey: string;
    publicKey: string;
    message: string;
    signature: string;
  };
}

const vectors = JSON.parse(
  readFileSync('test/fixtures/protocol-v2-vectors.json', 'utf8')
) as SignerVectors;

describe('ProofSigner', () => {
  it('signs and verifies HMAC-SHA256 in constant-time-compatible form', () => {
    const secret = ProofSigner.generateSecretKey();
    const payload = { task: 'Verify Suite', root: 'abc123' };
    const signature = ProofSigner.signPayload(payload, secret);
    assert.match(signature, /^[0-9a-f]{64}$/);
    assert.strictEqual(ProofSigner.verifySignature(payload, signature, secret), true);
    assert.strictEqual(ProofSigner.verifySignature({ ...payload, root: 'changed' }, signature, secret), false);
    assert.strictEqual(ProofSigner.verifySignature(payload, 'zz', secret), false);
  });

  it('matches RFC 8032 test vector 1 exactly', () => {
    const vector = vectors.ed25519;
    const signature = ProofSigner.signPayload(vector.message, vector.secretKey, 'Ed25519');
    assert.strictEqual(signature, vector.signature);
    assert.strictEqual(
      ProofSigner.verifySignature(vector.message, signature, vector.publicKey, 'Ed25519'),
      true
    );
  });

  it('generates portable raw-hex Ed25519 keypairs', () => {
    const keypair = ProofSigner.generateKeyPair();
    assert.strictEqual(keypair.encoding, 'raw-hex');
    assert.match(keypair.privateKey, /^[0-9a-f]{64}$/);
    assert.match(keypair.publicKey, /^[0-9a-f]{64}$/);
    const signature = ProofSigner.signPayload({ proof: 1 }, keypair.privateKey, 'Ed25519');
    assert.strictEqual(
      ProofSigner.verifySignature({ proof: 1 }, signature, keypair.publicKey, 'Ed25519'),
      true
    );
  });

  it('fails closed on malformed Ed25519 material', () => {
    assert.throws(
      () => ProofSigner.signPayload('payload', 'not-a-private-key', 'Ed25519')
    );
    assert.strictEqual(
      ProofSigner.verifySignature('payload', '00'.repeat(64), 'not-a-public-key', 'Ed25519'),
      false
    );
  });
});

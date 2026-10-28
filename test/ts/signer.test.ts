import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { ProofSigner, decodeSignatureAlgorithm } from '../../src/core/signer.js';

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
  it('accepts only canonical runtime algorithm literals before cryptographic dispatch', () => {
    const payload = { task: 'runtime algorithm boundary' };
    const secret = 'fixture-secret';
    const signature = ProofSigner.signPayload(payload, secret, 'HMAC-SHA256');
    assert.strictEqual(decodeSignatureAlgorithm('HMAC-SHA256'), 'HMAC-SHA256');
    assert.strictEqual(decodeSignatureAlgorithm('Ed25519'), 'Ed25519');
    for (const value of ['hmac-sha256', 'constructor', '', null, { toString: () => 'HMAC-SHA256' }]) {
      assert.strictEqual(decodeSignatureAlgorithm(value), undefined);
      assert.strictEqual(ProofSigner.verifySignature(payload, signature, secret, value as any), false);
      assert.throws(() => ProofSigner.signPayload(payload, secret, value as any), /Unsupported signature algorithm/);
    }
    assert.strictEqual(ProofSigner.verifySignature(payload, signature, secret, 'HMAC-SHA256'), true);
  });
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

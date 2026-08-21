import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ProofSigner } from '../../src/core/signer.js';

describe('ProofSigner (HMAC-SHA256 & Ed25519)', () => {
  it('generates secret keys and signs/verifies with HMAC-SHA256', () => {
    const secret = ProofSigner.generateSecretKey();
    assert.strictEqual(secret.length, 64);

    const payload = { task: 'Verify Suite', timestamp: '2026-08-21T12:00:00Z', root: 'abc123' };
    const signature = ProofSigner.signPayload(payload, secret, 'HMAC-SHA256');

    assert.match(signature, /^[0-9a-f]{64}$/);

    const isValid = ProofSigner.verifySignature(payload, signature, secret, 'HMAC-SHA256');
    assert.strictEqual(isValid, true);

    const isInvalid = ProofSigner.verifySignature(payload, signature, 'wrong-secret', 'HMAC-SHA256');
    assert.strictEqual(isInvalid, false);

    const isTampered = ProofSigner.verifySignature({ ...payload, root: 'tampered' }, signature, secret, 'HMAC-SHA256');
    assert.strictEqual(isTampered, false);
  });

  it('generates Ed25519 keypairs and performs asymmetric signing and verification', () => {
    const keypair = ProofSigner.generateKeyPair();
    assert.ok(keypair.publicKey.includes('BEGIN PUBLIC KEY'));
    assert.ok(keypair.privateKey.includes('BEGIN PRIVATE KEY'));

    const payload = { proofId: 'prf_12345', root: '8f7e3a9c' };
    const signature = ProofSigner.signPayload(payload, keypair.privateKey, 'Ed25519');

    assert.ok(signature.length > 0);

    const isValid = ProofSigner.verifySignature(payload, signature, keypair.publicKey, 'Ed25519');
    assert.strictEqual(isValid, true);

    // Test with another keypair
    const otherKeypair = ProofSigner.generateKeyPair();
    const isInvalid = ProofSigner.verifySignature(payload, signature, otherKeypair.publicKey, 'Ed25519');
    assert.strictEqual(isInvalid, false);
  });

  it('creates structured SignatureRecord objects', () => {
    const secret = ProofSigner.generateSecretKey();
    const record = ProofSigner.createSignatureRecord(
      { task: 'Deploy' },
      secret,
      'nymrel-agent-01',
      'key-1',
      'HMAC-SHA256'
    );

    assert.strictEqual(record.algorithm, 'HMAC-SHA256');
    assert.strictEqual(record.signerIdentity, 'nymrel-agent-01');
    assert.strictEqual(record.keyId, 'key-1');
    assert.match(record.value, /^[0-9a-f]{64}$/);
    assert.ok(record.timestamp.length > 0);
  });
});

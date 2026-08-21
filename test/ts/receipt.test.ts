import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createReceipt, verifyReceipt, type ProofReceipt } from '../../src/core/receipt.js';
import { ProofSigner } from '../../src/core/signer.js';

describe('Proof Receipt Engine', () => {
  it('creates and verifies a valid cryptographic proof receipt', async () => {
    const secret = ProofSigner.generateSecretKey();

    const receipt = await createReceipt({
      task: {
        name: 'Unit Test Suite',
        description: 'Automated test suite execution',
        status: 'SUCCESS',
        exitCode: 0,
      },
      artifacts: [
        { path: 'test/file1.txt', data: 'hello world from test 1' },
        { path: 'test/file2.json', data: '{"status":"ok"}' },
      ],
      signingKey: secret,
      signerIdentity: 'nymrel-ci-bot',
      algorithm: 'HMAC-SHA256',
    });

    assert.strictEqual(receipt.protocol, 'nymrel-proof-ledger');
    assert.strictEqual(receipt.version, '1.0.0');
    assert.strictEqual(receipt.parentOrganization, 'Nymrel -> JalenBuilds LLC');
    assert.strictEqual(receipt.artifacts.length, 2);
    assert.match(receipt.merkle.root, /^[0-9a-f]{64}$/);

    // Verify receipt
    const result = await verifyReceipt(receipt, {
      publicKeyOrSecret: secret,
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.merkleValid, true);
    assert.strictEqual(result.signatureValid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('detects tampering with artifacts or task metadata', async () => {
    const secret = ProofSigner.generateSecretKey();

    const receipt = await createReceipt({
      task: {
        name: 'Sensitive Financial Audit',
        status: 'SUCCESS',
      },
      artifacts: [{ path: 'audit.log', data: 'TRANSACTION_APPROVED_1000000' }],
      signingKey: secret,
      signerIdentity: 'auditor-01',
    });

    // 1. Tamper with artifact hash in receipt
    const tamperedArtifactReceipt: ProofReceipt = JSON.parse(JSON.stringify(receipt));
    tamperedArtifactReceipt.artifacts[0].sha256 = '0000000000000000000000000000000000000000000000000000000000000000';

    const result1 = await verifyReceipt(tamperedArtifactReceipt, { publicKeyOrSecret: secret });
    assert.strictEqual(result1.valid, false);
    assert.strictEqual(result1.merkleValid, false);

    // 2. Tamper with task name
    const tamperedTaskReceipt: ProofReceipt = JSON.parse(JSON.stringify(receipt));
    tamperedTaskReceipt.task.name = 'Falsified Audit Name';

    const result2 = await verifyReceipt(tamperedTaskReceipt, { publicKeyOrSecret: secret });
    assert.strictEqual(result2.valid, false);
    assert.strictEqual(result2.merkleValid, false);

    // 3. Tamper with signature
    const tamperedSigReceipt: ProofReceipt = JSON.parse(JSON.stringify(receipt));
    tamperedSigReceipt.signature.value = 'ff'.repeat(32);

    const result3 = await verifyReceipt(tamperedSigReceipt, { publicKeyOrSecret: secret });
    assert.strictEqual(result3.valid, false);
    assert.strictEqual(result3.signatureValid, false);
  });

  it('supports Ed25519 asymmetric attestation', async () => {
    const keypair = ProofSigner.generateKeyPair();

    const receipt = await createReceipt({
      task: { name: 'Asymmetric Attestation' },
      artifacts: [{ path: 'manifest.json', data: '{"version":"1.0.0"}' }],
      signingKey: keypair.privateKey,
      signerIdentity: 'governance-authority',
      algorithm: 'Ed25519',
    });

    assert.strictEqual(receipt.signature.algorithm, 'Ed25519');

    const result = await verifyReceipt(receipt, {
      publicKeyOrSecret: keypair.publicKey,
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.signatureValid, true);
  });
});

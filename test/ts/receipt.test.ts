import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  createReceipt,
  sanitizeGitRemote,
  verifyReceipt,
  type ProofReceipt,
} from '../../src/core/receipt.js';
import { ProofSigner } from '../../src/core/signer.js';

interface ReceiptVectors {
  protocolV2: {
    secret: string;
    receipt: ProofReceipt;
  };
  legacyV1: {
    secret: string;
    receipt: ProofReceipt;
  };
}

const vectors = JSON.parse(
  readFileSync('test/fixtures/protocol-v2-vectors.json', 'utf8')
) as ReceiptVectors;

describe('Proof Receipt Engine', () => {
  it('emits and cryptographically verifies protocol v2 receipts', async () => {
    const secret = ProofSigner.generateSecretKey();
    const receipt = await createReceipt({
      task: { name: 'Unit Test Suite', description: 'Protocol v2', status: 'SUCCESS' },
      artifacts: [{ path: 'file.txt', data: 'hello world', mimeType: 'text/plain' }],
      signingKey: secret,
      signerIdentity: 'nymrel-ci',
      metadata: { gate: 'unit' },
    });
    assert.strictEqual(receipt.version, '2.0.0');
    assert.strictEqual(receipt.parentOrganization, 'Nymrel');
    assert.strictEqual(receipt.merkle.algorithm, 'RFC6962-SHA256');

    const result = await verifyReceipt(receipt, { publicKeyOrSecret: secret });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.trusted, true);
    assert.strictEqual(result.merkleValid, true);
    assert.strictEqual(result.signatureChecked, true);
    assert.strictEqual(result.signatureValid, true);
  });

  it('reports integrity-only verification honestly when no key is supplied', async () => {
    const receipt = await createReceipt({
      task: { name: 'Integrity Only' },
      signingKey: ProofSigner.generateSecretKey(),
      signerIdentity: 'nymrel-ci',
    });
    const result = await verifyReceipt(receipt);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.trusted, false);
    assert.strictEqual(result.signatureChecked, false);
    assert.strictEqual(result.signatureValid, null);
    assert.match(result.warnings[0], /not cryptographically verified/);
  });

  it('detects task, artifact-record, and signature tampering', async () => {
    const secret = ProofSigner.generateSecretKey();
    const receipt = await createReceipt({
      task: { name: 'Sensitive Audit' },
      artifacts: [{ path: 'audit.log', data: 'approved' }],
      signingKey: secret,
      signerIdentity: 'auditor',
    });

    const taskTamper = structuredClone(receipt);
    taskTamper.task.name = 'Changed';
    assert.strictEqual(
      (await verifyReceipt(taskTamper, { publicKeyOrSecret: secret })).valid,
      false
    );

    const pathTamper = structuredClone(receipt);
    pathTamper.artifacts[0].path = 'renamed.log';
    assert.strictEqual(
      (await verifyReceipt(pathTamper, { publicKeyOrSecret: secret })).merkleValid,
      false
    );

    const signatureTamper = structuredClone(receipt);
    signatureTamper.signature.value = 'ff'.repeat(32);
    const signatureResult = await verifyReceipt(signatureTamper, {
      publicKeyOrSecret: secret,
    });
    assert.strictEqual(signatureResult.valid, false);
    assert.strictEqual(signatureResult.signatureValid, false);

    const metadataTamper = structuredClone(receipt);
    metadataTamper.metadata['claim'] = 'rewritten';
    const metadataResult = await verifyReceipt(metadataTamper, {
      publicKeyOrSecret: secret,
    });
    assert.strictEqual(metadataResult.merkleValid, true);
    assert.strictEqual(metadataResult.signatureValid, false);

    const identityTamper = structuredClone(receipt);
    identityTamper.signature.signerIdentity = 'impostor';
    assert.strictEqual(
      (await verifyReceipt(identityTamper, { publicKeyOrSecret: secret })).signatureValid,
      false
    );
  });

  it('verifies the frozen protocol v1 compatibility vector', async () => {
    const result = await verifyReceipt(vectors.legacyV1.receipt, {
      publicKeyOrSecret: vectors.legacyV1.secret,
    });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.trusted, true);
    assert.strictEqual(result.merkleValid, true);
    assert.strictEqual(result.signatureValid, true);
  });

  it('verifies the shared cross-runtime protocol v2 receipt vector', async () => {
    const result = await verifyReceipt(vectors.protocolV2.receipt, {
      publicKeyOrSecret: vectors.protocolV2.secret,
    });
    assert.strictEqual(result.trusted, true);
    assert.strictEqual(result.merkleValid, true);
    assert.strictEqual(result.signatureValid, true);
  });

  it('supports cross-runtime raw-hex Ed25519 receipts', async () => {
    const keypair = ProofSigner.generateKeyPair();
    const receipt = await createReceipt({
      task: { name: 'Asymmetric Attestation' },
      signingKey: keypair.privateKey,
      signerIdentity: 'governance',
      algorithm: 'Ed25519',
    });
    const result = await verifyReceipt(receipt, {
      publicKeyOrSecret: keypair.publicKey,
    });
    assert.strictEqual(result.trusted, true);
  });

  it('sanitizes credential-bearing remotes and fences artifact traversal', async () => {
    assert.strictEqual(
      sanitizeGitRemote('https://user:token@github.com/nymrel/repo.git?token=also#fragment'),
      'https://github.com/nymrel/repo.git'
    );
    assert.strictEqual(sanitizeGitRemote('C:\\private\\repo'), undefined);

    const secret = ProofSigner.generateSecretKey();
    const receipt = await createReceipt({
      task: { name: 'Traversal Guard' },
      artifacts: [{ path: '../outside.txt', data: 'not written' }],
      signingKey: secret,
      signerIdentity: 'nymrel-ci',
    });
    const result = await verifyReceipt(receipt, {
      publicKeyOrSecret: secret,
      checkFilesOnDisk: true,
    });
    assert.strictEqual(result.merkleValid, true);
    assert.strictEqual(result.artifactsValid, false);
    assert.match(result.errors.join('\n'), /escapes verification root/);
  });

  it('rejects malformed envelopes before cryptographic work', async () => {
    const result = await verifyReceipt({ protocol: 'nymrel-proof-ledger' });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.receipt, null);
    assert.match(result.errors[0], /Envelope VERSION_MISSING/);
  });
});

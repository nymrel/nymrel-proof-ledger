#!/usr/bin/env node
/** Run from a built source checkout: node examples/ed25519-demo.mjs */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProofLedger, attestExecution, verifyProof } from '../dist/src/index.js';

const demoRoot = await mkdtemp(join(tmpdir(), 'nymrel-proof-ledger-demo-'));

function report(label, result) {
  console.log(`${label}: valid=${result.valid}, trusted=${result.trusted}, signatureChecked=${result.signatureChecked}`);
}

try {
  // Local experiment only: the private key stays in memory and is never printed.
  const signingKeys = ProofLedger.generateKeyPair();
  const verifierConfigPath = join(demoRoot, 'verifier-config.json');
  const artifactPath = join(demoRoot, 'build-manifest.json');
  const receiptPath = join(demoRoot, 'proof.json');

  // Provision the verifier separately, before a receipt exists. In a real
  // integration, obtain this public key and algorithm over an authenticated
  // channel; never take either from receipt-controlled data.
  await writeFile(verifierConfigPath, JSON.stringify({
    algorithm: 'Ed25519',
    publicKey: signingKeys.publicKey,
  }, null, 2), { flag: 'wx' });
  await writeFile(artifactPath, '{"build":"local-demo","status":"ready"}\n', { flag: 'wx' });

  const receipt = await attestExecution({
    task: { name: 'Local build receipt demo', status: 'ATTESTED', exitCode: 0 },
    artifacts: [{ path: 'build-manifest.json' }],
    signingKey: signingKeys.privateKey,
    algorithm: 'Ed25519',
    signerIdentity: 'local-demo-signer',
    metadata: { purpose: 'source-checkout-demo' },
    cwd: demoRoot,
  });
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx' });

  // Verification uses only a transported receipt, public configuration, and
  // artifact bytes. It does not receive the signing key.
  const verifierConfig = JSON.parse(await readFile(verifierConfigPath, 'utf8'));
  const transportedReceipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const verificationOptions = {
    publicKeyOrSecret: verifierConfig.publicKey,
    expectedAlgorithm: verifierConfig.algorithm,
    checkFilesOnDisk: true,
    cwd: demoRoot,
  };

  const authenticated = await verifyProof(transportedReceipt, verificationOptions);
  assert.equal(authenticated.valid, true);
  assert.equal(authenticated.trusted, true);
  assert.equal(authenticated.signatureChecked, true);
  assert.equal(authenticated.checkedArtifacts, 1);
  report('Original receipt + configured public key + disk check', authenticated);

  const integrityOnly = await verifyProof(transportedReceipt, {
    checkFilesOnDisk: true,
    cwd: demoRoot,
  });
  assert.equal(integrityOnly.valid, true);
  assert.equal(integrityOnly.trusted, false);
  assert.equal(integrityOnly.signatureChecked, false);
  report('Original receipt without a verification key', integrityOnly);

  // Metadata is signed in v2. Changing it leaves the Merkle root intact but
  // invalidates the signature, demonstrating why integrity alone is insufficient.
  const tamperedReceipt = structuredClone(transportedReceipt);
  tamperedReceipt.metadata.purpose = 'changed-after-signing';
  const tampered = await verifyProof(tamperedReceipt, verificationOptions);
  assert.equal(tampered.valid, false);
  assert.equal(tampered.trusted, false);
  assert.equal(tampered.merkleValid, true);
  assert.equal(tampered.signatureValid, false);
  report('Receipt with changed signed metadata', tampered);
  console.log(`Tamper rejection: ${tampered.errors.join('; ')}`);

  console.log('All demo expectations passed. Temporary files are removed; no private key was saved.');
  console.log('Trust authenticates the documented signed fields under the configured key; it does not independently prove task execution or signer identity.');
} finally {
  await rm(demoRoot, { recursive: true, force: true });
}

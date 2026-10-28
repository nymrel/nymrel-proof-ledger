#!/usr/bin/env node
/** Copy outside the checkout; install the local npm archive before running. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ProofLedger, attestExecution, verifyProof } from '@nymrel/proof-ledger';

function verificationFailureMessage(result) {
  // Core errors can contain receipt-controlled paths or filesystem details.
  // Translate only their known categories; never print the untrusted strings.
  const errors = Array.isArray(result.errors) ? result.errors : [];
  for (const [prefix, message] of [
    ['Artifact missing on disk:', 'artifact missing or unreadable. Restore the original artifact.txt beside proof.json, check read access, then retry verification.'],
    ['Artifact tampered:', 'artifact bytes do not match the receipt. Restore the original artifact.txt beside proof.json, then retry verification.'],
    ['Artifact path escapes verification root', 'artifact location was rejected. Restore the original receipt and keep artifact.txt inside its fixture directory, then retry verification.'],
  ]) {
    if (errors.some(error => typeof error === 'string' && error.startsWith(prefix))) {
      return `Verification failed: ${message}`;
    }
  }
  return 'Verification failed: receipt authentication or integrity check failed. Check the independently supplied public configuration and original receipt/artifact, then retry verification.';
}

async function main() {
  const [action, directory] = process.argv.slice(2);
  if (!['create', 'verify'].includes(action) || !directory) {
    throw new Error('Usage: node installed-consumer.mjs <create|verify> <public-directory>');
  }
  const root = resolve(directory);
  const receiptPath = join(root, 'proof.json');
  const configPath = join(root, 'verifier-config.json');
  let checks = [];

  if (action === 'create') {
    await mkdir(root, { recursive: true });
    // Experimental signing only. The private key stays in memory and is not exported.
    const { privateKey, publicKey } = ProofLedger.generateKeyPair();
    // Real verifiers must obtain this configuration over an authenticated channel.
    await writeFile(configPath, JSON.stringify({ algorithm: 'Ed25519', publicKey }), { flag: 'wx' });
    await writeFile(join(root, 'artifact.txt'), 'Installed consumer artifact: \u20ac\ud83d\ude00\n', { flag: 'wx' });
    const receipt = await attestExecution({
      task: { name: 'Installed Node consumer', status: 'ATTESTED' },
      artifacts: [{ path: 'artifact.txt' }],
      signingKey: privateKey,
      algorithm: 'Ed25519',
      signerIdentity: 'experimental-node-consumer',
      metadata: { consumer: 'node', purpose: 'installed-package-acceptance' },
      cwd: root,
    });
    await writeFile(receiptPath, JSON.stringify(receipt), { flag: 'wx' });
  } else {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    assert.deepEqual(Object.keys(config).sort(), ['algorithm', 'publicKey']);
    assert.equal(config.algorithm, 'Ed25519');
    assert.equal(typeof config.publicKey, 'string');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    assert.equal(receipt.version, '2.0.0');
    const options = {
      publicKeyOrSecret: config.publicKey,
      expectedAlgorithm: config.algorithm,
      checkFilesOnDisk: true,
      cwd: root,
    };
    const original = await verifyProof(receipt, options);
    if (!(original.valid && original.trusted && original.signatureChecked && original.checkedArtifacts === 1)) {
      console.error(verificationFailureMessage(original));
      process.exitCode = 1;
      return;
    }
    assert.equal(original.valid, true);
    assert.equal(original.trusted, true);
    assert.equal(original.signatureChecked, true);
    assert.equal(original.checkedArtifacts, 1);
    checks.push('trusted-v2-public-only');

    const wrongKey = await verifyProof(receipt, {
      ...options, publicKeyOrSecret: ProofLedger.generateKeyPair().publicKey,
    });
    assert.equal(wrongKey.valid, false);
    assert.equal(wrongKey.trusted, false);
    checks.push('wrong-key-rejected');

    const tampered = structuredClone(receipt);
    tampered.metadata.purpose = 'changed-after-signing';
    const rejected = await verifyProof(tampered, options);
    assert.equal(rejected.valid, false);
    assert.equal(rejected.trusted, false);
    assert.equal(rejected.merkleValid, true);
    assert.equal(rejected.signatureValid, false);
    checks.push('signed-metadata-tampering-rejected');

    const integrity = await verifyProof(receipt, { checkFilesOnDisk: true, cwd: root });
    assert.equal(integrity.valid, true);
    assert.equal(integrity.trusted, false);
    assert.equal(integrity.signatureChecked, false);
    checks.push('integrity-only-untrusted');
  }

  console.log(JSON.stringify({
    action, runtime: process.version, module: import.meta.resolve('@nymrel/proof-ledger'),
    directory: root, checks, status: 'PASS',
  }));
}

await main();

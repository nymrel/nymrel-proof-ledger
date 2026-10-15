#!/usr/bin/env node
/** Node worker for cross-runtime-demo.py; see docs/CROSS_RUNTIME_DEMO.md. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ProofLedger, attestExecution, verifyProof } from '../dist/src/index.js';

const [action, directory, ...extra] = process.argv.slice(2);
if (!['sign', 'verify', 'integrity'].includes(action) || !directory || extra.length) {
  throw new Error('Run the complete demo: python examples/cross-runtime-demo.py');
}
const root = resolve(directory);

async function sign() {
  // Only this process holds the private key; it is never written or printed.
  const keys = ProofLedger.generateKeyPair();
  await writeFile(join(root, 'verifier-config.json'), JSON.stringify({
    algorithm: 'Ed25519', publicKey: keys.publicKey,
  }, null, 2), { flag: 'wx' });
  const receipt = await attestExecution({
    task: { name: 'Node artifact handoff', status: 'ATTESTED' },
    artifacts: [{ path: 'build-manifest.json' }],
    signingKey: keys.privateKey,
    algorithm: 'Ed25519',
    signerIdentity: 'node-demo-signer',
    metadata: { purpose: 'cross-runtime-demo', label: 'Release café 🚀' },
    cwd: root,
  });
  await writeFile(join(root, 'proof.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
  return { status: 'signed' };
}

async function verify() {
  const receipt = JSON.parse(await readFile(join(root, 'proof.json'), 'utf8'));
  const options = { cwd: root, checkFilesOnDisk: true };
  if (action === 'verify') {
    // Public configuration is provisioned separately, never from the receipt.
    const config = JSON.parse(await readFile(join(root, 'verifier-config.json'), 'utf8'));
    options.publicKeyOrSecret = config.publicKey;
    options.expectedAlgorithm = config.algorithm;
  }
  return verifyProof(receipt, options);
}

console.log(JSON.stringify(await (action === 'sign' ? sign() : verify())));

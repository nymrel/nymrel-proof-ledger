import assert from 'node:assert/strict';
import { readFileSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createReceipt, verifyReceipt } from '../../src/core/receipt.js';
import { verifyProof, ProofLedger } from '../../src/index.js';
import { validateReceiptEnvelope } from '../../src/core/envelope.js';
import { runCli } from '../../src/cli.js';

const vectors = JSON.parse(readFileSync('test/fixtures/protocol-v2-vectors.json', 'utf8'));
const cases = JSON.parse(readFileSync('test/fixtures/auth-context-cases.json', 'utf8'));
export function inputFor(row: any) {
  const receipt: any = row.receipt === null ? null : structuredClone(vectors[row.vector ?? 'protocolV2'].receipt);
  for (const operation of row.operations ?? []) {
    let target = receipt;
    for (const part of operation.path.slice(0, -1)) target = target[part];
    const key = operation.path.at(-1);
    if (operation.remove) delete target[key]; else target[key] = operation.value;
  }
  return receipt;
}
for (const row of cases) {
  test(`authentication context: ${row.name}`, async () => {
    const result = await verifyReceipt(inputFor(row), row.options ?? {});
    assert.equal(result.valid, row.valid, result.errors.join('; '));
    assert.equal(result.trusted, row.trusted);
    if (row.warning) assert(result.warnings.includes(row.warning));
  });
}

test('public facades cannot authenticate a forged HMAC under an Ed25519 public key', async () => {
  const publicKey = vectors.ed25519.publicKey;
  const forged = await createReceipt({ task: { name: 'attacker claim' }, signingKey: publicKey, signerIdentity: 'victim', algorithm: 'HMAC-SHA256' });
  for (const verify of [verifyReceipt, verifyProof, ProofLedger.verify]) {
    const mismatch = await verify(forged, { publicKeyOrSecret: publicKey, expectedAlgorithm: 'Ed25519' });
    assert.equal(mismatch.valid, false);
    assert.equal(mismatch.trusted, false);
    const missing = await verify(forged, { publicKeyOrSecret: publicKey } as any);
    assert.equal(missing.valid, false);
    assert.equal(missing.trusted, false);
  }
});

test('Git context is disabled by default and requires explicit opt-in', async () => {
  const original = childProcess.execSync;
  let calls = 0;
  childProcess.execSync = (() => { calls++; return Buffer.from('test-git-context'); }) as unknown as typeof original;
  syncBuiltinESMExports();
  try {
    const options = { task: { name: 'no Git' }, signingKey: 'test-secret', signerIdentity: 'test' };
    const receipt = await createReceipt(options);
    assert.equal(calls, 0);
    assert.equal(receipt.environment.git, undefined);
    const opted = await createReceipt({ ...options, includeGitContext: true });
    assert(calls > 0);
    assert(opted.environment.git);
  } finally { childProcess.execSync = original; syncBuiltinESMExports(); }
});

test('verification CLI requires trusted algorithm configuration', async () => {
  const original = console.log;
  let output: string[] = [];
  console.log = (...values: unknown[]) => { output.push(values.join(' ')); };
  try {
    for (const [suffix, expected] of [[[], 1], [['--algo', 'HMAC-SHA256'], 0], [['--algo', 'Ed25519'], 1]] as Array<[string[], number]>) {
      output = [];
      const code = await runCli(['verify', 'test/fixtures/auth-context-cli-receipt.json', '--key', vectors.protocolV2.secret, '--json', ...suffix]);
      assert.equal(code, expected);
      assert.equal(JSON.parse(output.join('')).trusted, expected === 0);
    }
  } finally { console.log = original; }
});

test('the shipped CLI entry point resolves its built module', () => {
  const run = childProcess.spawnSync(process.execPath, ['bin/proof-ledger.js', 'verify', 'test/fixtures/auth-context-cli-receipt.json', '--key', vectors.protocolV2.secret, '--algo', 'HMAC-SHA256', '--json'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).trusted, true);
});

test('envelope preserves non-empty Unicode labels and accepts integral JSON floats', () => {
  for (const label of ['\u001f', '\u0085', '\ufeff']) {
    const receipt = structuredClone(vectors.protocolV2.receipt);
    receipt.proofId = label;
    receipt.artifacts[0].sizeBytes = 7.0;
    assert.equal(validateReceiptEnvelope(receipt).valid, true);
  }
});

test('unsupported metadata returns an invalid verdict', async () => {
  for (const value of [NaN, Infinity, '\ud800', new Set([1, 2])]) {
    const receipt = structuredClone(vectors.protocolV2.receipt);
    receipt.metadata.unsupported = value;
    const result = await verifyReceipt(receipt);
    assert.equal(result.valid, false);
    assert.equal(result.trusted, false);
  }
});

test('CLI refuses a key file whose algorithm conflicts with the flag', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-auth-context-'));
  const original = console.log;
  let output: string[] = [];
  console.log = (...values: unknown[]) => { output.push(values.join(' ')); };
  try {
    const publicKey = vectors.ed25519.publicKey;
    const forged = await createReceipt({ task: { name: 'fixture forgery' }, signingKey: publicKey, signerIdentity: 'fixture' });
    const receiptFile = path.join(dir, 'receipt.json');
    const keyFile = path.join(dir, 'key.json');
    await fs.writeFile(receiptFile, JSON.stringify(forged));
    for (const key of [{ algorithm: 'Ed25519', publicKey }, { publicKey }, { algorithm: 'HMAC-SHA256', publicKey }]) {
      await fs.writeFile(keyFile, JSON.stringify(key));
      output = [];
      assert.equal(await runCli(['verify', receiptFile, '--key-file', keyFile, '--algo', 'HMAC-SHA256', '--json']), 1);
      assert.equal(JSON.parse(output.join('')).trusted, false);
      assert.deepEqual(JSON.parse(output.join('')).errors, ['Invalid verification key file or algorithm context']);
    }
    const valid = await createReceipt({ task: { name: 'Ed fixture' }, signingKey: vectors.ed25519.secretKey, signerIdentity: 'fixture', algorithm: 'Ed25519' });
    await fs.writeFile(receiptFile, JSON.stringify(valid));
    await fs.writeFile(keyFile, JSON.stringify({ algorithm: 'Ed25519', publicKey }));
    output = [];
    assert.equal(await runCli(['verify', receiptFile, '--key-file', keyFile, '--algo', 'Ed25519', '--json']), 0);
    assert.equal(JSON.parse(output.join('')).trusted, true);
    const jsonKey = JSON.stringify({ algorithm: 'Ed25519', publicKey });
    for (const encoded of [Buffer.from('\ufeff' + jsonKey), Buffer.from('\ufeff' + jsonKey, 'utf16le'), Buffer.from(' \ufeff\u0085' + jsonKey), Buffer.from(jsonKey, 'utf16le'), Buffer.from(jsonKey, 'utf16le').swap16(), Buffer.from('\ufffd' + jsonKey)]) {
      const oldRaw = encoded.toString('utf8').trim();
      const encodedForgery = await createReceipt({ task: { name: 'encoded JSON forgery' }, signingKey: oldRaw, signerIdentity: 'fixture' });
      await fs.writeFile(receiptFile, JSON.stringify(encodedForgery));
      await fs.writeFile(keyFile, encoded);
      output = [];
      assert.equal(await runCli(['verify', receiptFile, '--key-file', keyFile, '--algo', 'HMAC-SHA256', '--json']), 1);
      const result = JSON.parse(output.join(''));
      assert.equal(result.trusted, false);
      assert.deepEqual(result.errors, ['Invalid verification key file or algorithm context']);
    }
    await fs.writeFile(receiptFile, JSON.stringify(valid));
    await fs.writeFile(keyFile, '\ufeff' + jsonKey);
    output = [];
    assert.equal(await runCli(['verify', receiptFile, '--key-file', keyFile, '--algo', 'Ed25519', '--json']), 0);
    assert.equal(JSON.parse(output.join('')).trusted, true);
  } finally { console.log = original; await fs.rm(dir, { recursive: true, force: true }); }
});

test('network, drive and escaping artifact paths fail before filesystem resolution', async () => {
  const original = fs.realpath;
  let calls = 0;
  fs.realpath = (async () => { calls++; throw new Error('No filesystem lookup allowed'); }) as typeof original;
  try {
    for (const value of ['//attacker.invalid/share/x', '\\\\attacker.invalid\\share\\x', 'C:\\outside\\file', 'C:relative', '../outside', '..\\outside']) {
      const receipt = structuredClone(vectors.protocolV2.receipt);
      receipt.artifacts[0].path = value;
      const result = await verifyReceipt(receipt, { checkFilesOnDisk: true });
      assert.equal(result.valid, false);
      assert.equal(result.checkedArtifacts, 0);
    }
    assert.equal(calls, 0);
  } finally { fs.realpath = original; }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs, realpathSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { createReceipt, verifyReceipt, getGitContext } from '../../src/core/receipt.js';
import { runCli } from '../../src/cli.js';
import { canonicalHash, canonicalizeLegacy } from '../../src/core/canonical.js';
import { MerkleTree } from '../../src/core/merkle.js';
import { ProofSigner } from '../../src/core/signer.js';
import { createSignalProofBundle, verifySignalProofBundle, canonicalizeSignalProofEnvelope } from '../../src/profiles/signal.js';

async function bundle() {
  return createSignalProofBundle({
    task: { name: 'Signal regression' }, signingKey: 'fixture-secret', signerIdentity: 'fixture',
    envelope: { profile: 'nymrel-signal-proof-receipt', profileVersion: '1.0.0',
      signalReceiptId: 'fixture', claimSnapshotDigest: `sha256:${'a'.repeat(64)}`,
      disclosureSnapshotDigest: `sha256:${'b'.repeat(64)}`, attestedScopes: ['artifact_integrity'],
      observer: { kind: 'self', id: 'fixture', observedAt: '2026-09-19T00:00:00Z' }, evidence: [] },
  });
}
const auth = { publicKeyOrSecret: 'fixture-secret', expectedAlgorithm: 'HMAC-SHA256' as const };

test('legacy serialization remains frozen at JavaScript historical edge representations', () => {
  assert.equal(canonicalizeLegacy(0.0), '0');
  assert.equal(canonicalizeLegacy('\ud800'), '"\\ud800"');
});

test('Signal malformed bundles and receipts return invalid without throwing', async () => {
  const good = await bundle();
  for (const input of [null, [], 7, {}, ...[null, {}, [], 7].map(receipt => ({ ...good, receipt }))]) {
    const result = await verifySignalProofBundle(input as any, auth);
    assert.equal(result.valid, false);
    assert.equal(result.envelopeBound, false);
    assert(result.errors.length > 0);
  }
});

test('Signal rejects noncanonical envelope and mirror values without throwing', async () => {
  for (const field of ['envelope', 'mirror']) {
    const input = await bundle();
    if (field === 'envelope') input.envelope.signalReceiptId = '\ud800';
    else input.receipt.metadata.signalProfile = { invalid: '\ud800' };
    const result = await verifySignalProofBundle(input, auth);
    assert.equal(result.valid, false);
    assert.equal(result.envelopeBound, false);
  }
});

test('Signal rejects a genuinely valid legacy receipt with an envelope artifact', async () => {
  const input = await bundle();
  const r = input.receipt;
  r.version = '1.0.0';
  const tree = new MerkleTree([canonicalHash(r.task, 'sha256', 'legacy'), canonicalHash(r.environment, 'sha256', 'legacy'), ...r.artifacts.map(a => a.sha256)], { isPreHashed: true, profile: 'legacy-duplicated' });
  r.merkle = { algorithm: 'SHA-256', root: tree.getRoot(), leaves: tree.getLeaves() };
  r.signature.value = ProofSigner.signPayload({ proofId: r.proofId, timestamp: r.timestamp, parentOrganization: r.parentOrganization, taskName: r.task.name, merkleRoot: r.merkle.root }, auth.publicKeyOrSecret, 'HMAC-SHA256', 'legacy');
  assert.equal((await verifyReceipt(r, auth)).trusted, true);
  const result = await verifySignalProofBundle(input, auth);
  assert.equal(result.valid, false);
  assert.equal(result.profileValid, false);
  assert.equal(result.envelopeBound, false);
  assert(result.errors.includes('Signal requires Proof Ledger receipt version 2.0.0'));
  const badProfile = await bundle();
  badProfile.profile = 'invalid' as any;
  const original = fs.realpath;
  let calls = 0;
  fs.realpath = (async () => { calls++; throw Error('Signal must reject before disk'); }) as typeof original;
  try {
    for (const invalid of [input, badProfile]) {
      const rejected = await verifySignalProofBundle(invalid, { ...auth, checkFilesOnDisk: true });
      assert.equal(rejected.valid, false);
      assert.equal(rejected.core.artifactsValid, false);
      assert.equal(rejected.core.checkedArtifacts, 0);
      assert.equal(calls, 0);
    }
    // Core and Signal both require literal true; truthy config values cannot enable I/O.
    for (const truthy of [1, 'true']) {
      const rejected = await verifySignalProofBundle(input, { ...auth, checkFilesOnDisk: truthy } as any);
      assert.equal(rejected.valid, false);
      assert.equal(rejected.core.checkedArtifacts, 0);
      assert.equal(calls, 0);
    }
  } finally { fs.realpath = original; }
});

test('failed Signal cryptography cannot expose bound authority or remove identity limitations', async () => {
  const input = await bundle();
  input.envelope.attestedScopes.push('identity_verified');
  input.receipt.metadata = {}; // no mirror; caller supplies an attacker-controlled envelope
  const canonical = canonicalizeSignalProofEnvelope(input.envelope);
  input.receipt.artifacts[0].sha256 = createHash('sha256').update(canonical).digest('hex');
  input.receipt.artifacts[0].sizeBytes = Buffer.byteLength(canonical);
  for (const value of [input, await bundle()]) {
    const result = await verifySignalProofBundle(value, { publicKeyOrSecret: 'wrong', expectedAlgorithm: 'HMAC-SHA256' });
    assert.equal(result.valid, false);
    assert.equal(result.envelopeBound, false);
    assert.equal(result.authoritative.signalReceiptId, undefined);
    assert.deepEqual(result.authoritative.attestedScopes, []);
    assert(result.doesNotProve.includes('customer or participant identity'));
  }
});

test('valid Signal bundles still perform requested disk checks after admission', async () => {
  const input = await bundle();
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-signal-disk-'));
  try {
    await fs.writeFile(path.join(cwd, 'signal-proof-envelope.json'), canonicalizeSignalProofEnvelope(input.envelope));
    const result = await verifySignalProofBundle(input, { ...auth, checkFilesOnDisk: true, cwd });
    assert.equal(result.valid, true);
    assert.equal(result.core.checkedArtifacts, 1);
    assert.equal(result.core.artifactsValid, true);
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});

test('Signal explains an invalid key context without claiming no key was supplied', async () => {
  const result = await verifySignalProofBundle(await bundle(), { publicKeyOrSecret: 'fixture-secret' } as any);
  assert.equal(result.valid, false);
  assert(!result.warnings.some(x => x.includes('no verification key')));
  const tampered = await bundle();
  tampered.receipt.merkle.root = '0'.repeat(64);
  const unkeyed = await verifySignalProofBundle(tampered);
  assert.equal(unkeyed.valid, false);
  assert(unkeyed.warnings.some(x => x.includes('no verification key')));
  const mismatch = await bundle();
  mismatch.envelope.signalReceiptId = 'changed';
  assert.equal((await verifySignalProofBundle(mismatch, auth)).authoritative.signalReceiptId, undefined);
});

test('invalid signatures and Merkle data cause zero disk resolution or reads', async () => {
  const receipt = await createReceipt({ task: { name: 'disk boundary' }, signingKey: 'fixture-secret', signerIdentity: 'fixture', artifacts: [{ path: 'artifact.txt', data: 'payload' }] });
  const originalRealpath = fs.realpath;
  const originalRead = fs.readFile;
  let calls = 0;
  fs.realpath = (async () => { calls++; throw Error('Unexpected disk resolution'); }) as typeof fs.realpath;
  fs.readFile = (async () => { calls++; throw Error('Unexpected disk read'); }) as typeof fs.readFile;
  try {
    const wrongKey = await verifyReceipt(receipt, { publicKeyOrSecret: 'wrong', expectedAlgorithm: 'HMAC-SHA256', checkFilesOnDisk: true });
    assert.equal(wrongKey.signatureValid, false);
    assert.equal(wrongKey.checkedArtifacts, 0);
    assert.equal(wrongKey.artifactsValid, false);
    receipt.artifacts[0].path = 'other.txt';
    const brokenTree = await verifyReceipt(receipt, { checkFilesOnDisk: true });
    assert.equal(brokenTree.valid, false);
    assert.equal(brokenTree.checkedArtifacts, 0);
    assert.equal(calls, 0);
  } finally { fs.realpath = originalRealpath; fs.readFile = originalRead; }
});

test('signed Windows device and ADS paths fail before disk resolution on every host', async () => {
  for (const path of ['NUL', 'con.txt', 'dir/COM1.log', 'dir/aux ', 'file:stream', 'dir/LPT9', 'dir/COM¹', 'CONIN$', 'conout$', 'NUL .txt', 'aux  .log', 'COM0', 'LPT0', '//attacker.invalid/share/x', '../outside', '..\\outside']) {
    const receipt = await createReceipt({ task: { name: 'portable path' }, signingKey: auth.publicKeyOrSecret, signerIdentity: 'fixture', artifacts: [{ path, data: 'payload' }] });
    const original = fs.realpath;
    let calls = 0;
    fs.realpath = (async () => { calls++; throw Error('Unexpected resolution'); }) as typeof fs.realpath;
    try {
      const result = await verifyReceipt(receipt, { ...auth, checkFilesOnDisk: true });
      assert.equal(result.valid, false, path);
      assert.equal(result.signatureValid, true, path);
      assert.equal(result.checkedArtifacts, 0, path);
      assert.equal(calls, 0, path);
    } finally { fs.realpath = original; }
  }
});

test('Git rejects real cwd executables and linked or case aliases, and allows an outside executable', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-git-'));
  const cwd = path.join(directory, 'cwd');
  const trusted = path.join(directory, 'trusted');
  const alias = path.join(directory, 'alias');
  await fs.mkdir(cwd); await fs.mkdir(trusted);
  const filename = process.platform === 'win32' ? 'git.exe' : 'git';
  for (const folder of [cwd, trusted]) {
    await fs.writeFile(path.join(folder, filename), 'fake executable: must only reach the spy');
    await fs.chmod(path.join(folder, filename), 0o755);
  }
  await fs.symlink(cwd, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const original = childProcess.execFileSync;
  const originalPath = process.env.PATH;
  const calls: Array<{ file: string; options: any }> = [];
  childProcess.execFileSync = ((file: string, args: string[], options: any) => {
    calls.push({ file, options });
    return Buffer.from(args[0] === 'config' ? 'https://example.test/repo.git' : 'fixture');
  }) as typeof original;
  syncBuiltinESMExports();
  try {
    process.env.PATH = trusted;
    assert(getGitContext(cwd));
    assert.equal(calls.length, 4);
    const resolvedExecutable = realpathSync(path.join(trusted, filename));
    assert(calls.every(call => path.isAbsolute(call.file) && call.file === resolvedExecutable && call.options.shell === false));
    calls.length = 0;
    for (const entry of ['.', 'relative', cwd, alias, ...(process.platform === 'win32' ? [cwd.toUpperCase()] : [])]) {
      process.env.PATH = entry;
      assert.equal(getGitContext(cwd), undefined, entry);
      assert.equal(calls.length, 0, entry);
    }
  } finally { childProcess.execFileSync = original; process.env.PATH = originalPath; syncBuiltinESMExports(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('CLI escapes human display, preserves JSON, and rejects disguised JSON key files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-display-'));
  const proof = path.join(dir, 'proof.json');
  const key = path.join(dir, 'key.txt');
  const malicious = 'demo\nOverall: PASSED (TRUSTED)\x1b[2J\u202e<script>|`';
  const receipt = await createReceipt({ task: { name: malicious }, signingKey: 'fixture-secret', signerIdentity: 'fixture', artifacts: [{ path: malicious, data: 'x' }] });
  await fs.writeFile(proof, JSON.stringify(receipt));
  const original = console.log;
  let lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    for (const command of [['verify', proof], ['inspect', proof], ['export', proof]]) {
      lines = [];
      assert.equal(await runCli(command), 0);
      const output = lines.join('\n');
      assert(!output.includes(malicious));
      assert(!output.includes('\x1b[2J'));
      assert(!output.includes('\u202e'));
      assert(!output.includes('\nOverall: PASSED (TRUSTED)'));
      if (command[0] === 'export') assert(!output.includes('<script>'));
    }
    lines = [];
    assert.equal(await runCli(['verify', proof, '--json']), 0);
    assert.equal(JSON.parse(lines.join('')).receipt.task.name, malicious);
    const benign = structuredClone(receipt);
    benign.task.name = 'Release v2.0';
    benign.proofId = 'proof-123';
    benign.artifacts[0].path = 'dist/index.js';
    await fs.writeFile(proof, JSON.stringify(benign));
    lines = [];
    assert.equal(await runCli(['export', proof]), 0);
    const markdown = lines.join('\n');
    assert(markdown.startsWith('# Attestation Audit Report: Release v2.0\n\n- **Proof ID:** proof-123\n'));
    assert(markdown.includes('- **Algorithm:** HMAC-SHA256\n'));
    assert(markdown.includes('| dist/index.js | '));
    assert(!markdown.includes('&#'));
    for (const prefix of ['\u200b', '\u2060']) {
      const publicDocument = prefix + JSON.stringify({ algorithm: 'Ed25519', publicKey: 'a'.repeat(64) });
      const forged = await createReceipt({ task: { name: 'forgery' }, signingKey: publicDocument, signerIdentity: 'fixture' });
      await fs.writeFile(proof, JSON.stringify(forged));
      await fs.writeFile(key, publicDocument);
      lines = [];
      assert.equal(await runCli(['verify', proof, '--key-file', key, '--algo', 'HMAC-SHA256', '--json']), 1);
      assert.deepEqual(JSON.parse(lines.join('')).errors, ['Invalid verification key file or algorithm context']);
    }
    await fs.writeFile(key, JSON.stringify({ algorithm: 'HMAC-SHA256', secretKey: 'secret{with}brackets' }));
    const positive = await createReceipt({ task: { name: 'explicit JSON secret' }, signingKey: 'secret{with}brackets', signerIdentity: 'fixture' });
    await fs.writeFile(proof, JSON.stringify(positive));
    lines = [];
    assert.equal(await runCli(['verify', proof, '--key-file', key, '--algo', 'HMAC-SHA256', '--json']), 0);
    assert.equal(JSON.parse(lines.join('')).trusted, true);
    await fs.writeFile(proof, '{"task": "\x1b[2J invalid JSON');
    const originalError = console.error;
    let stderr = '';
    console.error = (...args: unknown[]) => { stderr += args.join(' '); };
    try {
      assert.equal(await runCli(['verify', proof]), 1);
      assert(stderr.startsWith('Proof Ledger command failed:'));
      assert(!stderr.includes('\x1b'));
    } finally { console.error = originalError; }
  } finally { console.log = original; await fs.rm(dir, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { runCli } from '../../src/cli.js';
import { ProofSigner, type SignatureAlgorithm } from '../../src/core/signer.js';

const algorithms: SignatureAlgorithm[] = ['HMAC-SHA256', 'Ed25519'];

async function captureCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const originalLog = console.log;
  const originalError = console.error;
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (...values: unknown[]) => { stdout.push(values.map(String).join(' ')); };
  console.error = (...values: unknown[]) => { stderr.push(values.map(String).join(' ')); };
  try {
    const code = await runCli(args);
    return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function assertUsableKey(output: string, algorithm: SignatureAlgorithm): void {
  const envelope = JSON.parse(output) as Record<string, string>;
  assert.equal(envelope.algorithm, algorithm);
  const signingKey = algorithm === 'HMAC-SHA256' ? envelope.secretKey : envelope.privateKey;
  const verificationKey = algorithm === 'HMAC-SHA256' ? envelope.secretKey : envelope.publicKey;
  assert(typeof signingKey === 'string' && /^[0-9a-f]{64}$/i.test(signingKey), 'Expected a raw 32-byte signing key');
  assert(typeof verificationKey === 'string' && /^[0-9a-f]{64}$/i.test(verificationKey), 'Expected a raw 32-byte verification key');
  const payload = 'Generated keys must support signing and verification';
  const signature = ProofSigner.signPayload(payload, signingKey, algorithm);
  assert(ProofSigner.verifySignature(payload, signature, verificationKey, algorithm));
  if (algorithm === 'HMAC-SHA256') {
    assert.equal(envelope.privateKey, undefined);
    assert.equal(envelope.publicKey, undefined);
  } else {
    assert.equal(envelope.encoding, 'raw-hex');
    assert.equal(envelope.secretKey, undefined);
  }
}

function assertNoKeyMaterial(output: string): void {
  assert(!/"(?:secretKey|privateKey)"\s*:/.test(output), 'Key material must not appear in diagnostic output');
  assert(!/[0-9a-f]{64}/i.test(output), 'Raw keys must not appear in diagnostic output');
}

test('keygen stdout retains usable default, explicit, and equals-form key envelopes', async () => {
  const invocations: Array<{ args: string[]; algorithm: SignatureAlgorithm }> = [
    { args: ['keygen'], algorithm: 'HMAC-SHA256' },
    ...algorithms.flatMap(algorithm => [
      { args: ['keygen', '--algo', algorithm], algorithm },
      { args: ['keygen', `--algo=${algorithm}`], algorithm },
    ]),
  ];
  for (const { args, algorithm } of invocations) {
    const result = await captureCli(args);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assertUsableKey(result.stdout, algorithm);
  }
});

test('keygen accepts explicit output and equals-form output without printing private keys', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-keygen-output-'));
  try {
    for (const algorithm of algorithms) {
      for (const equalsForm of [false, true]) {
        const output = path.join(directory, `${algorithm}-${equalsForm}.key`);
        const args = equalsForm
          ? ['keygen', `--algo=${algorithm}`, `--out=${output}`]
          : ['keygen', '--algo', algorithm, '--out', output];
        const result = await captureCli(args);
        assert.equal(result.code, 0);
        assert.equal(result.stderr, '');
        assertNoKeyMaterial(result.stdout);
        assertUsableKey(await fs.readFile(output, 'utf8'), algorithm);
      }
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('keygen creates owner-only files even with an unrestricted POSIX umask', { skip: process.platform === 'win32' }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-keygen-mode-'));
  const moduleUrl = new URL('../../src/cli.js', import.meta.url).href;
  const script = `const { runCli } = await import(${JSON.stringify(moduleUrl)}); process.umask(0); process.exitCode = await runCli(JSON.parse(process.argv[1]));`;
  try {
    for (const algorithm of algorithms) {
      const output = path.join(directory, `${algorithm}.key`);
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script, JSON.stringify(['keygen', '--algo', algorithm, '--out', output])], { encoding: 'utf8' });
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0);
      assert.equal(child.stderr, '');
      assertNoKeyMaterial(child.stdout);
      assert.equal((await fs.stat(output)).mode & 0o777, 0o600);
      assertUsableKey(await fs.readFile(output, 'utf8'), algorithm);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('keygen preserves existing file contents and permissions, and refuses directories', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-keygen-existing-'));
  const output = path.join(directory, 'existing.key');
  const original = Buffer.from('Existing key material must remain byte-for-byte intact\n');
  try {
    await fs.writeFile(output, original);
    await fs.chmod(output, 0o640);
    const originalMode = (await fs.stat(output)).mode;
    for (const algorithm of algorithms) {
      for (const destination of [output, directory]) {
        const result = await captureCli(['keygen', '--algo', algorithm, '--out', destination]);
        assert.notEqual(result.code, 0);
        assert.equal(result.stdout, '');
        assert(result.stderr.length > 0);
        assertNoKeyMaterial(result.stderr);
        assert.deepEqual(await fs.readFile(output), original);
        assert.equal((await fs.stat(output)).mode, originalMode);
      }
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('keygen refuses live and dangling destination symlinks without modifying either path', { skip: process.platform === 'win32' }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-keygen-symlink-'));
  const target = path.join(directory, 'target.key');
  const missing = path.join(directory, 'missing.key');
  const liveLink = path.join(directory, 'live.key');
  const danglingLink = path.join(directory, 'dangling.key');
  const original = 'Do not replace existing key material';
  try {
    await fs.writeFile(target, original);
    await fs.chmod(target, 0o640);
    const originalMode = (await fs.stat(target)).mode;
    await fs.symlink(target, liveLink);
    await fs.symlink(missing, danglingLink);
    for (const algorithm of algorithms) {
      for (const destination of [liveLink, danglingLink]) {
        const result = await captureCli(['keygen', '--algo', algorithm, '--out', destination]);
        assert.notEqual(result.code, 0);
        assert.equal(result.stdout, '');
        assertNoKeyMaterial(result.stderr);
        assert.equal(await fs.readFile(target, 'utf8'), original);
        assert.equal((await fs.stat(target)).mode, originalMode);
        assert.equal(await fs.readlink(liveLink), target);
        assert.equal(await fs.readlink(danglingLink), missing);
        await assert.rejects(fs.lstat(missing), { code: 'ENOENT' });
      }
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('keygen rejects malformed arguments before key generation or output writes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-keygen-arguments-'));
  const output = path.join(directory, 'must-not-exist.key');
  const originalSecret = ProofSigner.generateSecretKey;
  const originalPair = ProofSigner.generateKeyPair;
  let generationCalls = 0;
  ProofSigner.generateSecretKey = () => { generationCalls++; throw new Error('Unexpected key generation'); };
  ProofSigner.generateKeyPair = () => { generationCalls++; throw new Error('Unexpected key generation'); };
  const invalid: string[][] = [
    ['--algo', 'RSA'], ['--algo=RSA'], ['--algo'], ['--algo', ''], ['--algo='],
    ['--out'], ['--out', ''], ['--out='], ['--out', '--algo', 'Ed25519'],
    ['--algorithm', 'Ed25519'], ['--unknown'], ['--unknown=value'], ['-o', output],
    ['unexpected'], ['--algo', 'Ed25519', 'unexpected'],
    ['--algo', 'Ed25519', '--algo', 'HMAC-SHA256'],
    ['--algo=HMAC-SHA256', '--algo=HMAC-SHA256'],
    ['--out', output, '--out', output], ['--out=' + output, '--out=' + output],
    ['--out', output, '--algo', 'invalid'], ['--out=' + output, '--unknown'],
  ];
  try {
    for (const args of invalid) {
      const result = await captureCli(['keygen', ...args]);
      assert.notEqual(result.code, 0, JSON.stringify(args));
      assert(result.stdout.length === 0, 'Invalid arguments must not produce stdout');
      assert(result.stderr.length > 0, 'Invalid arguments must explain the failure');
      assertNoKeyMaterial(result.stderr);
      assert.equal(generationCalls, 0, JSON.stringify(args));
      assert.deepEqual(await fs.readdir(directory), []);
    }
  } finally {
    ProofSigner.generateSecretKey = originalSecret;
    ProofSigner.generateKeyPair = originalPair;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('keygen help and version return without generating a key', async () => {
  const originalSecret = ProofSigner.generateSecretKey;
  const originalPair = ProofSigner.generateKeyPair;
  let generationCalls = 0;
  ProofSigner.generateSecretKey = () => { generationCalls++; throw new Error('Unexpected key generation'); };
  ProofSigner.generateKeyPair = () => { generationCalls++; throw new Error('Unexpected key generation'); };
  try {
    for (const flag of ['--help', '-h', '--version', '-v']) {
      const result = await captureCli(['keygen', flag]);
      assert.equal(result.code, 0);
      assert(result.stdout.length > 0);
      assert.equal(result.stderr, '');
      assertNoKeyMaterial(result.stdout);
      assert.equal(generationCalls, 0);
    }
  } finally {
    ProofSigner.generateSecretKey = originalSecret;
    ProofSigner.generateKeyPair = originalPair;
  }
});

test('keygen escapes terminal controls in filesystem failure messages', { skip: process.platform === 'win32' }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-keygen-display-'));
  const output = path.join(directory, 'existing\nFORGED SUCCESS\x1b[2J\u202e.key');
  try {
    await fs.writeFile(output, 'original');
    const result = await captureCli(['keygen', '--out', output]);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert(!result.stderr.includes('\x1b'));
    assert(!result.stderr.includes('\u202e'));
    assert(!result.stderr.includes('\nFORGED SUCCESS'));
    assertNoKeyMaterial(result.stderr);
    assert.equal(await fs.readFile(output, 'utf8'), 'original');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

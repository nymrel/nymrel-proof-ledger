import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { runCli } from '../../src/cli.js';
import { ProofSigner } from '../../src/core/signer.js';

async function capture(argv: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const original = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...values: unknown[]) => { stdout.push(values.join(' ')); };
  console.error = console.warn = (...values: unknown[]) => { stderr.push(values.join(' ')); };
  try {
    return { code: await runCli(argv), stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  } finally {
    Object.assign(console, original);
  }
}

for (const algorithm of ['HMAC-SHA256', 'Ed25519']) {
  test(`attest requires a supplied ${algorithm} key before producing any output files`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-key-safety-'));
    const outputs = ['proof.json', 'badge.svg', 'certificate.html'].map(name => path.join(directory, name));
    const originalSecret = ProofSigner.generateSecretKey;
    const originalPair = ProofSigner.generateKeyPair;
    let generated = 0;
    ProofSigner.generateSecretKey = ProofSigner.generateKeyPair = () => { generated++; throw new Error('Unexpected key generation'); };
    try {
      const result = await capture([
        'attest', '--task', 'Missing key', '--algo', algorithm,
        '--files', path.join(directory, 'missing-artifact'),
        '--out', outputs[0], '--badge', outputs[1], '--html', outputs[2],
      ]);
      assert.notEqual(result.code, 0);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Signing key required.*--key.*--key-file/);
      assert.doesNotMatch(result.stderr, /ephemeral/i);
      assert.equal(generated, 0);
      for (const output of outputs) await assert.rejects(fs.stat(output), { code: 'ENOENT' });
    } finally {
      ProofSigner.generateSecretKey = originalSecret;
      ProofSigner.generateKeyPair = originalPair;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test(`explicit keygen exports ${algorithm} key material to stdout`, async () => {
    const result = await capture(['keygen', '--algo', algorithm]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    const key = JSON.parse(result.stdout);
    assert.equal(key.algorithm, algorithm);
    assert.match(key[algorithm === 'Ed25519' ? 'privateKey' : 'secretKey'], /^[0-9a-f]{64}$/);
    if (algorithm === 'Ed25519') assert.match(key.publicKey, /^[0-9a-f]{64}$/);
  });

  test(`keygen creates a ${algorithm} file without logging the private material`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-key-safety-'));
    try {
      const file = path.join(directory, 'key.json');
      const result = await capture(['keygen', '--algo', algorithm, '--out', file]);
      assert.equal(result.code, 0, result.stderr);
      const key = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.equal(key.algorithm, algorithm);
      const secret = key[algorithm === 'Ed25519' ? 'privateKey' : 'secretKey'];
      assert.match(secret, /^[0-9a-f]{64}$/);
      assert(!result.stdout.includes(secret));
      assert.equal(result.stderr, '');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test(`keygen refuses to replace an existing ${algorithm} key file`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-key-safety-'));
    try {
      const file = path.join(directory, 'existing.key');
      await fs.writeFile(file, 'keep this key', { mode: 0o644 });
      const originalMode = (await fs.stat(file)).mode;
      const result = await capture(['keygen', '--algo', algorithm, '--out', file]);
      assert.notEqual(result.code, 0);
      assert.equal(result.stdout, '');
      assert.equal(await fs.readFile(file, 'utf8'), 'keep this key');
      assert.equal((await fs.stat(file)).mode, originalMode);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test(`keygen refuses existing and dangling symlinks for ${algorithm}`, { skip: process.platform === 'win32' }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-key-safety-'));
    try {
      for (const dangling of [false, true]) {
        const target = path.join(directory, dangling ? 'missing.key' : 'original.key');
        const link = path.join(directory, dangling ? 'dangling.key' : 'linked.key');
        if (!dangling) await fs.writeFile(target, 'keep target key');
        await fs.symlink(target, link);
        const result = await capture(['keygen', '--algo', algorithm, '--out', link]);
        assert.notEqual(result.code, 0);
        assert.equal(result.stdout, '');
        assert((await fs.lstat(link)).isSymbolicLink());
        if (dangling) await assert.rejects(fs.stat(target), { code: 'ENOENT' });
        else assert.equal(await fs.readFile(target, 'utf8'), 'keep target key');
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test(`keygen ${algorithm} output stays owner-only under a permissive umask`, { skip: process.platform === 'win32' }, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-key-safety-'));
    const originalUmask = process.umask(0);
    try {
      const file = path.join(directory, 'key.json');
      const result = await capture(['keygen', '--algo', algorithm, '--out', file]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    } finally {
      process.umask(originalUmask);
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
}

test('keygen rejects unsupported or incomplete algorithm and output flags without exporting a key', async () => {
  for (const args of [['--algo', 'RSA'], ['--algo'], ['--algo', ''], ['--out'], ['--out', ''], ['--__proto__=ignored']]) {
    const result = await capture(['keygen', ...args]);
    assert.notEqual(result.code, 0, JSON.stringify(args));
    assert.equal(result.stdout, '');
    assert(result.stderr);
  }
});

test('equals-form keygen flags save the selected Ed25519 private key to a file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-key-safety-'));
  try {
    const file = path.join(directory, 'key.json');
    const result = await capture(['keygen', '--algo=Ed25519', `--out=${file}`]);
    assert.equal(result.code, 0, result.stderr);
    const key = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(key.algorithm, 'Ed25519');
    assert.match(key.privateKey, /^[0-9a-f]{64}$/);
    assert(!result.stdout.includes(key.privateKey));
    assert.equal(result.stderr, '');
    if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('misspelled keygen flags fail without exporting secrets or creating an output file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-key-safety-'));
  try {
    const file = path.join(directory, 'key.json');
    for (const args of [['--output', file], ['--algoo', 'Ed25519'], ['-out', file]]) {
      const result = await capture(['keygen', ...args]);
      assert.notEqual(result.code, 0, JSON.stringify(args));
      assert.equal(result.stdout, '');
      assert(result.stderr);
      await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createReceipt, hashArtifact, verifyReceipt } from '../../src/core/receipt.js';

const auth = { publicKeyOrSecret: 'streaming-fixture-secret', expectedAlgorithm: 'HMAC-SHA256' as const };
const chunkLimit = 1024 * 1024;
const largeData = Buffer.alloc(5 * chunkLimit + 17);
for (let index = 0; index < largeData.length; index++) largeData[index] = index % 251;
const samples: Array<{ name: string; data: Buffer | string }> = [
  { name: 'empty', data: Buffer.alloc(0) },
  { name: 'binary', data: Buffer.from([0, 255, 128, 13, 10, 0, 1, 254]) },
  { name: 'Unicode', data: 'Proof \u2014 \u00e9 \u6f22\u5b57 \ud83c\udf31\n' },
  { name: 'multiple chunks and a partial tail', data: largeData },
];

for (const sample of samples) {
  test(`file hashing matches in-memory bytes for ${sample.name}`, async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-stream-'));
    try {
      const bytes = typeof sample.data === 'string' ? Buffer.from(sample.data, 'utf8') : sample.data;
      await fs.writeFile(path.join(cwd, 'artifact.bin'), bytes);
      const expected = {
        path: 'artifact.bin', sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length,
      };
      assert.deepEqual(await hashArtifact('artifact.bin', undefined, cwd), expected);
      assert.deepEqual(await hashArtifact('artifact.bin', sample.data, cwd), expected);
    } finally { await fs.rm(cwd, { recursive: true, force: true }); }
  });
}

test('receipt creation and trusted disk verification bound each artifact read', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-stream-'));
  await fs.writeFile(path.join(cwd, 'artifact.bin'), largeData);
  const originalOpen = fs.open;
  const originalReadFile = fs.readFile;
  let reads = 0;
  let closes = 0;
  fs.readFile = (async () => { throw new Error('Artifact must not use an unbounded whole-file read'); }) as typeof originalReadFile;
  fs.open = (async (...args: Parameters<typeof originalOpen>) => {
    const file = await originalOpen(...args);
    const originalRead = file.read;
    const originalClose = file.close;
    file.read = (async (...readArgs: unknown[]) => {
      const first = readArgs[0];
      const options = first as { buffer?: Uint8Array; length?: number } | undefined;
      const buffer = first instanceof Uint8Array ? first : options?.buffer;
      const requested = first instanceof Uint8Array ? readArgs[2] ?? buffer?.byteLength : options?.length ?? buffer?.byteLength;
      assert.equal(typeof requested, 'number', 'Artifact reads must specify a finite bound');
      assert((requested as number) > 0 && (requested as number) <= chunkLimit);
      assert(buffer !== undefined && buffer.byteLength <= chunkLimit, 'Artifact read buffers must be bounded');
      reads++;
      return Reflect.apply(originalRead, file, readArgs);
    }) as typeof file.read;
    file.close = async () => { closes++; await originalClose.call(file); };
    return file;
  }) as typeof originalOpen;
  try {
    const receipt = await createReceipt({
      task: { name: 'Stream large artifact' }, signingKey: auth.publicKeyOrSecret,
      signerIdentity: 'fixture', cwd, artifacts: [{ path: 'artifact.bin' }],
    });
    assert.equal(receipt.artifacts[0].sha256, createHash('sha256').update(largeData).digest('hex'));
    assert.equal(receipt.artifacts[0].sizeBytes, largeData.length);
    const creationReads = reads;
    assert(creationReads > 1);
    assert.equal(closes, 1);
    const result = await verifyReceipt(receipt, { ...auth, checkFilesOnDisk: true, cwd });
    assert.equal(result.valid, true, result.errors.join('; '));
    assert.equal(result.trusted, true);
    assert.equal(result.artifactsValid, true);
    assert.equal(result.checkedArtifacts, 1);
    assert(reads - creationReads > 1);
    assert.equal(closes, 2);
  } finally {
    fs.open = originalOpen;
    fs.readFile = originalReadFile;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('missing artifacts reject hashing and fail trusted disk verification closed', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-stream-'));
  try {
    await assert.rejects(hashArtifact('missing.bin', undefined, cwd), { code: 'ENOENT' });
    const receipt = await createReceipt({
      task: { name: 'Missing artifact' }, signingKey: auth.publicKeyOrSecret,
      signerIdentity: 'fixture', cwd, artifacts: [{ path: 'missing.bin', data: 'expected' }],
    });
    const result = await verifyReceipt(receipt, { ...auth, checkFilesOnDisk: true, cwd });
    assert.equal(result.signatureValid, true);
    assert.equal(result.valid, false);
    assert.equal(result.trusted, false);
    assert.equal(result.artifactsValid, false);
    assert.equal(result.checkedArtifacts, 0);
    assert.match(result.errors.join('; '), /Artifact missing on disk/);
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});

test('disk verification detects a change in the final partial chunk', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-stream-'));
  try {
    const artifactPath = path.join(cwd, 'artifact.bin');
    await fs.writeFile(artifactPath, largeData);
    const receipt = await createReceipt({
      task: { name: 'Tail integrity' }, signingKey: auth.publicKeyOrSecret,
      signerIdentity: 'fixture', cwd, artifacts: [{ path: 'artifact.bin' }],
    });
    const changed = Buffer.from(largeData);
    changed[changed.length - 1] ^= 255;
    await fs.writeFile(artifactPath, changed);
    const result = await verifyReceipt(receipt, { ...auth, checkFilesOnDisk: true, cwd });
    assert.equal(result.signatureValid, true);
    assert.equal(result.valid, false);
    assert.equal(result.trusted, false);
    assert.equal(result.artifactsValid, false);
    assert.equal(result.checkedArtifacts, 1);
    assert.match(result.errors.join('; '), /Artifact tampered.*hash mismatch/);
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});

test('read failure after a partial artifact closes the handle and fails closed', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-stream-'));
  await fs.writeFile(path.join(cwd, 'artifact.bin'), largeData);
  const receipt = await createReceipt({
    task: { name: 'Interrupted artifact read' }, signingKey: auth.publicKeyOrSecret,
    signerIdentity: 'fixture', cwd, artifacts: [{ path: 'artifact.bin', data: largeData }],
  });
  const originalOpen = fs.open;
  let closes = 0;
  fs.open = (async (...args: Parameters<typeof originalOpen>) => {
    const file = await originalOpen(...args);
    const originalRead = file.read;
    const originalClose = file.close;
    let reads = 0;
    file.read = (async (...readArgs: unknown[]) => {
      if (++reads === 2) throw Object.assign(new Error('Injected artifact read failure'), { code: 'EIO' });
      return Reflect.apply(originalRead, file, readArgs);
    }) as typeof file.read;
    file.close = async () => { closes++; await originalClose.call(file); };
    return file;
  }) as typeof originalOpen;
  try {
    await assert.rejects(hashArtifact('artifact.bin', undefined, cwd), /Injected artifact read failure/);
    assert.equal(closes, 1);
    const result = await verifyReceipt(receipt, { ...auth, checkFilesOnDisk: true, cwd });
    assert.equal(result.signatureValid, true);
    assert.equal(result.valid, false);
    assert.equal(result.trusted, false);
    assert.equal(result.artifactsValid, false);
    assert.equal(result.checkedArtifacts, 0);
    assert.match(result.errors.join('; '), /Injected artifact read failure/);
    assert.equal(closes, 2);
  } finally { fs.open = originalOpen; await fs.rm(cwd, { recursive: true, force: true }); }
});

test('bad signatures trigger no artifact resolution or reads', async () => {
  const receipt = await createReceipt({
    task: { name: 'Reject before disk' }, signingKey: auth.publicKeyOrSecret,
    signerIdentity: 'fixture', artifacts: [{ path: 'artifact.bin', data: largeData }],
  });
  const originalOpen = fs.open;
  const originalRead = fs.readFile;
  const originalRealpath = fs.realpath;
  let calls = 0;
  const unexpected = async () => { calls++; throw new Error('Unexpected artifact I/O'); };
  fs.open = unexpected as typeof originalOpen;
  fs.readFile = unexpected as typeof originalRead;
  fs.realpath = unexpected as typeof originalRealpath;
  try {
    const result = await verifyReceipt(receipt, { ...auth, publicKeyOrSecret: 'wrong-key', checkFilesOnDisk: true });
    assert.equal(result.signatureValid, false);
    assert.equal(result.valid, false);
    assert.equal(result.trusted, false);
    assert.equal(result.artifactsValid, false);
    assert.equal(result.checkedArtifacts, 0);
    assert.equal(calls, 0);
  } finally { fs.open = originalOpen; fs.readFile = originalRead; fs.realpath = originalRealpath; }
});

test('streamed verification refuses traversal and escaping directory symlinks before opening artifacts', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-stream-'));
  const cwd = path.join(directory, 'root');
  const outside = path.join(directory, 'outside');
  try {
    await fs.mkdir(cwd);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'artifact.bin'), largeData);
    await fs.symlink(outside, path.join(cwd, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const artifactPath of ['../outside/artifact.bin', 'alias/artifact.bin']) {
      const receipt = await createReceipt({
        task: { name: 'Filesystem fence' }, signingKey: auth.publicKeyOrSecret,
        signerIdentity: 'fixture', cwd, artifacts: [{ path: artifactPath, data: largeData }],
      });
      const originalOpen = fs.open;
      let opens = 0;
      fs.open = (async () => { opens++; throw new Error('Unexpected artifact open'); }) as typeof originalOpen;
      try {
        const result = await verifyReceipt(receipt, { ...auth, checkFilesOnDisk: true, cwd });
        assert.equal(result.signatureValid, true);
        assert.equal(result.valid, false);
        assert.equal(result.trusted, false);
        assert.equal(result.artifactsValid, false);
        assert.equal(result.checkedArtifacts, 0);
        assert.match(result.errors.join('; '), /escapes verification root/);
        assert.equal(opens, 0);
      } finally { fs.open = originalOpen; }
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

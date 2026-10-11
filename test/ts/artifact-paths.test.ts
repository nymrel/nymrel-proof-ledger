import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createReceipt, verifyReceipt, type ProofReceipt } from '../../src/core/receipt.js';

const cases = JSON.parse(readFileSync('test/fixtures/artifact-path-cases.json', 'utf8')) as {
  acceptedPaths: string[];
  rejectedPaths: string[];
};
const legacy = JSON.parse(readFileSync('test/fixtures/protocol-v2-vectors.json', 'utf8')).legacyV1 as {
  receipt: ProofReceipt;
  secret: string;
};
const auth = { publicKeyOrSecret: 'path-fixture-secret', expectedAlgorithm: 'HMAC-SHA256' as const };

for (const artifactPath of cases.acceptedPaths) {
  test(`disk verification accepts in-root filename ${artifactPath}`, async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-path-'));
    try {
      const fullPath = path.join(cwd, artifactPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, 'path fixture');
      const receipt = await createReceipt({
        task: { name: 'Path fixture' }, signingKey: auth.publicKeyOrSecret,
        signerIdentity: 'fixture', cwd, artifacts: [{ path: artifactPath }],
      });
      assert.equal(receipt.artifacts[0].path, artifactPath);
      const result = await verifyReceipt(receipt, { ...auth, checkFilesOnDisk: true, cwd });
      assert.equal(result.valid, true, result.errors.join('; '));
      assert.equal(result.trusted, true);
      assert.equal(result.artifactsValid, true);
      assert.equal(result.checkedArtifacts, 1);
    } finally { await fs.rm(cwd, { recursive: true, force: true }); }
  });
}

for (const artifactPath of cases.rejectedPaths) {
  test(`disk verification refuses boundary path ${JSON.stringify(artifactPath)} without reading`, async () => {
    // Legacy paths are unsigned: preserve the frozen signature so rejection
    // must come from the filesystem boundary rather than signature validation.
    const receipt = structuredClone(legacy.receipt);
    receipt.artifacts[0].path = artifactPath;
    const originalRead = fs.readFile;
    let reads = 0;
    fs.readFile = (async () => { reads++; throw new Error('Unexpected artifact read'); }) as typeof originalRead;
    try {
      const result = await verifyReceipt(receipt, {
        publicKeyOrSecret: legacy.secret, expectedAlgorithm: 'HMAC-SHA256', checkFilesOnDisk: true,
      });
      assert.equal(result.merkleValid, true);
      assert.equal(result.signatureValid, true);
      assert.equal(result.valid, false);
      assert.equal(result.trusted, false);
      assert.equal(result.artifactsValid, false);
      assert.equal(result.checkedArtifacts, 0);
      assert.match(result.errors.join('; '), /escapes verification root/);
      assert.equal(reads, 0);
    } finally { fs.readFile = originalRead; }
  });
}

for (const outside of [false, true]) {
  test(`disk verification ${outside ? 'refuses an escaping' : 'accepts an in-root'} dot-prefixed directory symlink`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-link-'));
    const cwd = path.join(directory, 'root');
    const target = outside ? path.join(directory, 'root-sibling') : path.join(cwd, '..cache');
    try {
      await fs.mkdir(target, { recursive: true });
      await fs.mkdir(cwd, { recursive: true });
      await fs.writeFile(path.join(target, 'artifact.txt'), 'path fixture');
      await fs.symlink(target, path.join(cwd, '..alias'), process.platform === 'win32' ? 'junction' : 'dir');
      const receipt = await createReceipt({
        task: { name: 'Symlink fixture' }, signingKey: auth.publicKeyOrSecret,
        signerIdentity: 'fixture', cwd, artifacts: [{ path: '..alias/artifact.txt', data: 'path fixture' }],
      });
      const originalRead = fs.readFile;
      let reads = 0;
      fs.readFile = (async (...args: Parameters<typeof originalRead>) => {
        reads++;
        return originalRead(...args);
      }) as typeof originalRead;
      try {
        const result = await verifyReceipt(receipt, { ...auth, checkFilesOnDisk: true, cwd });
        assert.equal(result.merkleValid, true);
        assert.equal(result.signatureValid, true);
        assert.equal(result.valid, !outside, result.errors.join('; '));
        assert.equal(result.trusted, !outside);
        assert.equal(result.artifactsValid, !outside);
        assert.equal(result.checkedArtifacts, outside ? 0 : 1);
        assert.equal(reads, outside ? 0 : 1);
      } finally { fs.readFile = originalRead; }
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
}

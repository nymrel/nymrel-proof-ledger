import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { runCli } from '../../src/cli.js';
import { createReceipt, verifyReceipt } from '../../src/core/receipt.js';
import { ProofSigner } from '../../src/core/signer.js';

const entrypoint = path.resolve('bin/proof-ledger.js');
const readError = 'Receipt file could not be read. Check the receipt path and read permissions, then retry.';
const jsonError = 'Receipt file is not valid UTF-8 JSON. Supply a complete UTF-8 JSON receipt, then retry.';

function failedLoadingResult(message: string) {
  return {
    valid: false, trusted: false, merkleValid: false, signatureChecked: false,
    signatureValid: null, artifactsValid: false, checkedArtifacts: 0, receipt: null,
    errors: [message], warnings: [],
  };
}

function command(directory: string, proof: string, structured = true) {
  return spawnSync(process.execPath, [
    entrypoint, 'verify', proof, '--algo', 'HMAC-SHA256', '--key-file', 'hmac.key', '--check-files',
    ...(structured ? ['--json'] : []),
  ], { cwd: directory, encoding: 'utf8' });
}

async function withInputs(action: (
  directory: string, failures: Array<[string, string]>, originals: Map<string, Buffer>
) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-ledger-input-'));
  try {
    const receipt = await createReceipt({
      task: { name: 'Customer release' },
      signingKey: 'local-consumer-test-key',
      signerIdentity: 'test-consumer',
      artifacts: [{ path: 'artifact.txt', data: 'release output' }],
      metadata: { note: 'fixture metadata' },
    });
    const encoded = JSON.stringify(receipt);
    await fs.writeFile(path.join(directory, 'proof.json'), encoded);
    await fs.writeFile(path.join(directory, 'artifact.txt'), 'release output');
    await fs.writeFile(path.join(directory, 'hmac.key'), JSON.stringify({
      algorithm: 'HMAC-SHA256', secretKey: 'local-consumer-test-key',
    }));
    await fs.mkdir(path.join(directory, 'receipt-directory'));
    const invalidTask = Buffer.concat([
      Buffer.from(encoded.slice(0, encoded.indexOf('Customer release'))), Buffer.from([0xff]),
      Buffer.from(encoded.slice(encoded.indexOf('Customer release'))),
    ]);
    const invalidMetadata = Buffer.concat([
      Buffer.from(encoded.slice(0, encoded.indexOf('fixture metadata'))), Buffer.from([0xff]),
      Buffer.from(encoded.slice(encoded.indexOf('fixture metadata'))),
    ]);
    const contents: Array<[string, string | Buffer]> = [
      ['malformed.json', '{ broken json RAW_CONTENT_DO_NOT_LOG'],
      ['truncated.json', '{"task":'],
      ['invalid-utf8.json', Buffer.from([0xff])],
      ['invalid-task-utf8.json', invalidTask],
      ['invalid-metadata-utf8.json', invalidMetadata],
      ['bom.json', '\ufeff' + encoded],
    ];
    const failures: Array<[string, string]> = [
      ['missing.json', readError], ['receipt-directory', readError],
      ...contents.map(([name]): [string, string] => [name, jsonError]),
    ];
    for (const [name, content] of contents) await fs.writeFile(path.join(directory, name), content);
    const originals = new Map<string, Buffer>();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isFile()) originals.set(entry.name, await fs.readFile(path.join(directory, entry.name)));
    }
    await action(directory, failures, originals);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function assertInputsUnchanged(directory: string, originals: Map<string, Buffer>) {
  for (const [name, content] of originals) {
    assert.deepEqual(await fs.readFile(path.join(directory, name)), content, name);
  }
  await assert.rejects(fs.stat(path.join(directory, 'missing.json')), { code: 'ENOENT' });
  assert((await fs.stat(path.join(directory, 'receipt-directory'))).isDirectory());
}

describe('CLI receipt input recovery', () => {
  it('returns complete fail-closed JSON results and actionable human reports for input failures', async () => {
    await withInputs(async (directory, failures, originals) => {
      for (const [name, message] of failures) {
        const structured = command(directory, name);
        assert.equal(structured.status, 1, name);
        assert.equal(structured.stderr, '', name);
        assert.deepEqual(JSON.parse(structured.stdout), failedLoadingResult(message), name);
        const human = command(directory, name, false);
        assert.equal(human.status, 1, name);
        assert.equal(human.stderr, '', name);
        assert(human.stdout.includes(message), name);
        assert.match(human.stdout, /PROOF VERIFICATION REPORT/);
        assert.match(human.stdout, /FAILED \(UNVERIFIED\)/);
        assert.doesNotMatch(human.stdout, /RAW_CONTENT_DO_NOT_LOG|Traceback/);
      }
      await assertInputsUnchanged(directory, originals);
    });
  });

  it('skips key reads, signatures and artifact reads after receipt loading fails', async context => {
    await withInputs(async (directory, failures, originals) => {
      const output: string[] = [];
      context.mock.method(console, 'log', (message: unknown) => { output.push(String(message)); });
      const read = context.mock.method(fs, 'readFile');
      const signature = context.mock.method(ProofSigner, 'verifySignature');
      try {
        for (const [name, message] of failures) {
          output.length = 0;
          const before = read.mock.callCount();
          const proof = path.join(directory, name);
          assert.equal(await runCli([
            'verify', proof, '--key-file', path.join(directory, 'hmac.key'),
            '--algo', 'HMAC-SHA256', '--check-files', '--json',
          ]), 1);
          assert.deepEqual(JSON.parse(output.join('\n')), failedLoadingResult(message));
          assert.equal(read.mock.callCount() - before, 1, name);
          assert.equal(read.mock.calls[before].arguments[0], proof, name);
        }
        assert.equal(signature.mock.callCount(), 0);
      } finally { context.mock.restoreAll(); }
      await assertInputsUnchanged(directory, originals);
    });
  });

  it('reports permission failures portably even when the suite runs as root', async context => {
    const output: string[] = [];
    const errors: string[] = [];
    context.mock.method(console, 'log', (message: unknown) => { output.push(String(message)); });
    context.mock.method(console, 'error', (message: unknown) => { errors.push(String(message)); });
    const read = context.mock.method(fs, 'readFile', async () => {
      throw Object.assign(new Error('Permission denied RAW_CONTENT_DO_NOT_LOG'), { code: 'EACCES' });
    });
    const signature = context.mock.method(ProofSigner, 'verifySignature');
    try {
      for (const structured of [true, false]) {
        output.length = 0;
        assert.equal(await runCli([
          'verify', 'denied.json', '--key-file', 'hmac.key', '--algo', 'HMAC-SHA256',
          '--check-files', ...(structured ? ['--json'] : []),
        ]), 1);
        if (structured) assert.deepEqual(JSON.parse(output.join('\n')), failedLoadingResult(readError));
        else {
          assert(output.join('\n').includes(readError));
          assert.match(output.join('\n'), /FAILED \(UNVERIFIED\)/);
        }
      }
      assert.equal(read.mock.callCount(), 2);
      assert.equal(signature.mock.callCount(), 0);
      assert.deepEqual(errors, []);
      assert.doesNotMatch(output.join('\n'), /RAW_CONTENT_DO_NOT_LOG/);
    } finally { context.mock.restoreAll(); }
  });

  it('keeps the authenticated-v2 policy fail-closed before key or artifact access on input failure', async context => {
    const output: string[] = [];
    context.mock.method(console, 'log', (message: unknown) => { output.push(String(message)); });
    const read = context.mock.method(fs, 'readFile', async () => {
      throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    });
    const signature = context.mock.method(ProofSigner, 'verifySignature');
    try {
      assert.equal(await runCli([
        'verify', '--require-trusted-v2', 'denied.json', '--key-file', 'must-not-read.key',
        '--algo', 'HMAC-SHA256', '--check-files', '--json',
      ]), 1);
      const { policy, ...verification } = JSON.parse(output.join('\n'));
      assert.deepEqual(verification, failedLoadingResult(readError));
      assert.equal(policy.name, 'authenticated-v2');
      assert.equal(policy.passed, false);
      assert.equal(policy.errors.length, 3);
      assert.equal(read.mock.callCount(), 1);
      assert.equal(signature.mock.callCount(), 0);
    } finally { context.mock.restoreAll(); }
  });

  it('keeps successfully parsed invalid envelopes on the existing verifier path', async () => {
    await withInputs(async (directory, _failures, originals) => {
      for (const value of [null, [], 7, {}, { task: { name: 'Incomplete receipt' } }]) {
        const proof = path.join(directory, 'invalid-envelope.json');
        const encoded = JSON.stringify(value);
        await fs.writeFile(proof, encoded);
        const result = spawnSync(process.execPath, [entrypoint, 'verify', proof, '--json'], { encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.equal(result.stderr, '');
        assert.deepEqual(JSON.parse(result.stdout), await verifyReceipt(value));
        assert.equal(await fs.readFile(proof, 'utf8'), encoded);
      }
      await assertInputsUnchanged(directory, originals);
    });
  });

  it('supports a trusted retry after every loading failure without modifying the receipt or keys', async () => {
    await withInputs(async (directory, failures, originals) => {
      for (const [name, message] of failures) {
        const failed = command(directory, name);
        assert.equal(failed.status, 1);
        assert.deepEqual(JSON.parse(failed.stdout), failedLoadingResult(message));
        const retry = command(directory, 'proof.json');
        assert.equal(retry.status, 0, retry.stderr);
        assert.equal(retry.stderr, '');
        const verification = JSON.parse(retry.stdout);
        assert.equal(verification.trusted, true);
        assert.equal(verification.signatureValid, true);
        assert.equal(verification.artifactsValid, true);
        assert.equal(verification.checkedArtifacts, 1);
        await assertInputsUnchanged(directory, originals);
      }
    });
  });
});

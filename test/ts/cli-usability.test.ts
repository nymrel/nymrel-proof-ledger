import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createReceipt, verifyReceipt } from '../../src/core/receipt.js';

const entrypoint = path.resolve('bin/proof-ledger.js');

function command(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [entrypoint, ...args], { cwd, encoding: 'utf8' });
}

async function withConsumer(action: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-ledger-cli-'));
  try {
    const receipt = await createReceipt({
      task: { name: 'Customer release' },
      signingKey: 'local-consumer-test-key',
      signerIdentity: 'test-consumer',
      artifacts: [{ path: 'artifact.txt', data: 'release output' }],
    });
    await fs.writeFile(path.join(directory, 'artifact.txt'), 'release output');
    await fs.writeFile(path.join(directory, 'proof.json'), JSON.stringify(receipt));
    await fs.writeFile(path.join(directory, 'hmac.key'), JSON.stringify({ algorithm: 'HMAC-SHA256', secretKey: 'local-consumer-test-key' }));
    await fs.writeFile(path.join(directory, 'tampered.json'), JSON.stringify({ ...receipt, task: { ...receipt.task, name: 'Requested tampered receipt' } }));
    await fs.writeFile(path.join(directory, 'invalid.json'), '{"task":{"name":"Incomplete receipt"}}');
    await action(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

describe('CLI first-use and recovery', () => {
  it('reports the version without requiring a command', () => {
    const result = command(process.cwd(), ['--version']);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '2.0.0');
    assert.equal(result.stderr, '');
  });

  it('verifies the requested receipt when boolean flags precede its filename', async () => {
    await withConsumer(async directory => {
      const result = command(directory, ['verify', '--json', 'tampered.json']);
      assert.equal(result.status, 1);
      const verification = JSON.parse(result.stdout);
      assert.equal(verification.valid, false);
      assert.equal(verification.receipt.task.name, 'Requested tampered receipt');
      const checkFiles = command(directory, ['verify', '--check-files', 'tampered.json', '--json']);
      assert.equal(checkFiles.status, 1);
      assert.equal(JSON.parse(checkFiles.stdout).receipt.task.name, 'Requested tampered receipt');
      const after = command(directory, ['verify', 'tampered.json', '--json']);
      assert.equal(after.status, 1);
      assert.equal(JSON.parse(after.stdout).receipt.task.name, 'Requested tampered receipt');
      for (const args of [
        ['verify', 'proof.json', '--json', 'tampered.json'],
        ['verify', 'proof.json', '--proof', 'tampered.json', '--json'],
      ]) {
        const ambiguous = command(directory, args);
        assert.equal(ambiguous.status, 1);
        assert.equal(ambiguous.stdout, '');
      }
    });
  });

  it('supports equals options and a leading-dash filename with an option terminator', async () => {
    await withConsumer(async directory => {
      await fs.copyFile(path.join(directory, 'proof.json'), path.join(directory, '-receipt.json'));
      const result = command(directory, [
        'verify', '--json', '--algo=HMAC-SHA256', '--key-file=hmac.key', '--check-files', '--', '-receipt.json',
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).trusted, true);
    });
  });

  it('rejects missing option values and boolean values before writing any output', async () => {
    await withConsumer(async directory => {
      for (const args of [['badge', '--format'], ['verify', '--json=false', 'proof.json']]) {
        const result = command(directory, args);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /requires a value|does not accept a value/);
        assert.equal(result.stdout, '');
      }
      await assert.rejects(fs.stat(path.join(directory, 'badge.svg')), { code: 'ENOENT' });
    });
  });

  it('rejects unknown flags and recovers with the correct flag without selecting a default receipt', async () => {
    await withConsumer(async directory => {
      for (const args of [
        ['verify', '--jsoon', 'tampered.json'],
        ['verify', 'tampered.json', '--jsoon'],
        ['--jsoon'],
      ]) {
        const result = command(directory, args);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Unsupported .* option: --jsoon/);
        assert.equal(result.stdout, '');
      }
      const retry = command(directory, ['verify', 'tampered.json', '--json']);
      assert.equal(retry.status, 1);
      assert.equal(JSON.parse(retry.stdout).receipt.task.name, 'Requested tampered receipt');
    });
  });

  it('rejects format typos without replacing the customer output', async () => {
    await withConsumer(async directory => {
      const output = path.join(directory, 'output.txt');
      await fs.writeFile(output, 'customer existing output');
      for (const name of ['badge', 'export']) {
        const result = command(directory, [name, 'proof.json', '--format', 'banana', '--out', 'output.txt']);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Unsupported .* format/);
        assert.equal(await fs.readFile(output, 'utf8'), 'customer existing output');
      }
    });
  });

  it('refuses incomplete receipts before displaying or exporting misleading proof data', async () => {
    await withConsumer(async directory => {
      for (const args of [['inspect', 'invalid.json'], ['export', 'invalid.json', '--out', 'report.md']]) {
        const result = command(directory, args);
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /Invalid proof receipt/);
      }
      await assert.rejects(fs.stat(path.join(directory, 'report.md')), { code: 'ENOENT' });
    });
  });

  it('recovers from a malformed receipt or missing algorithm without changing receipt and key files', async () => {
    await withConsumer(async directory => {
      const proofBefore = await fs.readFile(path.join(directory, 'proof.json'), 'utf8');
      const keyBefore = await fs.readFile(path.join(directory, 'hmac.key'), 'utf8');
      await fs.writeFile(path.join(directory, 'broken.json'), '{ broken json');
      const malformed = command(directory, ['verify', 'broken.json', '--json']);
      assert.equal(malformed.status, 1);
      assert.match(malformed.stderr, /Proof Ledger command failed/);
      const missingAlgorithm = command(directory, ['verify', 'proof.json', '--key-file', 'hmac.key', '--json']);
      assert.equal(missingAlgorithm.status, 1);
      assert.equal(JSON.parse(missingAlgorithm.stdout).trusted, false);
      const retry = command(directory, ['verify', 'proof.json', '--algo', 'HMAC-SHA256', '--key-file', 'hmac.key', '--check-files', '--json']);
      assert.equal(retry.status, 0, retry.stderr);
      assert.equal(JSON.parse(retry.stdout).trusted, true);
      assert.equal(await fs.readFile(path.join(directory, 'proof.json'), 'utf8'), proofBefore);
      assert.equal(await fs.readFile(path.join(directory, 'hmac.key'), 'utf8'), keyBefore);
    });
  });

  it('bounds escaped terminal errors while preserving detailed verification JSON and a safe retry', async () => {
    await withConsumer(async directory => {
      const receipt = JSON.parse(await fs.readFile(path.join(directory, 'proof.json'), 'utf8'));
      receipt.protocol = '\u001b[2J\u0007\u202e' + 'x'.repeat(20_000) + '\n';
      const input = JSON.stringify(receipt);
      await fs.writeFile(path.join(directory, 'oversized.json'), input);
      await fs.writeFile(path.join(directory, 'report.md'), 'customer existing output');
      for (const args of [
        ['inspect', 'oversized.json'],
        ['export', 'oversized.json', '--out', 'report.md'],
        ['badge', 'oversized.json', '--out', 'report.md'],
      ]) {
        const result = command(directory, args);
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.ok(result.stderr.length <= 850, `Diagnostic length: ${result.stderr.length}`);
        assert.match(result.stderr, /Invalid proof receipt: protocol: Unsupported protocol identifier/);
        assert.match(result.stderr, /details shortened; check the receipt or options and retry/);
        assert.doesNotMatch(result.stderr.trimEnd(), /[\u0000-\u001f\u007f-\u009f\u202e]|Traceback/);
      }
      const structured = command(directory, ['verify', 'oversized.json', '--json']);
      assert.equal(structured.status, 1);
      assert.equal(structured.stderr, '');
      const verification = JSON.parse(structured.stdout);
      assert.equal(verification.valid, false);
      assert.deepEqual(verification.errors, (await verifyReceipt(receipt)).errors);
      assert.ok(verification.errors[0].length > 20_000);
      assert.doesNotMatch(structured.stdout, /details shortened/);
      assert.equal(await fs.readFile(path.join(directory, 'oversized.json'), 'utf8'), input);
      assert.equal(await fs.readFile(path.join(directory, 'report.md'), 'utf8'), 'customer existing output');
      const retry = command(directory, ['inspect', 'proof.json']);
      assert.equal(retry.status, 0, retry.stderr);
      assert.match(retry.stdout, /Customer release/);
    });
  });

  it('keeps short native error details intact for recovery', async () => {
    await withConsumer(async directory => {
      const result = command(directory, ['inspect', 'missing-receipt.json']);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /ENOENT: no such file or directory, open .*missing-receipt\.json/);
      assert.doesNotMatch(result.stderr.trimEnd(), /details shortened|Traceback|[\u0000-\u001f\u007f-\u009f]/);
      assert.ok(result.stderr.length < 300);
    });
  });
});

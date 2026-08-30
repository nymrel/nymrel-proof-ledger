import { describe, it } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { runCli } from '../../src/cli.js';

describe('CLI Driver End-to-End', () => {
  it('executes keygen, attest, verify, badge, inspect, and export commands', async () => {
    const tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.tmp-nymrel-proof-test-'));
    const proofFile = path.join(tmpDir, 'proof.json');
    const badgeFile = path.join(tmpDir, 'badge.svg');
    const htmlFile = path.join(tmpDir, 'cert.html');
    const reportFile = path.join(tmpDir, 'report.md');
    const dummyArtifact = path.join(tmpDir, 'artifact.txt');
    const keyFile = path.join(tmpDir, 'secret.key');
    const keyedProofFile = path.join(tmpDir, 'proof-keyed.json');

    await fs.writeFile(dummyArtifact, 'cryptographic test payload data', 'utf8');

    try {
      // 1. keygen
      const keygenCode = await runCli(['keygen', '--algo', 'HMAC-SHA256']);
      assert.strictEqual(keygenCode, 0);

      // 2. attest
      const attestCode = await runCli([
        'attest',
        '--task', 'CLI Integration Test',
        '--files', dummyArtifact,
        '--key', 'super-secret-key-12345',
        '--out', proofFile,
        '--badge', badgeFile,
        '--html', htmlFile,
      ]);
      assert.strictEqual(attestCode, 0);

      const proofExists = await fs.stat(proofFile);
      assert.ok(proofExists.size > 0);

      const badgeExists = await fs.stat(badgeFile);
      assert.ok(badgeExists.size > 0);

      // 3. verify (with key and file check)
      const verifyCode = await runCli([
        'verify',
        proofFile,
        '--key', 'super-secret-key-12345',
        '--check-files',
      ]);
      assert.strictEqual(verifyCode, 0);

      // Verification without key remains a successful integrity check, but it
      // must never be presented as cryptographically trusted.
      const captured: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => captured.push(args.map(String).join(' '));
      try {
        const integrityOnlyCode = await runCli(['verify', proofFile]);
        assert.strictEqual(integrityOnlyCode, 0);
      } finally {
        console.log = originalLog;
      }
      assert.match(captured.join('\n'), /NOT CHECKED/);
      assert.match(captured.join('\n'), /PASSED \(INTEGRITY ONLY\)/);

      // 4. inspect
      const inspectCode = await runCli(['inspect', proofFile]);
      assert.strictEqual(inspectCode, 0);

      // 5. export markdown
      const exportCode = await runCli([
        'export',
        proofFile,
        '--format', 'markdown',
        '--out', reportFile,
      ]);
      assert.strictEqual(exportCode, 0);

      const reportExists = await fs.stat(reportFile);
      assert.ok(reportExists.size > 0);

      // 6. keygen --out -> attest --key-file -> verify --key-file round-trip.
      // Regression guard: `--key-file` must be honored (not silently dropped)
      // and must unwrap the JSON envelope written by `keygen`.
      const keygenFileCode = await runCli(['keygen', '--algo', 'HMAC-SHA256', '--out', keyFile]);
      assert.strictEqual(keygenFileCode, 0);

      const keyedAttestCode = await runCli([
        'attest',
        '--task', 'Key File Round-Trip',
        '--files', dummyArtifact,
        '--key-file', keyFile,
        '--out', keyedProofFile,
      ]);
      assert.strictEqual(keyedAttestCode, 0);

      const keyedVerifyCode = await runCli([
        'verify',
        keyedProofFile,
        '--key-file', keyFile,
      ]);
      assert.strictEqual(keyedVerifyCode, 0);

      // The receipt must NOT have been signed with an ephemeral key: verifying
      // with a deliberately wrong secret has to fail signature validation.
      const wrongKeyVerifyCode = await runCli([
        'verify',
        keyedProofFile,
        '--key', 'definitely-not-the-signing-key',
      ]);
      assert.strictEqual(wrongKeyVerifyCode, 1);
    } finally {
      // Cleanup temporary files
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

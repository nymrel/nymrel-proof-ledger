import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createReceipt } from '../../src/core/receipt.js';

const root = process.cwd();
const vectors = JSON.parse(await readFile(join(root, 'test/fixtures/protocol-v2-vectors.json'), 'utf8'));
const cases = JSON.parse(await readFile(join(root, 'test/fixtures/cli-gate-cases.json'), 'utf8'));
const payload = 'gate payload\n';

for (const row of cases) {
  test(`CLI policy: ${row.name}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'proof-cli-gate-'));
    try {
      const algorithm = row.legacy ? 'HMAC-SHA256' : row.algorithm ?? 'Ed25519';
      const key = row.legacy ? vectors.legacyV1.secret
        : algorithm === 'Ed25519' ? vectors.ed25519.publicKey : vectors.protocolV2.secret;
      const receipt = row.legacy ? structuredClone(vectors.legacyV1.receipt)
        : await createReceipt({
          task: { name: 'gate reference' }, signerIdentity: 'fixture', algorithm,
          signingKey: algorithm === 'Ed25519' ? vectors.ed25519.secretKey : key,
          artifacts: [{ path: 'artifact.txt', data: payload }], metadata: { purpose: 'test' },
        });
      if (row.tamper === 'metadata') receipt.metadata.purpose = 'changed';
      if (row.tamper === 'artifact') receipt.artifacts[0].sha256 = '00'.repeat(32);
      await writeFile(join(directory, 'proof.json'), JSON.stringify(row.malformed ? null : receipt));
      if (row.inputFailure === 'missing') await rm(join(directory, 'proof.json'));
      if (row.inputFailure === 'json') await writeFile(join(directory, 'proof.json'), '{ incomplete');
      if (row.inputFailure === 'utf8') await writeFile(join(directory, 'proof.json'), Buffer.from([0xff]));
      if (row.inputFailure === 'bom') await writeFile(join(directory, 'proof.json'), '\ufeff' + JSON.stringify(receipt));
      if (row.disk === 'match' || row.disk === 'changed') {
        await writeFile(join(directory, 'artifact.txt'), row.disk === 'match' ? payload : 'changed');
      }
      const flags: string[] = [];
      if (row.key !== 'none') {
        const verificationKey = row.key === 'wrong' ? '00'.repeat(32) : key;
        if (row.keyFile) {
          await writeFile(join(directory, 'public.json'), JSON.stringify({ algorithm, publicKey: verificationKey }));
          flags.push('--key-file', 'public.json');
        } else flags.push('--key', verificationKey);
        if (!row.omitAlgorithm) flags.push('--algo', row.expectedAlgorithm ?? algorithm);
      }
      if (row.disk) flags.push('--check-files');
      // Put the boolean flag before the path to exercise argument arity.
      const args = ['verify', ...(row.gate ? ['--require-trusted-v2'] : []), 'proof.json', ...flags];
      const run = spawnSync(process.execPath, [resolve(root, 'bin/proof-ledger.js'), ...args, '--json'],
        { cwd: directory, encoding: 'utf8', timeout: 30_000 });
      assert.equal(run.status, row.exit, run.stderr);
      const result = JSON.parse(run.stdout);
      assert.equal(result.valid, row.valid);
      assert.equal(result.trusted, row.trusted);
      if (row.inputFailure) {
        assert.equal(result.receipt, null);
        assert.equal(result.signatureChecked, false);
        assert.equal(result.signatureValid, null);
        assert.equal(result.checkedArtifacts, 0);
        assert.match(result.errors[0], /then retry\./);
      }
      if (row.gate) {
        assert.equal(result.policy.name, 'authenticated-v2');
        assert.equal(result.policy.passed, row.exit === 0);
        assert.equal(result.policy.errors.length === 0, row.exit === 0);
        const human = spawnSync(process.execPath, [resolve(root, 'bin/proof-ledger.js'), ...args],
          { cwd: directory, encoding: 'utf8', timeout: 30_000 });
        assert.equal(human.status, row.exit, human.stderr);
        if (row.valid && row.exit === 1) {
          assert.match(human.stdout, /FAILED \(POLICY\)/);
          assert.doesNotMatch(human.stdout, /PASSED \(TRUSTED\)|PASSED \(INTEGRITY ONLY\)/);
        }
      } else assert.equal('policy' in result, false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

test('CLI policy rejects explicit values and extra positional arguments', () => {
  for (const args of [
    ['verify', '--require-trusted-v2=false', 'absent.json'],
    ['verify', '--require-trusted-v2', 'absent.json', 'false'],
    ['verify', 'test/fixtures/auth-context-cli-receipt.json', '--require-trusted-v2', '-require-trusted-v2', '', '--json'],
    ['verify', 'test/fixtures/auth-context-cli-receipt.json', '--require-trusted-v3', '--json'],
  ]) {
    const result = spawnSync(process.execPath, [resolve(root, 'bin/proof-ledger.js'), ...args],
      { encoding: 'utf8', timeout: 30_000 });
    assert.notEqual(result.status, 0);
  }
});

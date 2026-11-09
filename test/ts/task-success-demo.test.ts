import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const example = resolve('examples/task-success-demo.mjs');

test('task demo retains authenticated success and failure without a private key file', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ledger-task-demo-'));
  const output = join(parent, 'new output €');
  try {
    const run = spawnSync(process.execPath, [example, output], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.status, 'PASS');
    assert.deepEqual(result.checks.map((row: { signedStatus: string; taskPolicyPassed: boolean; verifierExitCode: number }) =>
      [row.signedStatus, row.taskPolicyPassed, row.verifierExitCode]), [['SUCCESS', true, 0], ['FAILURE', false, 1]]);
    assert.match(result.meaning, /FAILURE task claim remains failed/);
    assert.deepEqual((await readdir(output)).sort(), ['failure', 'public.json', 'success']);
    assert.deepEqual(Object.keys(JSON.parse(await readFile(join(output, 'public.json'), 'utf8'))).sort(), ['algorithm', 'publicKey']);
    for (const name of ['success', 'failure']) {
      assert.deepEqual((await readdir(join(output, name))).sort(), ['artifact.txt', 'proof.json']);
      const receipt = JSON.parse(await readFile(join(output, name, 'proof.json'), 'utf8'));
      assert.equal(receipt.task.status, name === 'success' ? 'SUCCESS' : 'FAILURE');
    }
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('task demo refuses an occupied output without changing user files', async () => {
  const output = await mkdtemp(join(tmpdir(), 'ledger-task-demo-existing-'));
  try {
    await writeFile(join(output, 'keep.txt'), 'untouched fixture\n');
    const run = spawnSync(process.execPath, [example, output], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /already exists.*Choose a new directory/);
    assert.equal(await readFile(join(output, 'keep.txt'), 'utf8'), 'untouched fixture\n');
    assert.deepEqual(await readdir(output), ['keep.txt']);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('task demo validates command arity before creating output', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ledger-task-demo-arity-'));
  try {
    for (const args of [[], [join(parent, 'new'), 'unexpected'], [''], ['--unknown'], ['--force']]) {
      const run = spawnSync(process.execPath, [example, ...args], { cwd: parent, encoding: 'utf8', timeout: 30_000 });
      assert.equal(run.status, 1);
      assert.match(run.stderr, /Usage:/);
    }
    assert.deepEqual(await readdir(parent), []);
    const help = spawnSync(process.execPath, [example, '--help'], { cwd: parent, encoding: 'utf8', timeout: 30_000 });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /NEW_DIRECTORY/);
    assert.deepEqual(await readdir(parent), []);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, truncate, writeFile, copyFile, stat, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureConfig, observation } from '../agent-work/fixtures.js';
import { Simulation } from '../agent-work/engine.js';
import type { Config } from '../agent-work/contracts.js';
import type { DurableOutcome } from './contracts.js';
import { DurableLedger } from './ledger.js';
import { SQLiteAuditStore } from './store.js';

const workerPath = fileURLToPath(new URL('./test-worker.js', import.meta.url));
const directories: string[] = [];
test.after(async () => { await Promise.all(directories.map(directory => rm(directory, { recursive: true, force: true }))); });
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'nymrel-durable-test-')); directories.push(value); return value;
}
async function create(config = fixtureConfig()) {
  const path = await directory(); const store = await SQLiteAuditStore.create(path, config);
  return { path, config, ledger: new DurableLedger(store, config), store };
}
async function open(path: string, config = fixtureConfig()): Promise<DurableLedger> {
  return new DurableLedger(await SQLiteAuditStore.open(path, config), config);
}
async function ok(result: Promise<DurableOutcome>): Promise<DurableOutcome> {
  const response = await result; assert.equal(response.outcome.ok, true, response.outcome.code); return response;
}
async function scoped(ledger: DurableLedger, workId = 'packet'): Promise<void> {
  await ok(ledger.worker.submit({ type: 'discover_work', requestId: `d_${workId}`, workId }));
  await ok(ledger.worker.submit({ type: 'scope_assignment', requestId: `s_${workId}`, workId }));
}
async function assigned(ledger: DurableLedger, workId = 'packet'): Promise<void> {
  await scoped(ledger, workId);
  await ok(ledger.worker.submit({ type: 'accept_assignment', requestId: `a_${workId}`, workId }));
}
async function delivered(ledger: DurableLedger): Promise<void> {
  await assigned(ledger);
  await ok(ledger.worker.submit({ type: 'begin_work', requestId: 'execute', workId: 'packet' }));
  const w = (await ledger.view()).state.works.packet;
  await ok(ledger.worker.submit({ type: 'deliver_artifact', requestId: 'deliver', workId: 'packet', content: w.execution!.output.content }));
}
async function acceptance(ledger: DurableLedger) {
  const w = (await ledger.view()).state.works.packet;
  return { type: 'accept_delivery', requestId: 'accept', workId: 'packet', artifactSha256: w.artifact!.sha256, scopeDigest: w.scopeDigest!, criteriaRevision: w.listing.criteriaRevision };
}
function child(mode: string, path: string, command: unknown, config?: Config): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [workerPath, mode, path, JSON.stringify(command), String(config?.openingCredits ?? 1000)], { stdio: ['ignore','pipe','pipe'] });
    let stdout = '', stderr = '';
    process.stdout.on('data', chunk => { stdout += String(chunk); });
    process.stderr.on('data', chunk => { stderr += String(chunk); });
    process.on('error', reject); process.on('exit', code => resolve({ code, stdout, stderr }));
  });
}

test('local storage survives restart with frozen R3 state, identity and audit replay', async () => {
  const { path, ledger } = await create(); await delivered(ledger);
  const before = await ledger.view(); const audit = await ledger.exportAudit(); await ledger.close();
  const reopened = await open(path);
  assert.deepEqual(await reopened.view(), before);
  assert.deepEqual(await reopened.exportAudit(), audit);
  assert.equal((await Simulation.replay(audit, before.checkpoint.auditHead)).valid, true);
  assert.equal(before.mode, 'OFFLINE_SIMULATION'); assert.equal(before.identity.observedModel, null);
  assert.equal(before.state.works.packet.execution!.realCost, null);
  assert.equal(before.state.works.packet.acceptance, null);
  await reopened.close();
});

test('duplicate and conflicting command IDs preserve durable outcomes after restart', async () => {
  const { path, ledger } = await create();
  const command = { type: 'discover_work', requestId: 'once', workId: 'packet' };
  const first = await ok(ledger.worker.submit(command)); await ledger.close();
  const reopened = await open(path);
  const retry = await ok(reopened.worker.submit(command));
  assert.deepEqual(retry.outcome, { ...first.outcome, replayed: true });
  assert.deepEqual(retry.checkpoint, first.checkpoint);
  const conflict = await reopened.worker.submit({ ...command, workId: 'another' });
  assert.equal(conflict.outcome.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await reopened.exportAudit()).records.length, 2);
  await reopened.close();
});

test('concurrent handles reserve against the same freshly loaded balance', async () => {
  const config = fixtureConfig(); config.openingCredits = 450;
  const { path, ledger } = await create(config); await scoped(ledger); await scoped(ledger, 'another');
  const second = await open(path, config);
  const results = await Promise.all([
    ledger.worker.submit({ type: 'accept_assignment', requestId: 'first', workId: 'packet' }),
    second.worker.submit({ type: 'accept_assignment', requestId: 'second', workId: 'another' }),
  ]);
  assert.equal(results.filter(r => r.outcome.ok).length, 1);
  assert.equal(results.find(r => !r.outcome.ok)!.outcome.code, 'INSUFFICIENT_AVAILABLE');
  const view = await second.view(); assert.equal(view.treasury.commitments, 150); assert.equal(view.treasury.available, 100);
  await ledger.close(); await second.close();
});

test('separate processes cannot reserve the same available units', async () => {
  const config = fixtureConfig(); config.openingCredits = 450;
  const { path, ledger } = await create(config); await scoped(ledger); await scoped(ledger, 'another'); await ledger.close();
  const results = await Promise.all(['packet','another'].map(workId => child('command', path, { type: 'accept_assignment', requestId: `a_${workId}`, workId }, config)));
  assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
  const responses = results.map(r => JSON.parse(r.stdout) as DurableOutcome);
  assert.equal(responses.filter(r => r.outcome.ok).length, 1);
  assert.equal(responses.find(r => !r.outcome.ok)!.outcome.code, 'INSUFFICIENT_AVAILABLE');
  const recovered = await open(path, config); assert.equal((await recovered.view()).treasury.commitments, 150); await recovered.close();
});

test('concurrent outgoing attempts cannot reuse held capacity across handles', async () => {
  const { path, ledger } = await create(); await assigned(ledger); const second = await open(path);
  const results = await Promise.all([ledger, second].map((l, index) => l.worker.submit({ type: 'begin_spend', requestId: `spend${index}`, attemptId: `attempt${index}`, workId: 'packet', amount: 100 })));
  assert.equal(results.filter(r => r.outcome.ok).length, 1);
  assert.equal(results.find(r => !r.outcome.ok)!.outcome.code, 'RESERVATION_EXCEEDED');
  await ledger.close(); await second.close();
});

test('process death during a partial uncommitted database write recovers the prior whole ledger', async () => {
  const { path, ledger } = await create(); await assigned(ledger); const before = await ledger.view(); await ledger.close();
  await new Promise<void>((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [workerPath, 'uncommitted-write', path], { stdio: ['ignore','pipe','pipe'] });
    let ready = false, stderr = '';
    const timer = setTimeout(() => { process.kill('SIGKILL'); reject(Error('Crash fixture timeout')); }, 5000);
    process.stderr.on('data', chunk => { stderr += String(chunk); });
    process.stdout.on('data', chunk => { if (String(chunk).includes('UNCOMMITTED')) { ready = true; process.kill('SIGKILL'); } });
    process.on('error', error => { clearTimeout(timer); reject(error); });
    process.on('exit', (_code, signal) => { clearTimeout(timer); if (!ready || signal !== 'SIGKILL') reject(Error(stderr)); else resolve(); });
  });
  const recovered = await open(path);
  assert.deepEqual(await recovered.view(), before); await recovered.close();
});

test('committed command with no acknowledgement is recovered and retry does not reserve twice', async () => {
  const { path, ledger } = await create(); await scoped(ledger); await ledger.close();
  const command = { type: 'accept_assignment', requestId: 'ambiguous', workId: 'packet' };
  const result = await child('after-commit-before-ack', path, command); assert.equal(result.code, 73, result.stderr); assert.equal(result.stdout, '');
  const recovered = await open(path); const before = await recovered.view();
  assert.equal(before.treasury.commitments, 150);
  const retry = await ok(recovered.worker.submit(command)); assert.equal(retry.outcome.replayed, true);
  assert.deepEqual(retry.checkpoint, before.checkpoint);
  assert.equal((await recovered.view()).treasury.commitments, 150); await recovered.close();
});

test('empty, truncated and corrupted storage fail closed without reseeding balances', async () => {
  const empty = await directory(); await writeFile(join(empty, 'ledger.sqlite'), '', { mode: 0o600 });
  await assert.rejects(SQLiteAuditStore.open(empty, fixtureConfig()), /STORE_FILE_INVALID/);
  await assert.rejects(SQLiteAuditStore.create(empty, fixtureConfig()), /EEXIST/);
  const { path, ledger } = await create(); await assigned(ledger); await ledger.close();
  await truncate(join(path, 'ledger.sqlite'), 120);
  const bytes = await readFile(join(path, 'ledger.sqlite'));
  await assert.rejects(SQLiteAuditStore.open(path, fixtureConfig()));
  assert.deepEqual(await readFile(join(path, 'ledger.sqlite')), bytes);
  const clean = await create(); await clean.ledger.close();
  const db = new DatabaseSync(join(clean.path, 'ledger.sqlite')); db.prepare('UPDATE ledger SET audit_json=?').run('{partial'); db.close();
  await assert.rejects(SQLiteAuditStore.open(clean.path, fixtureConfig()));
});

test('tenant, merchant and full config identity are checked on every open and composition', async () => {
  const { path, ledger } = await create(); await ledger.close();
  for (const field of ['tenantId', 'merchantId'] as const) {
    const wrong = fixtureConfig(); wrong.accountableEntity[field] = 'different';
    await assert.rejects(SQLiteAuditStore.open(path, wrong), /TENANT_OR_CONFIG_MISMATCH/);
  }
  const changed = fixtureConfig(); changed.reserve = 0;
  await assert.rejects(SQLiteAuditStore.open(path, changed), /TENANT_OR_CONFIG_MISMATCH/);
  const store = await SQLiteAuditStore.open(path, fixtureConfig());
  assert.throws(() => new DurableLedger(store, changed), /TENANT_OR_CONFIG_MISMATCH/); await store.close();
});

test('actor ports cannot be forged by submitted identity or copied port metadata', async () => {
  const { ledger } = await create(); await delivered(ledger); const accept = await acceptance(ledger);
  assert.equal((await ledger.worker.submit(accept)).outcome.code, 'ROLE_DENIED');
  assert.equal((await ledger.worker.submit({ ...accept, requestId: 'forgedActor', actorId: 'fictionalCustomer' })).outcome.code, 'COMMAND_SHAPE');
  assert.equal((await ledger.worker.submit({ type: 'discover_work', requestId: 'tenantSpoof', workId: 'another', tenantId: 'different' })).outcome.code, 'COMMAND_SHAPE');
  assert.throws(() => ledger.customer('nymrelWorker'), /UNKNOWN_CUSTOMER/);
  const forged = { ...ledger.worker, kind: 'customer', actorId: 'fictionalCustomer' };
  assert.equal((await forged.submit({ ...accept, requestId: 'copiedPort' })).outcome.code, 'ROLE_DENIED');
  assert.equal((await ledger.customer('otherCustomer').submit({ ...accept, requestId: 'otherCustomer' })).outcome.code, 'CUSTOMER_MISMATCH');
  assert.equal((await ledger.view()).state.works.packet.acceptance, null); await ledger.close();
});

test('restart does not fabricate acceptance, settlement or zero provider cost', async () => {
  const { path, ledger } = await create(); await delivered(ledger);
  const accept = await acceptance(ledger); await ledger.close(); let recovered = await open(path);
  assert.equal((await recovered.worker.submit({ type: 'issue_invoice', requestId: 'earlyInvoice', workId: 'packet' })).outcome.code, 'CUSTOMER_ACCEPTANCE_REQUIRED');
  await ok(recovered.customer('fictionalCustomer').submit(accept));
  await ok(recovered.worker.submit({ type: 'issue_invoice', requestId: 'invoice', workId: 'packet' }));
  const receipt = { type: 'observe_earning', requestId: 'pending', invoiceId: 'invoice_packet', paymentId: 'payment', observation: observation('pendingReceipt', 1, 'PENDING', 500) };
  assert.equal((await recovered.worker.submit(receipt)).outcome.code, 'ROLE_DENIED');
  await ok(recovered.fakeObservations.submit(receipt)); await recovered.close(); recovered = await open(path);
  const view = await recovered.view(); assert.equal(view.treasury.settledEarnings, 0); assert.equal(view.treasury.pendingEarnings, 500);
  assert.equal(view.treasury.available, 650); assert.equal(view.state.works.packet.execution!.realCost, null);
  assert.equal(recovered.fakeObservations.networkEnabled, false); assert.equal(recovered.fakeObservations.source, 'FAKE_ADAPTER');
  assert.equal((await recovered.worker.submit({ type: 'set_reserve', requestId: 'injection', amount: 0 })).outcome.code, 'UNKNOWN_COMMAND');
  await recovered.close();
});

test('unknown outgoing outcomes retain reservations over restarts and duplicate observations', async () => {
  const { path, ledger } = await create(); await assigned(ledger);
  await ok(ledger.worker.submit({ type: 'begin_spend', requestId: 'spend', attemptId: 'attempt', workId: 'packet', amount: 90 }));
  const unknown = { type: 'observe_spend', requestId: 'unknown', attemptId: 'attempt', observation: observation('unknownReceipt', 1, 'UNKNOWN', 90) };
  await ok(ledger.fakeObservations.submit(unknown));
  await ok(ledger.worker.submit({ type: 'cancel_work', requestId: 'cancel', workId: 'packet' })); await ledger.close();
  const recovered = await open(path); assert.equal((await recovered.view()).treasury.commitments, 90);
  await ok(recovered.fakeObservations.submit({ ...unknown, requestId: 'duplicateObservation' }));
  const view = await recovered.view(); assert.equal(view.treasury.commitments, 90); assert.equal(view.treasury.settledSpend, 0);
  await recovered.close();
});

test('retained checkpoints detect coherent file rollback while same-file hashes do not claim custody', async () => {
  const { path, ledger } = await create(); const earlier = (await ledger.view()).checkpoint; await ledger.close();
  const backup = join(await directory(), 'backup.sqlite'); await copyFile(join(path, 'ledger.sqlite'), backup);
  const active = await open(path); await assigned(active); const later = (await active.view()).checkpoint; await active.close();
  await copyFile(backup, join(path, 'ledger.sqlite'));
  await assert.rejects(SQLiteAuditStore.open(path, fixtureConfig(), later), /RETAINED_CHECKPOINT_MISMATCH/);
  const restored = await SQLiteAuditStore.open(path, fixtureConfig(), earlier); await restored.close();
});

test('transaction exceptions, queued mutation, close and stale versions preserve atomic behavior', async () => {
  const { ledger, store } = await create();
  await assert.rejects(store.transact(async () => { throw Error('injected callback failure'); }), /injected callback failure/);
  assert.equal((await ledger.view()).checkpoint.storageVersion, 0);
  const input = { type: 'discover_work', requestId: 'snapshot', workId: 'packet' };
  const result = ledger.worker.submit(input); input.workId = 'malicious'; await ok(result);
  assert.ok((await ledger.view()).state.works.packet); assert.equal((await ledger.view()).state.works.malicious, undefined);
  assert.equal((await ledger.worker.submit({ type: 'scope_assignment', requestId: 'stale', expectedRevision: 0, workId: 'packet' })).outcome.code, 'STALE_REVISION');
  await assert.rejects(ledger.worker.submit({ bad: Infinity }), /COMMAND_JSON_BOUNDARY/);
  await ledger.close(); await assert.rejects(ledger.view(), /STORE_CLOSED/);
});

test('existing files and filesystem aliases are refused without changing permissions or contents', async () => {
  const { path, ledger } = await create(); await ledger.close(); const filename = join(path, 'ledger.sqlite');
  const before = await readFile(filename); const mode = (await stat(filename)).mode;
  await assert.rejects(SQLiteAuditStore.create(path, fixtureConfig()), /EEXIST/);
  assert.deepEqual(await readFile(filename), before); assert.equal((await stat(filename)).mode, mode);
  const linked = await directory(); await symlink(filename, join(linked, 'ledger.sqlite'));
  await assert.rejects(SQLiteAuditStore.open(linked, fixtureConfig()), /STORE_FILE_INVALID/);
});

test('a live handle refuses a replaced database file rather than acknowledging writes to an unlinked inode', async () => {
  const { path, ledger } = await create();
  const replacement = join(path, 'replacement.sqlite');
  await copyFile(join(path, 'ledger.sqlite'), replacement);
  await rename(replacement, join(path, 'ledger.sqlite'));
  await assert.rejects(ledger.worker.submit({ type: 'discover_work', requestId: 'replaced', workId: 'packet' }), /STORE_FILE_REPLACED_REOPEN/);
  await ledger.close();
  const recovered = await open(path); assert.equal((await recovered.view()).checkpoint.storageVersion, 0); await recovered.close();
});

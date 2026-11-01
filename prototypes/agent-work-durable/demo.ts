import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureConfig, observation } from '../agent-work/fixtures.js';
import { SQLiteAuditStore } from './store.js';
import { DurableLedger } from './ledger.js';

const directory = await mkdtemp(join(tmpdir(), 'nymrel-durable-demo-'));
const config = fixtureConfig();
let ledger = new DurableLedger(await SQLiteAuditStore.create(directory, config), config);
async function worker(command: unknown): Promise<void> {
  const result = await ledger.worker.submit(command);
  if (!result.outcome.ok) throw Error(result.outcome.code);
}
await worker({ type: 'discover_work', requestId: 'discover', workId: 'packet' });
await worker({ type: 'scope_assignment', requestId: 'scope', workId: 'packet' });
const assignment = { type: 'accept_assignment', requestId: 'assign', workId: 'packet' };
await worker(assignment);
await worker({ type: 'begin_spend', requestId: 'spend', workId: 'packet', attemptId: 'attempt', amount: 90 });
await ledger.fakeObservations.submit({ type: 'observe_spend', requestId: 'unknown', attemptId: 'attempt', observation: observation('unknownReceipt', 1, 'UNKNOWN', 90) });
await worker({ type: 'cancel_work', requestId: 'cancel', workId: 'packet' });
const before = await ledger.view(); await ledger.close();
ledger = new DurableLedger(await SQLiteAuditStore.open(directory, config, before.checkpoint), config);
const duplicate = await ledger.worker.submit(assignment);
const after = await ledger.view();
const audit = await ledger.exportAudit(); await ledger.close();
if (!duplicate.outcome.replayed || after.treasury.commitments !== 90 || after.treasury.settledSpend !== 0 || after.checkpoint.auditHead !== before.checkpoint.auditHead) throw Error('Recovery demonstration failed');
const output = { mode: 'OFFLINE_SIMULATION', directory, notice: 'No customer acceptance or payment settlement is inferred by restart.', before, after, duplicate, audit };
if (process.argv.includes('--json')) console.log(JSON.stringify(output, null, 2));
else {
  console.log('OFFLINE SIMULATION — local SQLite, fictional credits and fake observations only.');
  console.log(`Database: ${directory}/ledger.sqlite`);
  console.log(`Restart recovered version ${after.checkpoint.storageVersion}, available ${after.treasury.available}, unresolved commitment ${after.treasury.commitments}.`);
  console.log(`Original assignment retry: ${duplicate.outcome.replayed ? 'original result recovered; no duplicate reservation' : 'unexpected new action'}.`);
  console.log(`Settled spend remains ${after.treasury.settledSpend}; unknown outcome remains held. Model actually served remains unknown.`);
  console.log(`Audit head: ${after.checkpoint.auditHead}`);
}

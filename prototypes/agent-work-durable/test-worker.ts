/** Trusted subprocess fixture for crash/concurrency tests; no public entry point. */
import { DatabaseSync } from 'node:sqlite';
import { fixtureConfig } from '../agent-work/fixtures.js';
import { DurableLedger } from './ledger.js';
import { SQLiteAuditStore } from './store.js';

const [mode, directory, commandJson, openingJson] = process.argv.slice(2);
if (!directory) throw Error('Test directory required');
if (mode === 'uncommitted-write') {
  const db = new DatabaseSync(`${directory}/ledger.sqlite`, { allowExtension: false });
  db.exec('PRAGMA cache_size=1; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
  db.prepare('UPDATE ledger SET version=999, audit_json=? WHERE singleton=1').run('{partial:' + 'x'.repeat(1024 * 1024));
  process.stdout.write('UNCOMMITTED\n');
  setInterval(() => undefined, 1000);
} else {
  const config = fixtureConfig();
  if (openingJson) config.openingCredits = Number(openingJson);
  const store = await SQLiteAuditStore.open(directory, config);
  const ledger = new DurableLedger(store, config);
  const result = await ledger.worker.submit(JSON.parse(commandJson ?? 'null') as unknown);
  if (mode === 'after-commit-before-ack') process.exit(73);
  if (mode !== 'command') throw Error('Unknown test fixture mode');
  await ledger.close();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

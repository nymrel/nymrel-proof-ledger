/** Model-facing JSONL entry point: exposes only the worker capability. */
import { createInterface } from 'node:readline';
import { Simulation } from './engine.js';
import { fixtureConfig } from './fixtures.js';

const sim = new Simulation(fixtureConfig());
console.log(JSON.stringify({ type: 'identity', identity: sim.identity(), mode: 'OFFLINE_SIMULATION', unit: 'FAKE_CREDIT' }));
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  try {
    if (Buffer.byteLength(line, 'utf8') > 32768) throw Error('size');
    const outcome = await sim.agent(JSON.parse(line) as unknown);
    console.log(JSON.stringify({ type: 'outcome', outcome, treasury: sim.balance() }));
  } catch {
    console.log(JSON.stringify({ type: 'ingress_rejection', code: 'INVALID_JSON_OR_SIZE' }));
  }
}
console.log(JSON.stringify({ type: 'audit', bundle: sim.exportAudit() }));

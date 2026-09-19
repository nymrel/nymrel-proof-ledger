import { readFileSync } from 'node:fs';
import { createSignalProofBundle, verifySignalProofBundle } from '../dist/src/profiles/signal.js';
const rows = JSON.parse(readFileSync(0, 'utf8'));
const results = [];
for (const row of rows) results.push(row.action === 'create'
  ? await createSignalProofBundle(row.options)
  : await verifySignalProofBundle(row.bundle, row.options ?? {}));
process.stdout.write(JSON.stringify(results));

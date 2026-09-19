// Test-only JSON bridge: exercises the built library in a separate Node process.
import { readFileSync } from 'node:fs';
import { createReceipt, verifyReceipt } from '../dist/src/core/receipt.js';

const request = JSON.parse(readFileSync(0, 'utf8'));
const results = [];
for (const row of request) {
  results.push(row.action === 'create'
    ? await createReceipt(row.options)
    : await verifyReceipt(row.receipt, row.options ?? {}));
}
process.stdout.write(JSON.stringify(results));

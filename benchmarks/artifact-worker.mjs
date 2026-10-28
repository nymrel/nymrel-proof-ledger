/** One fresh-process artifact operation; orchestrated by artifact-benchmark.py. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const [modulePath, operation, dataRoot, manifestPath] = process.argv.slice(2);
const { createReceipt, verifyReceipt } = await import(pathToFileURL(resolve(modulePath)).href);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const receipt = operation === 'verify' ? JSON.parse(readFileSync(manifest.receiptPath, 'utf8')) : undefined;
const secret = '11'.repeat(32); // Public synthetic benchmark fixture, never a production key.
if (global.gc) global.gc();
const idleRssBytes = process.memoryUsage().rss;
const start = performance.now();
let output;
if (operation === 'create') {
  output = await createReceipt({
    task: { name: 'Artifact benchmark' }, signingKey: secret,
    signerIdentity: 'synthetic-benchmark', cwd: dataRoot,
    artifacts: manifest.paths.map(path => ({ path })),
  });
} else if (operation === 'verify') {
  output = await verifyReceipt(receipt, {
    publicKeyOrSecret: secret, expectedAlgorithm: 'HMAC-SHA256',
    checkFilesOnDisk: true, cwd: dataRoot,
  });
  if (!output.trusted || output.checkedArtifacts !== manifest.paths.length) throw Error(JSON.stringify(output.errors));
} else {
  throw Error('Expected create or verify');
}
const elapsedSeconds = (performance.now() - start) / 1000;
const peakRssBytes = process.resourceUsage().maxRSS * 1024;
process.stdout.write(JSON.stringify({ elapsedSeconds, idleRssBytes, peakRssBytes,
  peakIncrementBytes: Math.max(0, peakRssBytes - idleRssBytes),
  ...(operation === 'create' ? { receipt: output } : {}),
}));

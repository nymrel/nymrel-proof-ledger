/** Persistent worker for warmed-artifacts.py; protocol overhead is untimed. */
import { promises as fs } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const { createReceipt, verifyReceipt } = await import(pathToFileURL(process.argv[2]).href);
const secret = '11'.repeat(32); // Public synthetic benchmark fixture.
let setup;
let receipt;
const create = () => createReceipt({
  task: { name: 'Warmed artifact benchmark' }, signingKey: secret,
  signerIdentity: 'synthetic-benchmark', cwd: setup.cwd,
  artifacts: setup.paths.map(path => ({ path })),
});
const verify = () => verifyReceipt(receipt, {
  publicKeyOrSecret: secret, expectedAlgorithm: 'HMAC-SHA256',
  checkFilesOnDisk: true, cwd: setup.cwd,
});
const rss = async () => {
  const status = await fs.readFile('/proc/self/status', 'utf8');
  return Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024;
};
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
send({ ready: true, pid: process.pid, runtime: process.version });
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    const command = JSON.parse(line);
    if (command.action === 'setup') {
      setup = command;
      receipt = command.receipt ?? await create();
      const result = await verify();
      if (!result.trusted || result.checkedArtifacts !== setup.paths.length) throw Error('Setup verification failed');
      send({ receipt, checkedArtifacts: result.checkedArtifacts });
      continue;
    }
    if (command.action !== 'batch') throw Error('Expected setup or batch');
    const operation = command.operation === 'create' ? create : verify;
    if (global.gc) global.gc();
    const rssBeforeBytes = await rss();
    const usageBefore = process.resourceUsage();
    let result;
    const started = performance.now();
    for (let index = 0; index < command.iterations; index++) result = await operation();
    const elapsedSeconds = (performance.now() - started) / 1000;
    const usageAfter = process.resourceUsage();
    const rssAfterBytes = await rss();
    if (command.operation === 'verify') {
      if (!result.trusted || result.checkedArtifacts !== setup.paths.length) throw Error('Batch verification failed');
    } else if (result.artifacts.length !== setup.paths.length || result.artifacts.some((artifact, index) => (
      artifact.sha256 !== receipt.artifacts[index].sha256 || artifact.sizeBytes !== receipt.artifacts[index].sizeBytes
    ))) {
      throw Error('Batch receipt digest/size mismatch');
    }
    send({ elapsedSeconds, iterations: command.iterations, secondsPerOperation: elapsedSeconds / command.iterations,
      cpuSeconds: ((usageAfter.userCPUTime - usageBefore.userCPUTime) + (usageAfter.systemCPUTime - usageBefore.systemCPUTime)) / 1e6,
      voluntaryContextSwitches: usageAfter.voluntaryContextSwitches - usageBefore.voluntaryContextSwitches,
      involuntaryContextSwitches: usageAfter.involuntaryContextSwitches - usageBefore.involuntaryContextSwitches,
      rssBeforeBytes, rssAfterBytes,
    });
  } catch (error) {
    send({ error: String(error.stack ?? error) });
  }
}

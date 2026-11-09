#!/usr/bin/env node
/** Copy into a consumer with this exact Ledger source package installed. */
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReceipt, ProofSigner } from '@nymrel/proof-ledger';

class DemoError extends Error {}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node task-success-demo.mjs NEW_DIRECTORY');
    console.log('Retains two synthetic signed task fixtures; refuses existing output paths.');
    return;
  }
  if (args.length !== 1 || args[0].trim() === '' || args[0].startsWith('-')) {
    throw new DemoError('Usage: node task-success-demo.mjs NEW_DIRECTORY');
  }
  const directory = path.resolve(args[0]);
  try {
    await fs.mkdir(directory, { mode: 0o700 });
  } catch (error) {
    throw new DemoError(error?.code === 'EEXIST'
      ? 'Output path already exists. Choose a new directory; existing files were not changed.'
      : 'Output directory could not be created. Check its parent path and permissions.');
  }

  const moduleUrl = import.meta.resolve('@nymrel/proof-ledger');
  const cli = fileURLToPath(new URL('../../bin/proof-ledger.js', moduleUrl));
  const packageMetadata = JSON.parse(await fs.readFile(new URL('../../package.json', moduleUrl), 'utf8'));
  const keys = ProofSigner.generateKeyPair();
  // Disposable synthetic signing only. The private key is never written or printed.
  // Provision the expected public context before creating either signed packet.
  const publicConfig = path.join(directory, 'public.json');
  await fs.writeFile(publicConfig, JSON.stringify({ algorithm: 'Ed25519', publicKey: keys.publicKey }), { flag: 'wx' });
  const checks = [];
  for (const [name, status, exitCode, accepted] of [
    ['success', 'SUCCESS', 0, true], ['failure', 'FAILURE', 1, false],
  ]) {
    const root = path.join(directory, name);
    await fs.mkdir(root, { mode: 0o700 });
    await fs.writeFile(path.join(root, 'artifact.txt'), 'Synthetic task-policy artifact\n', { flag: 'wx' });
    const receipt = await createReceipt({
      task: { name: 'Synthetic task claim', status, exitCode },
      artifacts: [{ path: 'artifact.txt' }], cwd: root,
      signingKey: keys.privateKey, signerIdentity: 'synthetic-task-policy-demo',
      algorithm: 'Ed25519', metadata: { purpose: 'local-demo-not-observed-production-execution' },
    });
    await fs.writeFile(path.join(root, 'proof.json'), JSON.stringify(receipt), { flag: 'wx' });
    const run = spawnSync(process.execPath, [cli, 'verify', 'proof.json',
      '--key-file', publicConfig, '--algo', 'Ed25519', '--check-files',
      '--require-task-success', '--json'], {
      cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, shell: false,
    });
    let result;
    try { result = JSON.parse(run.stdout); } catch {
      throw new DemoError('Verifier output was unavailable. Confirm this installed source includes --require-task-success; output is retained.');
    }
    if (result === null || typeof result !== 'object' || run.error || run.signal || run.status !== (accepted ? 0 : 1)
        || !result.valid || !result.trusted || !result.signatureChecked
        || result.checkedArtifacts !== 1 || result.receipt?.version !== '2.0.0'
        || result.receipt?.task.status !== status || result.receipt?.task.exitCode !== exitCode
        || result.policy?.name !== 'authenticated-v2-task-success' || result.policy.passed !== accepted) {
      throw new DemoError('Task policy did not match the expected synthetic outcome. Keep the output and inspect the installed source, original packets and public configuration.');
    }
    checks.push({ name, signedStatus: status, signedExitCode: exitCode,
      authenticated: true, taskPolicyPassed: accepted, verifierExitCode: run.status });
  }
  console.log(JSON.stringify({
    status: 'PASS', meaning: 'Both expected demo outcomes matched; the FAILURE task claim remains failed.',
    scope: 'synthetic signed claims; no observed production execution or authorization',
    directory, module: fileURLToPath(moduleUrl), packageVersion: packageMetadata.version,
    checks, providerCalls: 0,
  }));
}

main().catch(error => {
  console.error(error instanceof DemoError ? error.message
    : 'Demo could not finish. Partial output is retained; inspect permissions and the installed source before retrying in a new directory.');
  process.exitCode = 1;
});

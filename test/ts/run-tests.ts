import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const testFiles = (await readdir(testDirectory))
  .filter((file) => file.endsWith('.test.js'))
  .sort();

if (testFiles.length === 0) {
  console.error('No compiled TypeScript test files were discovered.');
  process.exitCode = 1;
} else {
  if (!testFiles.includes('signal.test.js')) {
    console.error('The compiled Signal profile test was not discovered.');
    process.exitCode = 1;
  }
  console.log(`Discovered ${testFiles.length} compiled TypeScript test files.`);

  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', ...testFiles.map((file) => join(testDirectory, file))],
    { encoding: 'utf8' },
  );
  const output = String(result.stdout ?? '');
  const errors = String(result.stderr ?? '');
  const countMatch = output.match(/^# tests (\d+)$/m);
  const testCount = countMatch === null ? 0 : Number.parseInt(countMatch[1], 10);

  process.stdout.write(output);
  process.stderr.write(errors);

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else if (testCount === 0) {
    console.error('The TypeScript test runner completed without reporting executed tests.');
    process.exitCode = 1;
  } else {
    console.log(`Verified ${testCount} executed TypeScript tests.`);
  }
}

#!/usr/bin/env node
import { runCli } from '../dist/cli.js';

runCli(process.argv.slice(2)).then((code) => {
  if (code !== 0) process.exit(code);
}).catch((err) => {
  console.error('\x1b[31mFatal CLI error:\x1b[0m', err);
  process.exit(1);
});

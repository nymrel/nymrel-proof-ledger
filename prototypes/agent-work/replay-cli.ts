import { Simulation } from './engine.js';
let raw = '';
for await (const chunk of process.stdin) {
  raw += String(chunk);
  if (Buffer.byteLength(raw, 'utf8') > 16 * 1024 * 1024) throw Error('Audit input exceeds 16 MiB');
}
const decoded: unknown = JSON.parse(raw) as unknown;
const bundle = typeof decoded === 'object' && decoded !== null && 'auditBundle' in decoded ? decoded.auditBundle : decoded;
const result = await Simulation.replay(bundle, process.argv[2]);
console.log(JSON.stringify(result));
if (!result.valid) process.exitCode = 1;

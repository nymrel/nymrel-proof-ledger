/** Experimental 0.1 offline checkpoint verifier; caller supplies pins and source adapter. */
import { canonicalHash, canonicalize } from '../core/canonical.js';
import { verifyReceipt } from '../core/receipt.js';

type Obj = Record<string, any>; // JSON decoded and validated before use
const ID = /^[A-Za-z0-9._:@/-]{1,128}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const HEX = /^[0-9a-f]{64}$/;
const obj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const exact = (x: unknown, fields: string): x is Obj => obj(x) && Object.keys(x).sort().join(' ') === fields.split(' ').sort().join(' ');
const id = (x: unknown): x is string => typeof x === 'string' && ID.test(x);
const digest = (x: unknown): x is string => typeof x === 'string' && DIGEST.test(x);
const integer = (x: unknown, min = 0): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= min;

// Tokenize JSON before JSON.parse: detect duplicate decoded names and bound depth.
function parse(text: unknown): any {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) throw Error('size');
  let i = 0;
  const ws = (): void => { while (/[\x20\t\r\n]/.test(text[i] ?? '\0')) i++; };
  const string = (): string => {
    if (text[i] !== '"') throw Error('string');
    const start = i++;
    while (i < text.length) {
      if (text[i] === '"') { i++; return JSON.parse(text.slice(start, i)) as string; }
      if (text[i] === '\\') i++;
      i++;
    }
    throw Error('string');
  };
  const scan = (depth: number): void => {
    if (depth > 32) throw Error('depth');
    ws();
    if (text[i] === '{') {
      i++; ws(); const names = new Set<string>();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        ws(); const name = string(); if (names.has(name)) throw Error('duplicate'); names.add(name);
        ws(); if (text[i++] !== ':') throw Error('colon'); scan(depth + 1); ws();
        const end = text[i++]; if (end === '}') return; if (end !== ',') throw Error('comma');
      }
    }
    if (text[i] === '[') {
      i++; ws(); if (text[i] === ']') { i++; return; }
      for (;;) { scan(depth + 1); ws(); const end = text[i++]; if (end === ']') return; if (end !== ',') throw Error('comma'); }
    }
    if (text[i] === '"') { string(); return; }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!match) throw Error('value'); i += match[0].length;
  };
  scan(1); ws(); if (i !== text.length) throw Error('trailing');
  const value: unknown = JSON.parse(text);
  const walk = (v: unknown): void => {
    if (typeof v === 'number' && Number.isInteger(v) && !Number.isSafeInteger(v)) throw Error('number');
    if (Array.isArray(v)) v.forEach(walk); else if (obj(v)) Object.values(v).forEach(walk);
  };
  walk(value); canonicalize(value); return value;
}
function checkpoint(c: unknown): c is Obj {
  return exact(c, 'schema version sourceProtocol sourceVersion sourceId highestSequence eventCount chainHeadOrStateHash sourceEpochDigest checkpointId signerIdentity keyId') &&
    c.schema === 'nymrel.checkpoint' && c.version === '0.1.0' &&
    ['sourceProtocol','sourceVersion','sourceId','checkpointId','signerIdentity','keyId'].every(k => id(c[k])) &&
    integer(c.eventCount) && c.highestSequence === (c.eventCount ? c.eventCount - 1 : null) &&
    digest(c.chainHeadOrStateHash) && digest(c.sourceEpochDigest);
}
function trust(t: unknown): t is Obj {
  if (!exact(t, 'schema version bundleId revision keys') || t.schema !== 'nymrel.checkpoint-trust-bundle' || t.version !== '0.1.0' || !id(t.bundleId) || !integer(t.revision, 1) || !Array.isArray(t.keys) || t.keys.length < 1 || t.keys.length > 256) return false;
  const ids = new Set<string>(), keys = new Set<string>();
  for (const k of t.keys) {
    if (!exact(k, 'signerIdentity keyId algorithm publicKey state historicalCheckpointDigests') || !id(k.signerIdentity) || !id(k.keyId) || k.algorithm !== 'Ed25519' || typeof k.publicKey !== 'string' || !HEX.test(k.publicKey) || !['ACTIVE','SUPERSEDED','REVOKED'].includes(k.state) || !Array.isArray(k.historicalCheckpointDigests) || k.historicalCheckpointDigests.length > 1024 || !k.historicalCheckpointDigests.every(digest) || new Set(k.historicalCheckpointDigests).size !== k.historicalCheckpointDigests.length || (k.state !== 'SUPERSEDED' && k.historicalCheckpointDigests.length !== 0)) return false;
    const pair = JSON.stringify([k.signerIdentity,k.keyId]); if (ids.has(pair) || keys.has(k.publicKey)) return false;
    ids.add(pair); keys.add(k.publicKey);
  }
  return true;
}
function snapshotObject(value: unknown): unknown {
  if (!obj(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('configuration object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== Object.keys(value).length || Object.values(descriptors).some(d => !d.enumerable || !('value' in d))) throw Error('configuration properties');
  return JSON.parse(canonicalize(value));
}
export interface CheckpointSource { sourceProtocol: string; sourceVersion: string; sourceId: string; sourceEpochDigest: string }
export interface CheckpointOptions {
  bundlePin: { bundleId: string; revision: number; sha256: string };
  checkpointPin: string;
  source: CheckpointSource;
  adapter: (checkpoint: Readonly<Record<string, unknown>>) => Promise<unknown> | unknown;
}
export interface CheckpointResult { accepted: boolean; admission: string; keyPolicy: string; authentication: string; binding: string; sourceComparison: string; suffixCount?: number }
export async function verifyCheckpoint(bundleJson: string, trustJson: string, options: CheckpointOptions): Promise<CheckpointResult> {
  const result: CheckpointResult = { accepted:false, admission:'NOT_CHECKED', keyPolicy:'NOT_CHECKED', authentication:'NOT_CHECKED', binding:'NOT_CHECKED', sourceComparison:'NOT_CHECKED' };
  const fail = (stage: keyof CheckpointResult, code: string): CheckpointResult => { (result as unknown as Record<string, unknown>)[stage] = code; return result; };
  try {
    // Snapshot trusted caller inputs once, before asynchronous verification or adapter calls.
    if (!exact(options, 'bundlePin checkpointPin source adapter') || Object.getPrototypeOf(options) !== Object.prototype || Reflect.ownKeys(options).length !== 4) return fail('admission','MALFORMED_PROFILE');
    const descriptors = Object.getOwnPropertyDescriptors(options);
    if (Object.values(descriptors).some(d => !('value' in d))) return fail('admission','MALFORMED_PROFILE');
    const p = snapshotObject(descriptors.bundlePin.value);
    const s = snapshotObject(descriptors.source.value);
    const checkpointPin: unknown = descriptors.checkpointPin.value;
    const adapter: unknown = descriptors.adapter.value;
    const b: unknown = parse(bundleJson), t: unknown = parse(trustJson);
    if ((obj(b) && obj(b.checkpoint) && b.checkpoint.schema === 'nymrel.checkpoint' && b.checkpoint.version !== '0.1.0') || (obj(t) && t.schema === 'nymrel.checkpoint-trust-bundle' && t.version !== '0.1.0')) return fail('admission','UNSUPPORTED_VERSION');
    if (!exact(b, 'checkpoint receipt') || !checkpoint(b.checkpoint) || !trust(t)) return fail('admission','MALFORMED_PROFILE');
    const c = b.checkpoint, r: unknown = b.receipt;
    if (!exact(p,'bundleId revision sha256') || !id(p.bundleId) || !integer(p.revision,1) || !digest(p.sha256) || !digest(checkpointPin) || !exact(s,'sourceProtocol sourceVersion sourceId sourceEpochDigest') || !(['sourceProtocol','sourceVersion','sourceId'] as const).every(k => id(s[k])) || !digest(s.sourceEpochDigest) || typeof adapter !== 'function') return fail('admission','MALFORMED_PROFILE');
    if (p.bundleId !== t.bundleId || p.revision !== t.revision || p.sha256 !== `sha256:${canonicalHash(t)}`) return fail('admission','TRUST_BUNDLE_PIN_MISMATCH');
    if (checkpointPin !== `sha256:${canonicalHash(c)}`) return fail('admission','CHECKPOINT_PIN_MISMATCH');
    if (!obj(r) || r.version !== '2.0.0') return fail('admission','MALFORMED_PROFILE');
    if (!obj(r.task) || r.task.name !== 'Retain external checkpoint' || r.task.status !== 'ATTESTED' || r.task.exitCode !== 0 || !obj(r.metadata) || Object.keys(r.metadata).length !== 0) return fail('admission','RECEIPT_PROFILE_MISMATCH');
    if (!obj(r.signature) || r.signature.algorithm !== 'Ed25519' || r.signature.signerIdentity !== c.signerIdentity || r.signature.keyId !== c.keyId) return fail('admission','MALFORMED_PROFILE');
    result.admission = 'PASS';
    const key = t.keys.find((k: Obj) => k.signerIdentity === c.signerIdentity && k.keyId === c.keyId);
    if (!key) return fail('keyPolicy','UNKNOWN_KEY');
    if (key.state === 'REVOKED') return fail('keyPolicy','REVOKED_KEY');
    if (key.state === 'SUPERSEDED' && !key.historicalCheckpointDigests.includes(checkpointPin)) return fail('keyPolicy','SUPERSEDED_NOT_ADMITTED');
    result.keyPolicy = key.state === 'ACTIVE' ? 'ACTIVE' : 'HISTORICAL_SUPERSEDED_ALLOWED';
    const verified = await verifyReceipt(r, {publicKeyOrSecret:key.publicKey, expectedAlgorithm:'Ed25519'});
    if (verified.signatureValid === false) return fail('authentication','INVALID_SIGNATURE');
    if (!verified.valid || !verified.trusted || !verified.signatureChecked || !verified.signatureValid) return fail('authentication','RECEIPT_INTEGRITY_FAILURE');
    result.authentication = 'PASS';
    const expected = {path:'checkpoint.json', sha256:checkpointPin.slice(7), sizeBytes:Buffer.byteLength(canonicalize(c),'utf8'), mimeType:'application/json'};
    if (!Array.isArray(r.artifacts) || r.artifacts.length !== 1 || canonicalize(r.artifacts[0]) !== canonicalize(expected)) return fail('binding','CHECKPOINT_BINDING_MISMATCH');
    result.binding = 'PASS';
    if ((['sourceProtocol','sourceVersion','sourceId'] as const).some(k => c[k] !== s[k])) return fail('sourceComparison','SOURCE_IDENTITY_MISMATCH');
    if (c.sourceEpochDigest !== s.sourceEpochDigest) return fail('sourceComparison','SOURCE_EPOCH_MISMATCH');
    let obs: unknown;
    try { obs = await adapter({...c}); } catch { return fail('sourceComparison','SOURCE_UNAVAILABLE'); }
    if (!obj(obs) || obs.status === 'UNAVAILABLE') return fail('sourceComparison','SOURCE_UNAVAILABLE');
    if (obs.status !== 'VALID' || !integer(obs.eventCount)) return fail('sourceComparison','SOURCE_INVALID');
    if ((['sourceProtocol','sourceVersion','sourceId'] as const).some(k => obs[k] !== s[k])) return fail('sourceComparison','SOURCE_IDENTITY_MISMATCH');
    if (obs.sourceEpochDigest !== s.sourceEpochDigest) return fail('sourceComparison','SOURCE_EPOCH_MISMATCH');
    if (obs.eventCount < c.eventCount) return fail('sourceComparison','TRUNCATED_RELATIVE_TO_CHECKPOINT');
    if (!digest(obs.prefixHash)) return fail('sourceComparison','SOURCE_UNAVAILABLE');
    if (obs.prefixHash !== c.chainHeadOrStateHash) return fail('sourceComparison','STATE_MISMATCH');
    result.suffixCount = obs.eventCount - c.eventCount;
    result.sourceComparison = result.suffixCount ? 'CHECKPOINT_PREFIX_MATCH' : 'CHECKPOINT_MATCH'; result.accepted = true; return result;
  } catch { return fail('admission','MALFORMED_PROFILE'); }
}

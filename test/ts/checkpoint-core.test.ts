import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyReceipt } from '../../src/core/receipt.js';
import { canonicalHash } from '../../src/core/canonical.js';
import { verifyCheckpoint } from '../../src/profiles/checkpoint.js';
const f = JSON.parse(readFileSync('test/fixtures/checkpoint-v0.1-vectors.json','utf8'));
const extra = JSON.parse(readFileSync('test/fixtures/checkpoint-core-v0.1-vectors.json','utf8'));
describe('experimental checkpoint core', () => {
  async function run(name = 'active', mutate?: (b: any) => void, observation?: unknown, text?: string, pin?: string) {
    const c = structuredClone(f.checkpoint), b = { checkpoint:c, receipt:structuredClone(f.receipt) };
    const t = f.trustBundles.find((x: any) => x.name === name);
    mutate?.(b);
    const source = {sourceProtocol:c.sourceProtocol, sourceVersion:c.sourceVersion, sourceId:c.sourceId, sourceEpochDigest:c.sourceEpochDigest};
    let calls = 0;
    const result = await verifyCheckpoint(text ?? JSON.stringify(b), JSON.stringify(t.bundle), {
      bundlePin:{bundleId:t.bundle.bundleId, revision:t.bundle.revision, sha256:t.digest}, checkpointPin:pin ?? f.checkpointDigest, source,
      adapter:() => { calls++; return observation ?? {status:'VALID', ...source, eventCount:c.eventCount, prefixHash:c.chainHeadOrStateHash}; },
    });
    return {result,calls};
  }
  it('enforces lifecycle and pins before adapter I/O', async () => {
    for (const [name, expected] of [['superseded-admitted','HISTORICAL_SUPERSEDED_ALLOWED'],['superseded-unadmitted','SUPERSEDED_NOT_ADMITTED'],['revoked-retroactive','REVOKED_KEY'],['unknown-key','UNKNOWN_KEY']]) {
      const {result,calls} = await run(name); assert.equal(result.keyPolicy,expected); assert.equal(calls, name === 'superseded-admitted' ? 1 : 0);
    }
    let r = await run('active',undefined,undefined,undefined,'sha256:'+'0'.repeat(64));
    assert.equal(r.result.admission,'CHECKPOINT_PIN_MISMATCH'); assert.equal(r.calls,0);
    r = await run('active',undefined,undefined,'{"checkpoint":{},"checkpoint":{},"receipt":{}}');
    assert.equal(r.result.admission,'MALFORMED_PROFILE'); assert.equal(r.calls,0);
  });
  it('rejects duplicate names, excessive depth and oversized text before source I/O', async () => {
    for (const text of ['{"checkpoint":{},"check\\u0070oint":{},"receipt":{}}', '['.repeat(33)+'0'+']'.repeat(33), ' '.repeat(2*1024*1024+1)]) {
      const {result,calls} = await run('active',undefined,undefined,text);
      assert.equal(result.admission,'MALFORMED_PROFILE'); assert.equal(calls,0);
    }
  });
  it('runs the shared admission and source cases', async () => {
    for (const item of f.proposedAdmissionCases) {
      if (['boolean-count','count-sequence-mismatch','negative-count','unsupported-checkpoint-version','old-signed-checkpoint-substitution'].includes(item.name)) {
        const {result,calls} = await run('active', b => Object.assign(b.checkpoint,item.change));
        assert.equal(result.admission,item.expected,item.name); assert.equal(calls,0);
      }
    }
    for (const item of f.proposedSourceCases) {
      if (!item.observation) continue;
      const {validEventCount,checkpointPrefixHash,...identity} = item.observation;
      const {result} = await run('active',undefined,{...identity,status:'VALID',eventCount:validEventCount,prefixHash:checkpointPrefixHash});
      assert.equal(result.sourceComparison,item.expectedSourceComparison,item.name);
    }
  });
  it('rejects detached content and new content under a superseded policy', async () => {
    const changed = {...f.checkpoint, checkpointId:'new-checkpoint'};
    const pin = `sha256:${canonicalHash(changed)}`;
    const mutate = (b: any): void => { b.checkpoint = changed; };
    let r = await run('active',mutate,undefined,undefined,pin);
    assert.equal(r.result.binding,'CHECKPOINT_BINDING_MISMATCH'); assert.equal(r.calls,0);
    r = await run('superseded-admitted',mutate,undefined,undefined,pin);
    assert.equal(r.result.keyPolicy,'SUPERSEDED_NOT_ADMITTED'); assert.equal(r.calls,0);
  });
  it('accepts a signed empty source and rejects newly signed superseded content', async () => {
    for (const item of extra.cases) {
      const c = item.checkpoint;
      assert.equal((await verifyReceipt(item.receipt,{publicKeyOrSecret:f.publicKey,expectedAlgorithm:'Ed25519'})).trusted,true);
      const source = {sourceProtocol:c.sourceProtocol, sourceVersion:c.sourceVersion, sourceId:c.sourceId, sourceEpochDigest:c.sourceEpochDigest};
      const mutate = (b: any): void => { b.checkpoint = c; b.receipt = item.receipt; };
      if (item.name === 'empty') {
        const {result} = await run('active',mutate,{status:'VALID',...source,eventCount:0,prefixHash:c.chainHeadOrStateHash},undefined,item.checkpointDigest);
        assert.equal(result.accepted,true); assert.equal(result.sourceComparison,'CHECKPOINT_MATCH');
      } else {
        const {result,calls} = await run('superseded-admitted',mutate,undefined,undefined,item.checkpointDigest);
        assert.equal(result.keyPolicy,'SUPERSEDED_NOT_ADMITTED'); assert.equal(calls,0);
      }
    }
  });
  it('holds detached caller expectations across asynchronous adapter mutation', async () => {
    const c = f.checkpoint, t = f.trustBundles.find((x: any) => x.name === 'active');
    const source = {sourceProtocol:c.sourceProtocol, sourceVersion:c.sourceVersion, sourceId:c.sourceId, sourceEpochDigest:c.sourceEpochDigest};
    const options = {bundlePin:{bundleId:t.bundle.bundleId, revision:t.bundle.revision, sha256:t.digest}, checkpointPin:f.checkpointDigest, source,
      adapter:async (checkpoint: Readonly<Record<string, unknown>>) => {
        await Promise.resolve();
        source.sourceId = 'different-source';
        (checkpoint as Record<string, unknown>).sourceId = 'different-source';
        return {status:'VALID',...source,eventCount:c.eventCount,prefixHash:c.chainHeadOrStateHash};
      }};
    const result = await verifyCheckpoint(JSON.stringify({checkpoint:c,receipt:f.receipt}),JSON.stringify(t.bundle),options);
    assert.equal(result.accepted,false); assert.equal(result.sourceComparison,'SOURCE_IDENTITY_MISMATCH');
  });
  it('rejects accessor and custom-prototype configuration without invoking getters', async () => {
    const c = f.checkpoint, t = f.trustBundles.find((x: any) => x.name === 'active');
    const source = {sourceProtocol:c.sourceProtocol, sourceVersion:c.sourceVersion, sourceId:c.sourceId, sourceEpochDigest:c.sourceEpochDigest};
    let reads = 0, calls = 0;
    const options = {bundlePin:{bundleId:t.bundle.bundleId,revision:t.bundle.revision,sha256:t.digest},checkpointPin:f.checkpointDigest,source,adapter:() => {calls++;}};
    Object.defineProperty(source,'sourceId',{enumerable:true,get:() => {reads++; return c.sourceId;}});
    let result = await verifyCheckpoint(JSON.stringify({checkpoint:c,receipt:f.receipt}),JSON.stringify(t.bundle),options);
    assert.equal(result.admission,'MALFORMED_PROFILE'); assert.equal(reads,0); assert.equal(calls,0);
    options.source = Object.assign(Object.create({inherited:true}),{sourceProtocol:c.sourceProtocol,sourceVersion:c.sourceVersion,sourceId:c.sourceId,sourceEpochDigest:c.sourceEpochDigest});
    result = await verifyCheckpoint(JSON.stringify({checkpoint:c,receipt:f.receipt}),JSON.stringify(t.bundle),options);
    assert.equal(result.admission,'MALFORMED_PROFILE'); assert.equal(calls,0);
  });
  it('authenticates, binds and compares only verified prefixes', async () => {
    let r = await run(); assert.equal(r.result.accepted,true); assert.equal(r.calls,1);
    r = await run('active', b => { b.receipt.metadata.x = 1; }); assert.equal(r.result.admission,'RECEIPT_PROFILE_MISMATCH'); assert.equal(r.calls,0);
    r = await run('active', b => { b.receipt.artifacts[0].sha256 = '0'.repeat(64); }); assert.equal(r.result.authentication,'RECEIPT_INTEGRITY_FAILURE'); assert.equal(r.calls,0);
    const c = f.checkpoint, source = {sourceProtocol:c.sourceProtocol, sourceVersion:c.sourceVersion, sourceId:c.sourceId, sourceEpochDigest:c.sourceEpochDigest};
    for (const [observation,expected] of [[{status:'UNAVAILABLE'},'SOURCE_UNAVAILABLE'], [{status:'VALID',...source,eventCount:2},'TRUNCATED_RELATIVE_TO_CHECKPOINT'], [{status:'VALID',...source,eventCount:3,prefixHash:'sha256:'+'0'.repeat(64)},'STATE_MISMATCH'], [{status:'VALID',...source,eventCount:4,prefixHash:c.chainHeadOrStateHash},'CHECKPOINT_PREFIX_MATCH']] as const) {
      r = await run('active',undefined,observation); assert.equal(r.result.sourceComparison,expected); assert.equal(r.result.accepted,expected === 'CHECKPOINT_PREFIX_MATCH');
    }
  });
});

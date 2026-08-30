import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  validateReceiptEnvelope,
  EnvelopeErrorCode,
  type ReceiptEnvelopeValidationResult,
} from '../../src/index.js';
import { createReceipt } from '../../src/core/receipt.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const HASH_E = 'e'.repeat(64);
const SIG_HEX = 'f'.repeat(128);

/** Portable valid envelope vector, mirrored in test/python/test_envelope.py. */
function buildValidEnvelope(): Record<string, unknown> {
  return {
    version: '2.0.0',
    protocol: 'nymrel-proof-ledger',
    proofId: 'prf_interop_vector_0001',
    timestamp: '2026-08-21T12:00:00.000Z',
    parentOrganization: 'Nymrel',
    task: {
      name: 'interop-envelope-vector',
      runner: 'test-runner',
      status: 'SUCCESS',
      exitCode: 0,
    },
    environment: { platform: 'test', arch: 'test', runtime: 'vector' },
    artifacts: [
      {
        path: 'artifacts/proof.txt',
        sha256: HASH_A,
        sizeBytes: 11,
        mimeType: 'text/plain',
      },
    ],
    merkle: {
      algorithm: 'RFC6962-SHA256',
      leaves: [HASH_B, HASH_C, HASH_D],
      root: HASH_E,
    },
    signature: {
      algorithm: 'HMAC-SHA256',
      keyId: 'hmac-default',
      signerIdentity: 'interop-tester',
      value: SIG_HEX,
      timestamp: '2026-08-21T12:00:00.000Z',
    },
    metadata: {},
  };
}

function codesOf(result: ReceiptEnvelopeValidationResult): string[] {
  return result.errors.map((error) => error.code);
}

describe('Receipt Envelope Interop Validator', () => {
  it('accepts the portable valid envelope vector', () => {
    const result = validateReceiptEnvelope(buildValidEnvelope());
    assert.deepStrictEqual(result, { valid: true, errors: [] });
  });

  it('accepts a receipt produced by createReceipt unchanged', async () => {
    const receipt = await createReceipt({
      task: { name: 'Interop Acceptance', runner: 'test-runner' },
      artifacts: [{ path: 'interop.txt', data: 'portable payload' }],
      signingKey: 'interop-test-secret',
      signerIdentity: 'interop-tester',
      algorithm: 'HMAC-SHA256',
    });

    const result = validateReceiptEnvelope(receipt);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  it('accepts an envelope round-tripped through JSON serialization', () => {
    const serialized = JSON.parse(JSON.stringify(buildValidEnvelope()));
    const result = validateReceiptEnvelope(serialized);
    assert.strictEqual(result.valid, true);
  });

  it('rejects a non-object envelope with ENVELOPE_NOT_OBJECT', () => {
    for (const input of [null, 'receipt', 42, [], true]) {
      const result = validateReceiptEnvelope(input);
      assert.strictEqual(result.valid, false);
      assert.deepStrictEqual(codesOf(result), [EnvelopeErrorCode.ENVELOPE_NOT_OBJECT]);
      assert.strictEqual(result.errors[0].path, null);
    }
  });

  it('rejects an unsupported protocol identifier', () => {
    const envelope = buildValidEnvelope();
    envelope['protocol'] = 'acme-ledger';
    const result = validateReceiptEnvelope(envelope);
    assert.strictEqual(result.valid, false);
    assert.deepStrictEqual(codesOf(result), [EnvelopeErrorCode.PROTOCOL_UNSUPPORTED]);
    assert.strictEqual(result.errors[0].path, 'protocol');
  });

  it('renders Unicode protocol values without ASCII escapes', () => {
    const envelope = buildValidEnvelope();
    envelope['protocol'] = 'é';
    const result = validateReceiptEnvelope(envelope);
    assert.strictEqual(
      result.errors[0].message,
      `Unsupported protocol identifier: expected 'nymrel-proof-ledger', got "é".`
    );
  });

  it('rejects a missing protocol identifier', () => {
    const envelope = buildValidEnvelope();
    delete envelope['protocol'];
    const result = validateReceiptEnvelope(envelope);
    assert.deepStrictEqual(codesOf(result), [EnvelopeErrorCode.PROTOCOL_MISSING]);
  });

  it('rejects an unsupported version', () => {
    const envelope = buildValidEnvelope();
    envelope['version'] = '3.0.0';
    const result = validateReceiptEnvelope(envelope);
    assert.deepStrictEqual(codesOf(result), [EnvelopeErrorCode.VERSION_UNSUPPORTED]);
    assert.strictEqual(result.errors[0].path, 'version');
  });

  it('accepts the legacy v1 envelope and algorithm for verification', () => {
    const envelope = buildValidEnvelope();
    envelope['version'] = '1.0.0';
    (envelope['merkle'] as Record<string, unknown>)['algorithm'] = 'SHA-256';
    assert.deepStrictEqual(validateReceiptEnvelope(envelope), { valid: true, errors: [] });
  });

  it('rejects a Merkle algorithm that does not match the receipt era', () => {
    const envelope = buildValidEnvelope();
    (envelope['merkle'] as Record<string, unknown>)['algorithm'] = 'SHA-256';
    const result = validateReceiptEnvelope(envelope);
    assert.deepStrictEqual(codesOf(result), [EnvelopeErrorCode.FIELD_TYPE_INVALID]);
    assert.strictEqual(result.errors[0].path, 'merkle.algorithm');
  });

  it('rejects a missing proofId', () => {
    const envelope = buildValidEnvelope();
    delete envelope['proofId'];
    const result = validateReceiptEnvelope(envelope);
    assert.deepStrictEqual(codesOf(result), [EnvelopeErrorCode.FIELD_MISSING]);
    assert.strictEqual(result.errors[0].path, 'proofId');
  });

  it('rejects a malformed timestamp shape', () => {
    const envelope = buildValidEnvelope();
    envelope['timestamp'] = '2026-08-21 12:00:00';
    const result = validateReceiptEnvelope(envelope);
    assert.deepStrictEqual(codesOf(result), [EnvelopeErrorCode.TIMESTAMP_MALFORMED]);
    assert.strictEqual(result.errors[0].path, 'timestamp');
  });

  it('rejects a tampered merkle root that is not a SHA-256 hex digest', () => {
    const envelope = buildValidEnvelope();
    (envelope['merkle'] as Record<string, unknown>)['root'] = 'not-a-hash';
    const result = validateReceiptEnvelope(envelope);
    assert.deepStrictEqual(codesOf(result), [EnvelopeErrorCode.HASH_MALFORMED]);
    assert.strictEqual(result.errors[0].path, 'merkle.root');
  });

  it('rejects a tampered artifact digest', () => {
    const envelope = buildValidEnvelope();
    (envelope['artifacts'] as Array<Record<string, unknown>>)[0]['sha256'] = 'zzzz';
    const result = validateReceiptEnvelope(envelope);
    assert.deepStrictEqual(codesOf(result), [EnvelopeErrorCode.HASH_MALFORMED]);
    assert.strictEqual(result.errors[0].path, 'artifacts[0].sha256');
  });

  it('rejects artifacts that are not an array', () => {
    const envelope = buildValidEnvelope();
    envelope['artifacts'] = {};
    const result = validateReceiptEnvelope(envelope);
    assert.deepStrictEqual(codesOf(result), [EnvelopeErrorCode.FIELD_TYPE_INVALID]);
    assert.strictEqual(result.errors[0].path, 'artifacts');
  });

  it('rejects an empty task name', () => {
    const envelope = buildValidEnvelope();
    (envelope['task'] as Record<string, unknown>)['name'] = '';
    const result = validateReceiptEnvelope(envelope);
    assert.deepStrictEqual(codesOf(result), [EnvelopeErrorCode.FIELD_TYPE_INVALID]);
    assert.strictEqual(result.errors[0].path, 'task.name');
  });

  it('rejects non-object metadata', () => {
    const envelope = buildValidEnvelope();
    envelope['metadata'] = [];
    const result = validateReceiptEnvelope(envelope);
    assert.deepStrictEqual(codesOf(result), [EnvelopeErrorCode.FIELD_TYPE_INVALID]);
    assert.strictEqual(result.errors[0].path, 'metadata');
  });

  it('reports multiple errors in a stable field order', () => {
    const envelope = buildValidEnvelope();
    delete envelope['version'];
    envelope['timestamp'] = 'yesterday';
    (envelope['merkle'] as Record<string, unknown>)['root'] = 'deadbeef';

    const result = validateReceiptEnvelope(envelope);
    assert.strictEqual(result.valid, false);
    assert.deepStrictEqual(
      result.errors.map((error) => ({ code: error.code, path: error.path })),
      [
        { code: EnvelopeErrorCode.VERSION_MISSING, path: 'version' },
        { code: EnvelopeErrorCode.TIMESTAMP_MALFORMED, path: 'timestamp' },
        { code: EnvelopeErrorCode.HASH_MALFORMED, path: 'merkle.root' },
      ]
    );
  });
});

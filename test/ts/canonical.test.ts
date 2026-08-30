import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { canonicalize, canonicalizeLegacy, canonicalHash } from '../../src/core/canonical.js';

interface CanonicalVectors {
  canonical: {
    sample: unknown;
    sampleCanonical: string;
    numeric: unknown;
    numericCanonical: string;
  };
}

const vectors = JSON.parse(
  readFileSync('test/fixtures/protocol-v2-vectors.json', 'utf8')
) as CanonicalVectors;

describe('Canonical JSON (RFC 8785)', () => {
  it('matches shared cross-runtime RFC 8785 vectors', () => {
    assert.strictEqual(canonicalize(vectors.canonical.sample), vectors.canonical.sampleCanonical);
    assert.strictEqual(canonicalize(vectors.canonical.numeric), vectors.canonical.numericCanonical);
  });

  it('sorts Unicode object keys by UTF-16 code units', () => {
    assert.strictEqual(
      canonicalize({ 'דּ': 'hebrew', '😀': 'emoji', '€': 'euro' }),
      '{"€":"euro","😀":"emoji","דּ":"hebrew"}'
    );
  });

  it('rejects values outside the I-JSON data model', () => {
    const sparse: unknown[] = [];
    sparse.length = 1;
    assert.throws(() => canonicalize(undefined), /cannot canonicalize/);
    assert.throws(() => canonicalize(Number.NaN), /non-finite/);
    assert.throws(() => canonicalize('\ud800'), /lone UTF-16 surrogate/);
    assert.throws(() => canonicalize(new Date()), /only JSON objects/);
    assert.throws(() => canonicalize(sparse), /sparse array/);
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get: () => 'side effect',
    });
    assert.throws(() => canonicalize(accessor), /accessor properties/);
    assert.throws(
      () => canonicalize({ [Symbol('hidden')]: 'value' }),
      /symbol properties/
    );
  });

  it('retains the frozen v1 serializer as an explicit profile', () => {
    assert.strictEqual(
      canonicalizeLegacy({ omitted: undefined, date: new Date('2026-01-01T00:00:00Z') }),
      '{"date":"2026-01-01T00:00:00.000Z"}'
    );
  });

  it('hashes insertion-order variants identically', () => {
    const first = { b: 2, a: 1 };
    const second = { a: 1, b: 2 };
    assert.strictEqual(canonicalHash(first), canonicalHash(second));
    assert.match(canonicalHash(first), /^[0-9a-f]{64}$/);
  });
});

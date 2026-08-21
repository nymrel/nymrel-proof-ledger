import { describe, it } from 'node:test';
import assert from 'node:assert';
import { canonicalize, canonicalHash } from '../../src/core/canonical.js';

describe('Canonical JSON (RFC 8785)', () => {
  it('sorts object keys lexicographically', () => {
    const objA = { b: 2, a: 1, c: 3 };
    const objB = { c: 3, b: 2, a: 1 };
    assert.strictEqual(canonicalize(objA), '{"a":1,"b":2,"c":3}');
    assert.strictEqual(canonicalize(objB), '{"a":1,"b":2,"c":3}');
    assert.strictEqual(canonicalHash(objA), canonicalHash(objB));
  });

  it('handles nested objects and arrays deterministically', () => {
    const complex = {
      z: [3, 2, { y: true, x: false }],
      a: { nested: 'value', count: 42 },
    };
    const expected = '{"a":{"count":42,"nested":"value"},"z":[3,2,{"x":false,"y":true}]}';
    assert.strictEqual(canonicalize(complex), expected);
  });

  it('handles primitives, booleans, and null', () => {
    assert.strictEqual(canonicalize(null), 'null');
    assert.strictEqual(canonicalize(true), 'true');
    assert.strictEqual(canonicalize(false), 'false');
    assert.strictEqual(canonicalize(12345), '12345');
    assert.strictEqual(canonicalize('hello world'), '"hello world"');
  });

  it('produces consistent 64-char hex SHA-256 digests', () => {
    const hash = canonicalHash({ task: 'test', status: 'SUCCESS' });
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

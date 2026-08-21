/**
 * RFC 8785 compliant Canonical JSON (JSON Canonicalization Scheme - JCS)
 * and cryptographic hashing utilities for deterministic cross-language attestations.
 *
 * @module @nymrel/proof-ledger/core/canonical
 */

import { createHash } from 'node:crypto';

/**
 * Serializes any JavaScript object or value into RFC 8785 Canonical JSON string.
 * Object keys are sorted lexicographically by UTF-16 code units.
 * No extraneous whitespace is introduced.
 *
 * @param value - The value to serialize.
 * @returns Deterministic canonical JSON string.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Cannot canonicalize non-finite numbers');
    }
    // Number format adhering to standard JSON serialization
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const serializedElements = value.map((item) =>
      item === undefined || typeof item === 'symbol' || typeof item === 'function'
        ? 'null'
        : canonicalize(item)
    );
    return `[${serializedElements.join(',')}]`;
  }

  if (typeof value === 'object') {
    // Handle Date instances by serializing to ISO string
    if (value instanceof Date) {
      return JSON.stringify(value.toISOString());
    }

    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'symbol' && typeof obj[k] !== 'function')
      .sort((a, b) => {
        // UTF-16 / Unicode code point sorting (standard ASCII comparison)
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });

    const entries = keys.map((key) => {
      const escapedKey = JSON.stringify(key);
      const valStr = canonicalize(obj[key]);
      return `${escapedKey}:${valStr}`;
    });

    return `{${entries.join(',')}}`;
  }

  throw new TypeError(`Unsupported type for canonicalization: ${typeof value}`);
}

/**
 * Calculates a cryptographic hash of a canonicalized JSON payload.
 *
 * @param data - The data object to hash.
 * @param algorithm - Hash algorithm (default: 'sha256').
 * @returns Hex-encoded hash string.
 */
export function canonicalHash(data: unknown, algorithm: string = 'sha256'): string {
  const canonicalString = canonicalize(data);
  return createHash(algorithm).update(canonicalString, 'utf8').digest('hex');
}

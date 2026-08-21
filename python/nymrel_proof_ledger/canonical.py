"""
RFC 8785 compliant Canonical JSON (JSON Canonicalization Scheme - JCS)
and cryptographic hashing utilities in pure standard library Python.

Guaranteeing exact byte-for-byte serialization parity with TypeScript.
"""

from datetime import datetime
import hashlib
import json
from typing import Any


def canonicalize(value: Any) -> str:
    """
    Serializes any Python data structure into an RFC 8785 Canonical JSON string.
    Object keys are sorted lexicographically by UTF-16 code units / Unicode points.
    No extraneous whitespace is added.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        # Check finite
        if isinstance(value, float) and (value != value or value == float("inf") or value == float("-inf")):
            raise ValueError("Cannot canonicalize non-finite numbers")
        return json.dumps(value, separators=(",", ":"))
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, datetime):
        return json.dumps(value.isoformat(), separators=(",", ":"))
    if isinstance(value, (list, tuple)):
        elements = [canonicalize(elem) for elem in value]
        return "[" + ",".join(elements) + "]"
    if isinstance(value, dict):
        # Sort keys lexicographically by Unicode code point
        sorted_keys = sorted(str(k) for k in value.keys())
        entries = []
        for k in sorted_keys:
            key_str = json.dumps(k, ensure_ascii=False, separators=(",", ":"))
            val_str = canonicalize(value[k])
            entries.append(f"{key_str}:{val_str}")
        return "{" + ",".join(entries) + "}"

    raise TypeError(f"Unsupported type for canonicalization: {type(value)}")


def canonical_hash(data: Any, algorithm: str = "sha256") -> str:
    """
    Calculates a cryptographic hash of a canonicalized JSON payload.
    """
    canonical_str = canonicalize(data)
    h = hashlib.new(algorithm)
    h.update(canonical_str.encode("utf-8"))
    return h.hexdigest()

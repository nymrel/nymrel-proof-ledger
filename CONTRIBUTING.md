# Contributing to Nymrel Proof Ledger

Protocol and cryptographic changes require matched TypeScript and Python
behavior, shared vectors, and fail-closed tests. A green test in only one
runtime is not sufficient.

## Development requirements

- Node.js 22.12 or newer, through 26.x
- npm 11
- Python 3.11 through 3.14
- uv for isolated Python matrix runs

Install Node development dependencies without lifecycle scripts:

~~~powershell
npm install --ignore-scripts
~~~

Run the local release gate:

~~~powershell
npm run test:release
npm audit --audit-level=high
npm pack --dry-run
~~~

Run Python checks in an isolated environment:

~~~powershell
uv run --isolated --no-project --python 3.13 --with "cryptography>=50.0.1,<51" --with "rfc8785==0.1.4" python -m unittest discover -s test/python -p "test_*.py"
uvx ruff check python test/python
uvx pip-audit .
~~~

## Protocol change checklist

1. Identify whether the change affects emitted v2 receipts, v1 verification, or
   both.
2. Preserve v1 behavior only in the named legacy canonicalization and Merkle
   profiles.
3. Add or update a shared fixture in
   test/fixtures/protocol-v2-vectors.json.
4. Add equivalent focused tests in test/ts and test/python.
5. Verify exact outputs across Node.js 22, 24, and 26 and Python 3.11 through
   3.14.
6. Confirm malformed envelopes fail before cryptography or filesystem access.
7. Update README.md and SECURITY.md when the public contract changes.

Do not silently reinterpret malformed key material, downgrade an unsupported
version, duplicate odd RFC 6962 nodes, or label an unchecked signature as
trusted.

## Dependency rules

The Node.js runtime remains production-dependency-free. Python dependencies are
allowed when they replace sensitive homegrown cryptography or are required for
standards correctness. New dependencies need a maintenance, provenance,
licensing, and vulnerability review.

## Pull requests

Keep protocol changes reviewable and include:

- the exact protocol behavior changed
- compatibility impact
- test and runtime-matrix evidence
- package audit and package-build evidence
- any external publication or provider gate still outstanding

Do not claim npm, PyPI, hosted verification, or release completion from local
tests alone.

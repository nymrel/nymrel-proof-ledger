# Contributing to Nymrel Proof Ledger

Protocol and cryptographic changes require matched TypeScript and Python
behavior, shared vectors, and fail-closed tests. A green test in only one
runtime is not sufficient.

Ideas, questions, documentation corrections, and independent example reports
are welcome. For an early idea, share the problem, who could benefit, and any
open questions; code and a finished specification are not prerequisites. Search
existing [issues and pull requests](https://github.com/nymrel/nymrel-proof-ledger/issues)
and use the relevant thread when one exists. For an independent installed-consumer
trial, see the [human trial guide](docs/HUMAN_TRIAL.md). Report vulnerabilities
privately following [SECURITY.md](SECURITY.md).

## Development requirements

- Node.js 22.12 or newer, through 26.x
- npm 11
- Python 3.11 through 3.14
- uv for isolated Python matrix runs

Install Node development dependencies without lifecycle scripts:

~~~powershell
npm ci --ignore-scripts
~~~

Run the local release gate:

~~~powershell
npm run test:release
npm run test:installed
npm audit --audit-level=high
npm pack --dry-run
~~~

The combined gate builds TypeScript once, then runs the TypeScript, Python, and
cross-runtime suites. `npm run test:cross` also builds first, so it works from a
clean checkout. The internal `test:cross:built` command requires a current build
and lets the combined gate reuse its output.

CI keeps the full Node and Python matrices. Node jobs type-check during the
build instead of running the same compiler checks twice. The CI Python-tool
cache keys include dependency declarations in package scripts and workflows.
Release verification, distribution builds, and publishing remain uncached.

The [workflow optimization goal](docs/WORKFLOW_OPTIMIZATION_GOAL.md) records
acceptance criteria and the ongoing source/review lane. Release preflight runs
before dependency installation; its errors explain version, tag, and source
history recovery. To check a selected release ref locally, run
`python tools/check_release.py` from the checkout with `RELEASE_REF_TYPE` set to
`tag` or `branch` and `RELEASE_REF_NAME` set to that ref. This verifies the current
checkout; it does not switch refs. Branch verification does not publish packages.

Attestation and both publishers verify the complete downloaded archive set and
its checksums before consuming it. These checks detect a mismatched download;
they do not independently authenticate the checksum manifest. For a mismatch,
inspect the original run's retained artifact and checksum results before
retrying. Recover the same immutable distributions through the existing release
run; do not retag or rebuild merely to retry a registry failure. Trusted-publisher
account configuration remains a separate prerequisite.

Run Python checks in an isolated environment:

~~~powershell
uv run --isolated --no-project --python 3.13 --with "cryptography>=50.0.1,<51" --with "rfc8785==0.1.4" python -m unittest discover -s test/python -p "test_*.py"
uvx ruff@0.16.5 check --select E4,E7,E9,F python test tools
uvx pip-audit@2.10.1 .
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

AI-assisted contributions are welcome. Disclose meaningful assistance and review
the submitted work and its claims. Record the tested revision, environment, and
actual command results; mark checks not run with a reason. Keep local results,
hosted checks, and independent human observations distinct.

Keep protocol changes reviewable and include:

- the exact protocol behavior changed
- compatibility impact
- test and runtime-matrix evidence
- package audit and package-build evidence
- any external publication or provider gate still outstanding

Do not claim npm, PyPI, hosted verification, or release completion from local
tests alone.

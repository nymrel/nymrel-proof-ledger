# Working on Nymrel Proof Ledger

This repository is an offline receipt library and CLI with matched TypeScript
and Python implementations. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the
authoritative development checks and [SECURITY.md](SECURITY.md) for trust and
artifact boundaries. Use this guide as an entry point, not a replacement.

## Start with an observable outcome

- State the user-visible behavior and a concrete acceptance check before editing.
- Read the current implementation, tests, and relevant open issue or PR. Preserve
  unrelated changes; isolate parallel implementation in separate branches and
  worktrees with disjoint file ownership.
- Reuse the existing scripts and tests before adding a new harness, dependency,
  service, or workflow. The Node runtime has no production dependencies.
- For adoption work, consult [the existing goal](docs/90_DAY_GOAL.md). Workflow
  work uses [the existing workflow lane](docs/WORKFLOW_OPTIMIZATION_GOAL.md);
  completed milestones are not a reason to create duplicate work.

## Development commands

Supported runtimes: Node.js 22.12 through 26.x, npm 11, Python 3.11 through 3.14,
and uv for isolated Python checks. Install with `npm ci --ignore-scripts`.

| Purpose | Command |
| --- | --- |
| Build TypeScript | `npm run build` |
| Type-check without emitting | `npm run typecheck` |
| Build and run TypeScript tests | `npm test` |
| Run isolated Python tests | `npm run test:py` |
| Build and check actual cross-runtime authentication | `npm run test:cross` |
| Combined local release gate | `npm run test:release` |
| Install built archives into clean consumers | `npm run test:installed -- --output <new-directory-outside-checkout>` |
| Exercise the Node signing/verification journey after building | `node examples/ed25519-demo.mjs` |

The installed-consumer check builds the npm archive, wheel, and source archive,
then tests the installed packages outside the checkout. Keep its retained output
outside this repository. It records source identities, archive checksums,
command outcomes, and elapsed times. It does not publish packages.

The combined gate reuses one TypeScript build. Do not use `test:cross:built`
without a current build. Follow CONTRIBUTING.md for audits, Python static checks,
package inspection, and any additional checks required by the changed scope.

## Preserve these contracts

- Protocol and cryptographic changes require matching behavior in both runtimes,
  shared vectors, and fail-closed regressions. Preserve frozen v1 verification
  and v2 wire compatibility unless the requested change explicitly versions them.
- `valid` alone does not mean `trusted`. Authenticated verification requires an
  independently configured key and expected algorithm. Never describe a signed
  task record as independent observation of execution or signer authority.
- Keep signing secrets out of ordinary logs and receipts. Never distribute HMAC
  secrets as public verification material; prefer public-only Ed25519 verification
  when verifiers must not gain signing capability. Preserve exclusive key-file
  creation and documented filesystem boundaries.
- Reject malformed envelopes before cryptography or disk access. Preserve
  artifact containment, symlink handling, and bounded file hashing.
- Reuse existing canonicalization, Merkle, and signing primitives; do not add
  competing cryptographic implementations.
- Preserve configured CI, review, and release controls. Local checks are not
  hosted-matrix results, registry publication, or human adoption evidence.

## Done means demonstrated behavior

Run the checks relevant to the change and required contributor gates. For CLI or
certificate changes, inspect the actual output and failure/recovery path. For
installation changes, exercise the built distributions as installed consumers.
Do not add tests that merely restate documentation or implementation details.

Report what changed, the exact source revision, checks actually run and their
results, and any remaining required review or external acceptance. Distinguish
local validation, merged source, hosted release, and real human trials. Keep
source-bound evidence in the existing issue/PR lane instead of another queue.

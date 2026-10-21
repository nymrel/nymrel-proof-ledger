# Workflow optimization goal

Canonical continuation: [goal 32](https://github.com/nymrel/nymrel-proof-ledger/issues/32).

Make development, CI, and release workflows efficient, verifiable, and recoverable
while preserving runtime coverage and publication controls. This goal covers
automation and contributor guidance. Product and cryptographic changes keep
their own review lanes.

## Acceptance

- The combined gate emits TypeScript once. Standalone cross-runtime testing
  also works from a clean checkout.
- Every Node/Python matrix entry, scheduled security check, dependency audit,
  provenance step, and protected publication environment remains effective.
- Preflight rejects mismatched versions, wrong tags, and sources outside main
  history before dependency installation. Errors explain a recovery action;
  manual branch verification remains available.
- Downloaded distributions match the complete checksum manifest before
  attestation or publication. Corrupt, missing, unlisted, duplicate, and
  out-of-scope entries fail closed.
- Focused failure-path checks, the full release gate, workflow validation, and
  independent source review pass on the final candidate.
- Hosted checks and configured review precede integration. Local source proof,
  adoption, and registry publication remain distinct outcomes.

## Execution loop

1. Read current source and overlapping candidates before editing.
2. Select a demonstrated friction and a falsifiable outcome.
3. Make a scoped reversible change, then run the smallest useful behavioral
   check and the affected repository gates.
4. Retain failed attempts and final evidence; record the exact candidate and
   next action in goal 32 and its existing PR.
5. Continue until this milestone is adopted or a precise access, review, or
   failing-check dependency remains. Reuse this lane for the next improvement.

Measure compiler invocations and observed check outcomes. Timing improvements
need comparable measurements; removing duplicate commands alone does not prove
a wall-clock speedup. This goal does not configure a background worker or timer.

## Current milestone

The candidate builds on main `232849c4e833da992cbcdcc6fa4b7bd0f56cbde3`
and preserves the prior compiler/cache/preflight-order improvements. The next
slice makes preflight independently testable and verifies downloaded archives.
The current execution receipt and remaining gates are recorded in goal 32.

PR31's installed-distribution acceptance and PR29's action updates remain separate
work. Preserve their additions when integrating overlapping workflow files.

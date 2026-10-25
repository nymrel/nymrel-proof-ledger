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

The initial milestone is complete through
[PR33](https://github.com/nymrel/nymrel-proof-ledger/pull/33), merged as
`87c5ce622f4f9f27a677844f98ac568ee84fed88`. Preflight is independently testable,
and all three downloaded-archive consumers verify the complete checksum set.
[PR34](https://github.com/nymrel/nymrel-proof-ledger/pull/34), merged as
`92c8788b659d0a893aea6bb41033e882620a4675`, continues the action-pin updates.
Goal 32 records their exact-source reviews and successful hosted checks.

[PR31](https://github.com/nymrel/nymrel-proof-ledger/pull/31) is also integrated,
at `10a9412eae1d49c02eb6a90e8510451d4d0532ed`; its installed-distribution checks
and retained acceptance archives compose with those workflow improvements.
Readback at main `3656374615fc32c4c8da87688a5c53416e9a86be` confirmed all of these
changes remain present. The combined gate emits once, although its separate
no-emit typecheck still invokes the compiler a second time. No measured timing
improvement is inferred from that distinction.

Keep goal 32 as the existing continuation for a demonstrated new bottleneck or
an authorized release/recovery observation. Hosted release execution, artifact
transfer recovery, registry publication, and human adoption require their own
evidence; completed source milestones do not establish those outcomes.

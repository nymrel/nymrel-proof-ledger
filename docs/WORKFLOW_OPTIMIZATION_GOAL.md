# Workflow optimization goal

Canonical record: [goal 32](https://github.com/nymrel/nymrel-proof-ledger/issues/32).

**Status — October 25, 2026:** The workflow implementation and action-update
milestones are complete and integrated. The source and hosted-CI receipts below
support closing goal 32; actual release-run and registry outcomes remain separate.

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

## Completed milestones

- [PR33](https://github.com/nymrel/nymrel-proof-ledger/pull/33) integrated the
  compiler reuse, testable preflight, and complete archive guards as
  `87c5ce622f4f9f27a677844f98ac568ee84fed88`.
  [Merged-main CI](https://github.com/nymrel/nymrel-proof-ledger/actions/runs/39540253054)
  passed all eight jobs. Goal 32 retains the independent review and failure-path
  evidence for this revision.
- [PR34](https://github.com/nymrel/nymrel-proof-ledger/pull/34) integrated the
  reviewed action updates as `92c8788b659d0a893aea6bb41033e882620a4675`.
  [Merged-main CI](https://github.com/nymrel/nymrel-proof-ledger/actions/runs/39711816908)
  passed all eight jobs. The action update preserved the workflow commands,
  matrices, permissions, checksum guards, provenance, and publication controls.
- [PR31](https://github.com/nymrel/nymrel-proof-ledger/pull/31) subsequently
  integrated installed-distribution acceptance and the PR30 portable demo as
  `10a9412eae1d49c02eb6a90e8510451d4d0532ed`. Its earlier separate-lane handoff is
  complete; see the [review disposition](PR31_REVIEW.md).

All three merges are ancestors of the inspected current main,
`3656374615fc32c4c8da87688a5c53416e9a86be`. The closeout adds persistent tests
that execute the actual archive guards in all three consuming jobs against
valid and rejected distribution sets. These tests run through the existing
Python suite; they do not exercise hosted artifact transfer or publishing.

Reuse goal 32 if a demonstrated new workflow problem appears. There is no
remaining implementation increment merely to keep this goal open. Acceptance
of the artifact-transfer actions during a real release, provenance generation,
and npm/PyPI publication retain the existing release process and authority.

# Goal execution — October 18, 2026

## Current disposition — October 28, 2026

Source preparation and recovery improvements integrated through
[PR41](https://github.com/nymrel/nymrel-proof-ledger/pull/41) and
[PR42](https://github.com/nymrel/nymrel-proof-ledger/pull/42). A separate lane's
[PR43](https://github.com/nymrel/nymrel-proof-ledger/pull/43) adds the experimental
checkpoint core; it does not provide a real-source adapter or pin-retention
service. The opt-in measurement in
[PR44](https://github.com/nymrel/nymrel-proof-ledger/pull/44) records all results
without turning performance percentages into a CI pass/fail gate.

[The fresh CI comparison](https://github.com/nymrel/nymrel-proof-ledger/actions/runs/40774966293)
met all 24 throughput and four 1 GiB memory targets across five paired runs on
Node24.22.1/Python3.13.17. It measured combined checkout
`65c8bd113c36cd8f813bfd0447010a771771eb16` against the original baseline with
unchanged source/harness hashes. This is acceptance for that recorded host and
runtime environment, not an all-host guarantee. Earlier workspace misses and
their unsuccessful tuning hypotheses remain in the benchmark record.

The operator selected different-provider agent trials for this continuation;
the additional provider CLI execution is assigned to a local agent. Cloud
OpenAI-only trials and installed-archive preflights do not complete that
cross-provider request or establish human adoption. A new hosted release-workflow
run, its provenance, authenticated registry setup and any publication remain
separate unobserved outcomes. The dated October25 snapshot below is historical.

## October 25 snapshot

**Engineering implementation and source integration complete; the full 90-day
outcome remains in progress.** [PR31](https://github.com/nymrel/nymrel-proof-ledger/pull/31)
and the PR30 portable handoff demo integrated on October 23 as
`10a9412eae1d49c02eb6a90e8510451d4d0532ed`. The
[integration receipt](https://github.com/nymrel/nymrel-proof-ledger/pull/31#issuecomment-6367931810)
records the reviewed tree and eight passing post-merge jobs. The
[current review disposition](PR31_REVIEW.md) resolves the earlier source-review
handoff without rewriting its historical findings.

Current remote main and the local checkout were both observed at
`3656374615fc32c4c8da87688a5c53416e9a86be`. Its ancestry includes PR31, the
workflow optimization and action updates in PR33/34, algorithm validation in
PR35, linear-time path normalization in PR36, and Signal scope correction in
PR18. Earlier statements below about pending integration describe their dated
sessions, not current main.

Still open: two independent human trials, universal throughput acceptance, and
the exact hosted release-candidate build/installation/provenance milestone.
Registry publication has no observed completion evidence in this closeout.
The [90-day goal](90_DAY_GOAL.md) keeps those acceptance boxes open.

## Historical execution record

The local implementation covers the five engineering workstreams in the
[90-day goal](90_DAY_GOAL.md). Independent human adoption, hosted release
execution, and registry publication remain separate outcomes.

## Implemented behavior

- Both CLIs require a signing key for attestation. They no longer generate or
  log fallback secrets. Key-file creation is exclusive and owner-only on POSIX;
  existing files and symlinks are refused. Explicit key export remains available.
- `verify --require-trusted-v2` accepts only valid, authenticated v2 receipts.
  Policy JSON and exits match across runtimes; default integrity-only behavior
  remains available. Requested disk checks participate in the gate.
- Node and Python hash file-backed artifacts in bounded, reusable chunks while
  preserving exact digests, receipt compatibility, filesystem confinement,
  and rejection before artifact reads when authentication fails.
- Separately installed npm, Python wheel, and Python source-distribution
  consumers demonstrate public-only bidirectional verification and tamper
  rejection. Packaged guidance is accessible. The
  [installed-consumer guide](INSTALLED_CONSUMERS.md) explains reproduction.
- CI runs installed-consumer acceptance. Release automation tests the exact
  built distribution archives before upload or publication and retains their
  acceptance report and checksums. Those workflow changes are source changes;
  no hosted run or registry publication is claimed here.

## Initial validation observed locally — October 18

| Check | Observed result |
| --- | --- |
| Official `npm run test:release` | Passed: 187 Node tests, 104 Python tests, plus the cross-runtime checks below. |
| Node supported-major checks | Node 22.23.3, 24.19.0, and 26.12.0: 187 tests each. |
| Python supported-version checks | Python 3.11.16, 3.12.14, 3.13.15, and 3.14.7: 104 tests each. |
| Actual cross-runtime checks | 47 shared authentication cases, 12 bidirectional authentication checks, 52 Signal cases, and 17 shared CLI policy cases passed. Native filesystem error details remain runtime-specific. |
| Installed distributions | Exact npm archive, wheel, and source archive installed outside the checkout; four bidirectional API integrations, 63 CLI policy checks, nine default integrity checks, and ten packaged local Markdown links passed. |
| Dependencies | npm audit reported zero vulnerabilities; pinned Python pip-audit reported no known vulnerabilities. |
| Static checks | Pinned CI Ruff correctness rules passed. Workflow audit passed offline; online provider checks remain for hosted CI. Documentation commands now use the same pinned Ruff rules as CI. |
| Independent agent review | Key safety, parser rejection, policy gates, streaming boundaries, installed consumers, and release archive flow reviewed. Reported parser issues were fixed and regression-tested. This is agent review, not an independent human adoption trial. |

The first successful existing-archive acceptance run took 11.33 seconds on this
host with its available caches: 1.44 seconds for installation, 0.63 seconds for
reference API runs, and 8.94 seconds for installed CLI checks. These are automated
measurements, not a human onboarding-time result.

## Performance evidence

Reproducible benchmark workers, the method, source-module hashes, and the median
summary are retained in the repository's
[benchmark directory](https://github.com/nymrel/nymrel-proof-ledger/tree/main/benchmarks).
The initial complete paired comparison reduced 1 GiB incremental peak RSS by
at least 99.7% and improved throughput by 65.7–85.4%. It also exposed two shorter
creation cases over the 10% throughput-regression threshold; those measurements
are retained rather than treating the universal throughput target as passed.
Follow-up profiling and its evidence are recorded in the benchmark results.
Quiet repeats reversed the Python short-file miss and produced mixed Node
results; instrumented hashing and I/O did not identify a consistent streaming
bottleneck. The shared host therefore has not established the universal
throughput target. No speculative I/O complexity was added to chase those
unstable millisecond-scale measurements.

## Evidence and remaining milestones

The base source revision is `232849c4e833da992cbcdcc6fa4b7bd0f56cbde3`.
The initial October 18 archives were local, uncommitted candidate builds.
The continued delivery candidate is identified by its PR head. Each installed-acceptance report
records dirty status and SHA-256 hashes of the exact source-file snapshot, plus
checksums of the tested archives. The base commit alone does not identify this
candidate. Reproduce with `npm run test:installed`; retain its output directory.

Detailed runtime, audit, and release-gate logs are in
`/workspace/scratch/proof-ledger-validation/`. Raw before/after benchmark runs
are in `/workspace/scratch/proof-ledger-bench/`. Installed-acceptance output
directories under `/workspace/proof-ledger-*-acceptance*` retain the artifacts,
checksums, and command-level JSON reports. Preserve these files when exporting
the workspace; temporary consumer environments are deliberately removed.

Still required before claiming the entire goal complete:

- Two independent human integration trials and measured onboarding results.
- Resolve any reproducible throughput regression against the stated target.
- Hosted CI/release checks, provenance, and any actual registry publication,
  using the existing release process and provider access.

No new recurring background execution or human outreach was created by this
work. No receipt or badge is presented as proof that real-world execution or
signer authorization was independently observed.


## Continued delivery — October 20, 2026

Current repository reads confirmed `main` still at the baseline revision and
verified repository write access. Existing keygen PR #21 was reused in an
isolated delivery candidate, preserving its exact commit and its additional
regressions. Its parser, key-file writer, and this goal's changes were reconciled
rather than overwriting the existing branch. Other pending CLI, QR, and example
candidates remain separate.

The existing review on [PR #21](https://github.com/nymrel/nymrel-proof-ledger/pull/21)
records `PASS_SOURCE / NEEDS_OTHER_TEAM`. The combined candidate retains that
external review requirement; current-session agent review does not clear it.
Hosted candidate CI and the next source-bound validation are recorded in the
delivery PR. Package publication remains separate.

The [independent human trial protocol](HUMAN_TRIAL.md) now supplies exact
installation/verification tasks, timing boundaries, recovery observations, and
blank results. No participants were contacted and no completed trial is claimed.


Delivery validation after keygen reconciliation passed the official release
gate (195 Node tests and 111 Python tests) and Python 3.11–3.14 (111 tests each), including the retained fresh-key
interoperability check: four generated keys, eight attestations, and sixteen
trusted cross-runtime verifications. Dependency audits, pinned correctness
lint over source/tests/benchmarks, and the offline workflow audit passed.

The October 20 warmed diagnostic used five paired batches per case, each
longer than 500 ms, and recorded no CPU quota throttling. All eight median
comparisons met the 10% throughput threshold, including the two previously
noisy creation cases. The original first-call observations remain recorded;
this diagnostic does not establish a universal cold-call guarantee. No new
production I/O branch was justified.

Successful candidate CI now retains the exact installed archives, checksums,
and consumer acceptance report as a downloadable artifact for 14 days. This
makes a source-bound human trial packet available through the existing GitHub
workflow without pretending that an automated run is a human trial.

## Handoff continuation — October 25, 2026

Repository readback at `3656374615fc32c4c8da87688a5c53416e9a86be` confirms
PR31's authenticated verification, safe keys, installed consumers, and streaming
hashing are integrated, together with the original PR21 and PR30 commits.
PR33/34's workflow improvements and PR35/36's source hardening are also present.
The earlier other-team hold is historical for the operator-directed integration;
the [review record](PR31_REVIEW.md) preserves its scope and dated evidence.

The next existing handoff is [PR24](https://github.com/nymrel/nymrel-proof-ledger/pull/24)
with its [stacked PR26](https://github.com/nymrel/nymrel-proof-ledger/pull/26)
recovery fix. This continuation reuses their published reconciliation candidate
`89ef3cfd62fee3cd05f854c5d8a223ec199e53e5`, preserves their original commits,
and composes the CLI/certificate changes with current main. The unified parser
retains strict keygen handling and the authenticated-v2 gate. New shared policy
cases cover missing receipts, malformed JSON, invalid UTF-8, and BOM rejection;
focused checks verify that failed loading skips key and artifact work even when
the policy is enabled. The original PR24 lane records final source, Astra review,
validation and integration; a prepared candidate alone does not close the handoff.

Human trials, the full performance target, an authorized hosted release run,
provenance, and actual npm/PyPI publication remain separate incomplete outcomes.
PR22's QR repair remains in its own pending lane.

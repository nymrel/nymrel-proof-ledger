# 90-day goal: make independent receipt verification practical

**Window:** October 18, 2026 – January 16, 2027 (90 days elapsed).

**Focus:** Nymrel Proof Ledger, TypeScript and Python.

**Status — October 28, 2026:** Engineering implementation and source integration
complete. The recorded fresh CI comparison meets all stated throughput and
large-file memory thresholds for its host/runtime environment; earlier workspace
misses remain retained. The directed different-provider agent trial and hosted
release/provenance evidence remain open. Human adoption is separately unobserved;
see the operator-selected continuation and progress record below.

**Tracking:** This file is the working goal. No background execution or daily
check-in is scheduled by creating it.

## Outcome

Make Proof Ledger a dependable component that another team can install,
integrate, and use to authenticate receipts without sharing a private signing
key. Prioritize preventing accidental secret exposure and incorrect trust
decisions, then remove adoption and performance barriers. Demonstrate the result
with independently repeated integrations and a verifiable release candidate.

A receipt authenticates the documented signed fields under a configured key;
it does not independently establish that an action occurred or that a signer
was authorized. Preserve that distinction in every example and integration.

## Starting evidence

Source inspected on October 18, 2026 at commit
`232849c4e833da992cbcdcc6fa4b7bd0f56cbde3`:

- [The README](../README.md) documents v2 receipts, offline Ed25519 verification,
  shared fixtures, and a working source-installation path. It describes registry
  packages as unpublished; registry state was not independently queried.
- [The Node CLI](https://github.com/nymrel/nymrel-proof-ledger/blob/232849c4e833da992cbcdcc6fa4b7bd0f56cbde3/src/cli.ts) and [Python CLI](https://github.com/nymrel/nymrel-proof-ledger/blob/232849c4e833da992cbcdcc6fa4b7bd0f56cbde3/python/nymrel_proof_ledger/cli.py)
  print automatically generated signing secrets during keyless attestation.
  Their key-file writers do not explicitly request restrictive permissions.
- CLI verification can exit successfully for integrity-only results. The
  [current verification contract](VERIFICATION_SECURITY.md) requires gate
  consumers to inspect `trusted` and the receipt version themselves.
- [Node artifact handling](https://github.com/nymrel/nymrel-proof-ledger/blob/232849c4e833da992cbcdcc6fa4b7bd0f56cbde3/src/core/receipt.ts) and
  [Python artifact handling](https://github.com/nymrel/nymrel-proof-ledger/blob/232849c4e833da992cbcdcc6fa4b7bd0f56cbde3/python/nymrel_proof_ledger/receipt.py) read whole
  artifact files into memory during creation and disk verification.
- [CI](https://github.com/nymrel/nymrel-proof-ledger/blob/232849c4e833da992cbcdcc6fa4b7bd0f56cbde3/.github/workflows/ci.yml) and
  [release automation](https://github.com/nymrel/nymrel-proof-ledger/blob/232849c4e833da992cbcdcc6fa4b7bd0f56cbde3/.github/workflows/release.yml) already define runtime,
  audit, packaging, and cross-runtime checks. Reuse these gates.

At goal setup, this was source inspection without fresh test, benchmark,
publishing, or adoption evidence. Execution results are recorded below and in
the [execution report](EXECUTION_REPORT.md). The criteria below remain targets;
they are not automatically achieved by implementing a feature.

## Success criteria and priorities

| Priority | Improvement | Acceptance evidence |
| --- | --- | --- |
| 1 | Safe CLI key handling | Ordinary attestation never logs private keys or HMAC secrets. Missing-key behavior is explicit and documented. Key-file output uses exclusive creation, restrictive POSIX permissions, and safe handling of existing paths and symlinks; Windows limitations are documented. Explicit key-export behavior is distinct from routine logs. Matched Node/Python regressions cover these cases. |
| 2 | Reliable automation gates | Add an opt-in CLI policy requiring authenticated v2 verification, with identical documented JSON and exit behavior in both runtimes. Accept a valid v2 receipt under independently configured public key and algorithm; reject integrity-only, legacy v1, wrong-key, wrong-algorithm, tampered, and missing-artifact cases when disk checks are requested. Preserve existing default verification semantics. |
| 3 | Independent adoption | Provide two executable reference consumers, one Node and one Python, installed from built distributions outside this checkout. Each verifies the other runtime's receipt and rejects tampering using a public-only verifier configuration. Ensure guides linked from packaged documentation remain accessible after installation. Target two independent integration trials reaching a trusted result within 15 minutes after documented runtime prerequisites are ready; record installation time separately, failures, and actual elapsed time. Automated clean-environment checks demonstrate readiness until human trials occur. |
| 4 | Large-artifact efficiency | Stream file hashing in creation and verification in both runtimes while preserving exact receipt digests, containment, and fail-closed behavior. Record repeatable before/after time and peak resident memory for 1 MiB, 100 MiB, and 1 GiB artifacts and for manifests of 1, 100, and 1,000 small files. Target at least 75% lower peak-memory growth above the idle runtime for the 1 GiB case, without material throughput regression; define material as over 10% lower median throughput on the same host across five runs with recorded cache conditions. Measurements determine acceptance; shared CI has no timing-based pass/fail threshold. |
| 5 | Verifiable release readiness | Produce matching-version npm and Python distributions, install and smoke-test those exact archives in clean consumer environments, retain checksums and exact source revision, and pass the configured runtime matrix and security checks. Record security review findings and their disposition, and document migration and key-handling guidance. Registry publication and real adoption require their own observed evidence. |

The [independent trial protocol](HUMAN_TRIAL.md) provides the two-person
procedure and blank results templates; no human trial has been recorded.

**Directed continuation — October 28, 2026:** The operator selected independent
agents on different providers for this continuation, with the additional provider
CLI work assigned to a local agent. Use the [provider-agent protocol](AGENT_TRIAL.md)
and record actual provider/runtime identity, timings, failures, and recovery.
This replaces recruiting people for the current directed work. Agent results
remain agent integration evidence; they do not establish the original human
adoption target above or convert its unobserved results into completed trials.

## Milestones

### Day 30 checkpoint — November 17, 2026

- [x] Fix CLI secret logging and key-file creation in both runtimes.
- [x] Add and document the explicit authenticated-v2 gate without changing the
  default integrity-only contract.
- [x] Add shared positive and negative gate cases and run actual cross-runtime
  verification through the existing release checks.
- [x] Capture initial integration-time and performance measurements, including
  commands, runtime versions, host characteristics, and raw results.

### Day 60 checkpoint — December 17, 2026

- [x] Implement and verify the separately installed Node and Python reference consumers with
  executable success and rejection paths.
- [x] Complete streaming hashing with matched regression tests for digests,
  filesystem boundaries, empty files, and I/O failures.
- [x] Compare performance against the recorded baseline: all 24 throughput and
  four 1 GiB memory targets passed in the recorded fresh CI environment. This
  does not erase earlier workspace misses or guarantee every host/runtime.
- [ ] Run the first independent integration trial; use its observed difficulties
  to improve the CLI and guides.

### Day 90 checkpoint — January 16, 2027

- [ ] Complete the second independent integration trial and report measured
  onboarding results against the 15-minute target.
- [x] Resolve review findings affecting secret handling, trust decisions,
  interoperability, or artifact boundaries.
- [ ] Build, install, and verify the exact release-candidate distributions using
  the existing release workflow and its required controls.
- [ ] Record final metrics, supporting receipts/logs, compatibility decisions,
  remaining limitations, and any publication or adoption evidence.

## How to work the goal

At each active work session, re-read this file and the current repository state,
then finish the highest-priority unblocked increment through its focused checks.
Keep each change reviewable. Use the existing issue or PR for that increment
when one exists, and retain exact revision and validation evidence.

Review progress weekly during active sessions: completed acceptance criteria,
measured user benefit, unresolved blockers, and the next concrete increment.
Reorder work when a security finding or an observed integration failure has
greater impact. Work on one implementation milestone at a time; calendar
checkpoints do not convert unfinished items into completed work.

Use [CONTRIBUTING.md](../CONTRIBUTING.md) for required validation. Protocol or
cryptographic changes need matched runtime behavior and shared vectors. Preserve
frozen v1 verification, v2 wire compatibility, independently configured trust
material, filesystem confinement, and the zero-production-dependency Node
runtime. Keep production key custody and identity authorization with the owning
operator rather than implying this library provides them.

If independent testers or publication access are unavailable, continue with
clean-environment acceptance and release preparation, but leave those external
criteria open. A local passing test is not publication or real usage.

## First implementation increment — complete

Both CLIs now reject missing signing keys, avoid automatically generated secrets
in attestation logs, and create private key files without overwriting existing
paths. Focused tests cover absent keys, explicit key export, existing files,
symlinks, permissions, and parser mistakes. The cross-runtime release gate passed,
and the quickstart documents the behavior and migration.

## Progress record

| Date | Completed | Evidence / next action |
| --- | --- | --- |
| October 18, 2026 | Set the scoped goal and prioritized its milestones after source inspection. | Baseline revision above. Implementation, fresh release tests, benchmarks, and independent trials remain pending. Start with safe CLI key handling. |
| October 18, 2026 | Implemented safe CLI keys, the authenticated-v2 gate, installed reference consumers, and bounded artifact hashing. | Release tests and supported-runtime suites passed. Exact built archives passed clean-consumer checks. See the execution report for measured performance, review results, and remaining external milestones. |
| October 20, 2026 | Reconciled the existing keygen candidate, completed warmed performance diagnostics, and prepared the two-person trial protocol. | All eight warmed medians met the threshold; cold-call limitations remain explicit. The delivery candidate preserves the required other-team review gate and records hosted checks in its PR. |
| October 25, 2026 | Reconciled the completed source handoffs and plans with current main. | PR31/30 integrated as `10a9412eae1d49c02eb6a90e8510451d4d0532ed`; the [integration receipt](https://github.com/nymrel/nymrel-proof-ledger/pull/31#issuecomment-6367931810) records Codex/Astra review and eight passing post-merge jobs. Inspected main is `3656374615fc32c4c8da87688a5c53416e9a86be`. Earlier other-team review holds are historical for that integration. The human, throughput, and hosted-release criteria above remain open. |
| October 28, 2026 | Integrated adoption/release preparation through [PR41](https://github.com/nymrel/nymrel-proof-ledger/pull/41), reusing the merged QR repair and dependency updates. | Merge `4ef0c1a738ed4c968f8076a6f441ba6c1725d6dd` follows exact-source review and eight passing hosted jobs. The [trial protocol](HUMAN_TRIAL.md) describes public-only packets; the [release-candidate procedure](RELEASE_CANDIDATE.md) preserves archive and publication controls. No human trials or registry publication are claimed. |
| October 28, 2026 | Continued provider-agent trials, first-call performance attribution, and reference-consumer recovery improvements. | Two independently started OpenAI agent trials passed against accepted source `d73f440d436facd8599b9e4148c883cd0b8102f3`; a different-provider trial is assigned to a local agent and remains unverified. The new hashing candidate removed a redundant Python EOF read without an observed material regression against old streaming. Final comparison against the original baseline passed 22/24 fresh throughput cases, 8/8 warmed cases, and all four 1 GiB memory targets; retained Python fresh-call misses keep the full target open. See [all performance results](https://github.com/nymrel/nymrel-proof-ledger/blob/main/benchmarks/RESULTS.md). New consumer diagnostics give matching artifact recovery guidance while preserving verification failures. |
| October 28, 2026 | Met the stated performance thresholds in one fresh, opt-in CI job. | [Run40774966293](https://github.com/nymrel/nymrel-proof-ledger/actions/runs/40774966293) compared baseline `232849c4e833da992cbcdcc6fa4b7bd0f56cbde3` with exact combined checkout `65c8bd113c36cd8f813bfd0447010a771771eb16`, preserving PR43's checkpoint core. On the same Node24.22.1/Python3.13.17 job VM, all 24 five-pair throughput comparisons and all four 1 GiB memory targets passed. Source/harness hashes stayed unchanged. This later bounded result updates acceptance for the recorded CI environment; it does not explain away or replace the earlier workspace misses. Raw evidence is retained for 90 days. |

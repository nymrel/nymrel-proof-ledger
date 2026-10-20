# PR #31 source and release-assurance review — October 20, 2026

Reviewed candidate: `3bf1349c2026db773f41840ea3e7c005d69d6402`, against
main `232849c4e833da992cbcdcc6fa4b7bd0f56cbde3`. This is a new current-session
Codex investigation and execution, not the required other-team security approval.
The correction's final source identity and hosted checks belong in PR #31.

## Blocking finding and correction

The newly added Python installed reference consumer and acceptance harness used
`assert` for their verdicts. Python optimization removes these statements.
On the reviewed head, an actual `python -O` reference-consumer run with an invalid
receipt and wrong Ed25519 configuration exited zero, emitted all four check
labels, and reported `status: PASS`. Separately, an optimized harness accepted
a broken README link and absent required package members. This was false
acceptance evidence; it did not make the core verifier authenticate the receipt.

The correction replaces all 47 removable assertions in these two files with
explicit conditional failures. It adds optimized positive/negative execution of
the actual wheel and source-distribution consumers. Four regression tests cover:

- real valid and tampered receipts under both `-O` and `-OO`;
- a simulated verifier regression that authenticates a wrong key;
- a failed subprocess producing a retained `FAIL` report and nonzero exit;
- a broken packaged documentation link under optimization.

No CLI, signing payload, cryptographic primitive, core receipt field, dependency,
or release permission changes are part of this correction.

## Authentication and hashing assessment

Both verifiers bind an independently configured key and expected algorithm;
the receipt cannot choose the key's interpretation. Missing/incomplete contexts,
algorithm mismatch, invalid envelopes, recomputed Merkle failures, and invalid
signatures do not produce authenticated success in the exercised cases.
Failed cryptographic verification skips artifact resolution/reads. Missing or
changed requested disk artifacts make both `valid` and `trusted` false.
Missing CLI signing keys fail rather than generating/logging fallback secrets.

The opt-in CLI policy requires `valid`, `trusted`, and version `2.0.0` together.
Its JSON policy verdict stays separate from the core verdict: authenticated
legacy receipts can retain `valid: true` and `trusted: true` while failing this
policy and exiting one. Default integrity-only success remains untrusted.
File checking still requires `--check-files`. These are cryptographic guarantees,
not proof of task execution, authorization, key provenance, or every unknown
extension field. No additional core authentication bypass was found in this
bounded source review and test execution; this is not a universal security claim.

Incremental hashing updates SHA-256 with exactly the bytes read, reuses one
bounded buffer per operation (Node 1 MiB; Python 64 KiB), and closes handles on
read failures. Its existing regressions passed for binary/empty/Unicode inputs,
partial tails, interrupted reads, invalid signatures before I/O, and confined
paths. In-memory inputs retain their behavior. The source does not supply an
atomic filesystem snapshot against concurrent writers; use a stable trusted
verification directory. General input-size, special-file, and timeout policy
remain caller responsibilities, rather than new guarantees from streaming.

## Checks executed in this investigation

- Original head: `npm run test:release` passed 195 TypeScript and 111 Python
  tests, plus 47 shared authentication cases, 12 bidirectional checks, 52 Signal
  cases, 17 CLI policy cases, four generated keys/eight attestations/sixteen
  trusted cross-runtime checks. Original installed-package acceptance passed.
- Corrected code: the release gate passed 195 TypeScript and 115 Python tests
  on Node 24.19.0 / Python 3.13.16, with those cross-runtime checks retained.
- Corrected installed acceptance passed with `PYTHONOPTIMIZE=1` on Python
  3.12.14: npm archive, wheel and source archive installed outside the checkout;
  public-only API verification, 63 CLI gate checks, nine default integrity
  checks, optimized Python positive/negative cases, and packaged links passed.
- Pinned Ruff correctness checks and whitespace validation passed.

Five alternating baseline/candidate runs independently repeated the 1 GiB
warm-cache benchmark on Linux using the repository harness. Baseline is main
above; receipt modules match PR #31. All raw measurements and module hashes are
in [the review benchmark](https://github.com/nymrel/nymrel-proof-ledger/blob/codex/proof-ledger-goal-20261020/benchmarks/results/review-2026-10-20.json).

| Operation | Baseline / candidate MiB/s | Baseline / candidate incremental peak RSS MiB |
| --- | ---: | ---: |
| Node create | 818.1 / 1086.2 | 1025.1 / 3.0 |
| Node disk verification | 865.1 / 1083.2 | 1024.7 / 2.8 |
| Python create | 994.5 / 1400.9 | 1024.0 / 0.3 |
| Python disk verification | 1004.6 / 1424.7 | 1024.3 / 0.5 |

This reproduces at least 99.7% lower incremental peak RSS for these large-file
cases. It does not repeat the complete small-file/manifest performance study or
establish universal cold-cache throughput. RSS is a process high-water measure.

## Overlap reconciliation

Original contributor branches and attribution are preserved. Actual ancestry,
diffs, existing reconciliation notes, and disposable `git merge-tree` checks
establish these integration boundaries:

| Candidate | Exact head | Disposition |
| --- | --- | --- |
| #21 key safety | `62a5b3e4b1c169791d474566a347c9cc9f2af46b` | Already an ancestor of #31; do not duplicate/cherry-pick or close until integration is real. Its other-team hold still applies. |
| #22 QR/package docs | `d4e2ee9772fa4338183ce90c92e6812835eb0c57` | Real merge conflict in `package.json`; preserve both packaging files/scripts and the QR implementation. Other shared paths auto-merge, which still requires semantic review and combined tests. |
| #24 usability and #26 recovery | `6b574337a589cb585d0b391b8d452237236ce766` / `f8fd3e517c6b15218521a25705eb0889a7aa7277` | Reuse their existing main-reconciled candidate `89ef3cfd62fee3cd05f854c5d8a223ec199e53e5`. It conflicts with #31 in README and both CLI sources. Preserve parser/receipt selection, structured load errors, explicit keys, and the new separate policy verdict together; rerun the final combined tree. Do not apply #26 independently of #24. |
| #30 cross-runtime demo | `6c2b9878f0503aea4ac3e682aaf45ce1b398364f` | Tree merge succeeds; shared `docs/QUICKSTART.md` auto-merges. The original demo stays separate; clean textual composition is not combined release validation. |

No pending lane was silently merged, overwritten, closed, or represented as
already included. The correction deliberately avoids their CLI/QR hunks.

## Remaining release requirements

An independent Claude-team reviewer who did not participate in this work must
review the final source/base and record approval or concrete findings in the
existing review lane. The [existing #21 review](https://github.com/nymrel/nymrel-proof-ledger/pull/21#pullrequestreview-5483145345)
and [studio topology](https://github.com/JalenBuildsHub/portfolio-control/blob/main/STUDIO_TOPOLOGY.md)
retain this requirement. Local tests, same-team review, and this report cannot
supply it. The available Studio Knowledge read failed with a connection error;
this session has no supported Claude-team inbox write or execution tool. A GitHub
review request records the handoff, not native receipt or acceptance.

Refresh exact-head/base hosted checks after the correction; the original
successful eight-job CI is historical evidence for the earlier head. Runtime
matrix/security CI, the configured release-workflow build of exact distributions,
provenance, publication, and independent human adoption are distinct evidence.
No merge, tag, publication, actual human trial, or release-workflow execution is
claimed by this investigation.

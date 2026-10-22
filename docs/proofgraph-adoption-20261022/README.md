# Portable artifact adoption evaluation — October 22, 2026

**Disposition: locally validated synthetic adoption example.** The existing
PR30 signer and PR31 verifier authenticated a separately retained artifact after
the signer process exited and its directory was deleted. Ten acceptance cases
passed in a fresh Python verifier process with optimization enabled. This is
evaluation evidence, with no production implementation or protocol change.

## Exact reusable source

| Source | Revision |
| --- | --- |
| [PR30](https://github.com/nymrel/nymrel-proof-ledger/pull/30), existing Node signer and cross-runtime demo | `6c2b9878f0503aea4ac3e682aaf45ce1b398364f` |
| [PR31](https://github.com/nymrel/nymrel-proof-ledger/pull/31), existing Python verifier | `59a2c48a01e910ce2420160dae5a335513f5dc8e` |
| Both PR APIs' reported base | `232849c4e833da992cbcdcc6fa4b7bd0f56cbde3` |
| Actual remote main, freshly observed with `git ls-remote` | `92c8788b659d0a893aea6bb41033e882620a4675` |

The current main differs from the base reported in the PR metadata. A local
`git merge-tree --write-tree` check found PR30 composes cleanly with current main
(tree `787c3039168ec91abfacbab414e807bb5eb64df0`); PR31 conflicts in
`CONTRIBUTING.md`. That conflict was then resolved in an isolated composition,
retaining main's pinned audit tool and `tools` checks plus PR31's installed
consumer command. The composition preserves original commit ancestry:
`eaebdd48ce431ec9cafda27cc88d4374b86980e7`, tree
`d1f6eea6d80dcedc015c0da95b7290716492bdc6`. Both workflows and `package.json`
auto-merged; inspection confirmed main's checksum/preflight and build reuse
remain alongside PR31's installed acceptance. Historical CI does not establish
acceptance of this new composition; its local results are listed below.

No AGENTS.md exists in the checked source trees or workspace ancestors. The
repository CONTRIBUTING.md and verification/security instructions were read.
CI runs for PRs targeting main and pushes to main; release publishing is gated
on version-tag refs. No workflows, tags, publication, merge, or deployment were
invoked. The local original main checkout remained clean and untouched.

## Reproduce

Use separate clean source checkouts at the exact revisions above. Build PR30
with `npm ci --ignore-scripts && npm run build`. Use Python 3.11–3.14 with the
repository runtime dependencies. This run used Node 24.19.0, Python 3.13.5,
cryptography 50.0.2 and rfc8785 0.1.4. npm was 11.9.0. Existing local development
dependencies were copied into isolated checkouts, and TypeScript was rebuilt.

```sh
python run_adoption.py --pr30-source /path/to/pr30 --pr31-source /path/to/pr31 /new/output/directory
```

To recheck the retained bytes, without signing again:

```sh
python -O run_adoption.py --pr30-source /path/to/pr30 --pr31-source /path/to/pr31 --worker retained
```

The script refuses source head drift and tracked source modifications, generates
new output only in a nonexistent directory, and uses existing PR30 signing and
PR31 verification APIs. It does not add crypto. Runtime/source hashes and complete
verdicts are in [evaluation.json](retained/evaluation.json). `SHA256SUMS` covers
the publishable packet; these hashes identify bytes, not source authenticity.

## Observed cases

| Case | Cryptographic result | Application result |
| --- | --- | --- |
| Original retained artifact, configured public key and expected algorithm | Valid and trusted; one artifact checked | Accepted |
| No key | Valid integrity only, untrusted | Rejected |
| Untrusted public key | Invalid and untrusted | Rejected |
| Wrong or missing expected algorithm | Invalid and untrusted | Rejected |
| Signed purpose modified | Signature invalid | Rejected |
| Original authentic receipt supplied for different task or purpose | Still valid and trusted | Rejected by separate caller policy |
| Artifact bytes modified | Signature valid; artifact invalid | Rejected |
| Original artifact restored | Valid and trusted | Accepted |

The signer is the unchanged PR30 demo worker. Its task name and purpose remain
`Node artifact handoff` and `cross-runtime-demo`; the artifact is newly generated
synthetic task data. Trusted public configuration and expected task/purpose live
outside the recipient artifact directory and are not selected from the receipt.
This simulates provisioning; it does not authenticate an external key-distribution
channel. No private key is saved, printed, transferred, or included in this packet.

The task/purpose guard is a small consumer policy example. It provides neither
freshness nor a replay ledger. Signatures authenticate documented signer assertions
under the configured key. They do not independently prove task execution,
real-world identity, capability, delegation, or authority. Separate processes in
one local environment are not independent organizations or independent review.

## Checks actually repeated

- Exact PR30 existing demo: all eight expectations passed normally and under `-O`.
- This cross-candidate retained-artifact evaluation: ten cases passed under `-O`.
- Exact PR31: typecheck/build, 195 TypeScript and 115 Python tests passed.
- PR31 actual cross-runtime harness: 47 shared auth cases, 12 bidirectional auth
  checks, 52 Signal cases, 17 CLI policy cases, four fresh keys/eight attestations/
  sixteen trusted verifications passed.
- Existing PR31 optimized acceptance regression tests ran within the Python suite.
  Full installed npm/wheel/sdist acceptance was not rerun in this evaluation.
- Node worker syntax and tracked-source whitespace checks passed.

The final composed tree was then tested separately:

- `npm run test:release`: 195 TypeScript and 125 Python tests, plus all cross-runtime
  cases listed above, passed. The ten additional Python tests cover main's release
  workflow safeguards.
- `PYTHONOPTIMIZE=1 npm run test:installed`: actual npm/wheel/sdist consumers passed
  from a clean recorded source snapshot, with 63 CLI policy cases, nine default
  integrity cases, optimized positive/tampered cases and 21 packaged links. This
  run used Node 24.19.0 and Python 3.12.14; it took 20.1242 seconds.
- Composed PR30 demo passed all eight expectations under `-O`.
- Pinned Ruff correctness and pip-audit checks, npm audit (zero vulnerabilities),
  npm package dry run, branch release preflight and whitespace checks passed.

The [installed acceptance summary](composed-installed-summary.json) retains
source identity, archive hashes, case results, step exit codes, and the full local
report hash. Local archives and the verbose report remain outside the publication
packet. [Changed paths against main](composed-paths-vs-main.txt) and
[against PR31](composed-paths-vs-pr31.txt) show the integration scope. No production
code was rewritten; the only manual merge edit reconciled contributing commands.

Logs include the [PR31 cross-runtime run](logs/pr31-cross.log). Current hosted workflow retrieval returned
[CI39388351152](https://github.com/nymrel/nymrel-proof-ledger/actions/runs/39388351152)
as completed/success for the PR31 head; combined commit status contained no status
entries. That historical CI used the earlier base. A successful current-base
required-check set was not established.

## Original owner lane and next action

Keep PR30 and PR31 as the implementation lanes; do not create another feature
implementation. Review the composed candidate against current main and run
required hosted checks on its final published revision. The existing uninvolved
Claude-team source-bound review requirement remains outstanding; the retrieved
PR31 reviews contain one COMMENTED review and no approval. This local same-team
evaluation cannot satisfy it. PR30 remains draft with no retrieved reviews.
Independent human adoption and mobile/provider host acceptance remain untested.

# Experimental source delivery evidence

Reconciled base: `11e1ca7410318567099fa586326268e086dc3d21` on remote `main`.
The existing repository is public, owned by Nymrel and licensed MIT with
Nymrel / JalenBuilds LLC attribution. No open PR overlapped this source delivery.
The existing external-checkpoint issue remains a separate lane; this change adds
no checkpoint service, key lifecycle, stable API or protocol behavior.

Fourteen runtime/test TypeScript and tsconfig files match the previously reviewed
in-memory revision 3 and durable revision 1 bytes exactly. The durable store and
its regression test add a correction for reader-blocked commits found by hosted
Node 26 CI. The delivery also changes
portable documentation, adds this source manifest and runs the existing prototype
tests in CI's Node 24/26 jobs. All existing CI jobs, permissions, matrices and
release controls remain present. The stable library and package declarations have
no changes. Original checkpoint archives remain separately retained.

## Local checks

Local environment: Node 24.19.0, SQLite 3.53.3, npm 11.9.0, TypeScript 7.0.2 and
Python 3.13. Cached/offline dependency setup was used for the build and test gates.
Temporary offline cryptographic fixtures in the existing repository tests do not
create account access or sign financial transactions; their output is captured
and hex material is redacted before retaining diagnostic logs.

| Exact command from repository root | Observed result |
| --- | --- |
| `npm ci --ignore-scripts --offline --no-audit --no-fund` | Passed using cached locked dependencies. |
| `npm run test:release` | Passed: 266 TypeScript tests, 208 Python tests and configured cross-runtime authentication/Signal/keygen/CLI checks. |
| `node_modules/.bin/tsc -p prototypes/agent-work/tsconfig.json` | Passed. |
| `node_modules/.bin/tsc -p prototypes/agent-work-durable/tsconfig.json` | Passed. |
| `node --test --test-reporter=tap dist/agent-work/prototypes/agent-work/engine.test.js dist/agent-work-durable/prototypes/agent-work-durable/store.test.js` | Passed: 49 tests, zero failures or skips, after the commit-busy/rollback correction. |
| `node dist/agent-work/prototypes/agent-work/demo.js` | Passed; reference arithmetic yields 350 available fictional units. |
| `node dist/agent-work-durable/prototypes/agent-work-durable/demo.js` | Passed; restart retains 90 unknown units, 710 available and zero settled spend. |
| `npm run test:installed -- --output <new-directory-outside-checkout>` | Passed: 115 retained steps, 63 installed CLI gate checks and eight reference recovery checks. |
| `npm pack --dry-run --ignore-scripts --json` | Passed; no prototype source or compiled prototype directories included. |
| `npm audit --audit-level=high --json` | Passed; no reported vulnerabilities at this check. |
| `uvx --offline ruff@0.16.5 check --select E4,E7,E9,F python test tools` | Passed. |
| `uvx pip-audit@2.10.1 .` | Passed; no known vulnerabilities reported at this check. |

The installed npm archive, Python wheel and source archive were all inspected and
contain no `prototypes/` or compiled prototype path. These are local archive
checks, not registry publication. The local static/audit tools initially failed
to write their default tool/cache directories; retries with task-local writable
directories passed. Those failures and retries remain in the retained evidence.

The exact tested source revision and current hosted results belong to the PR's
head/check records. The source manifest binds the proposed file bytes independently
of a changing branch name. Local results do not stand in for hosted matrices,
formal approval, another GitHub identity, registry release or real customer use.

## Technical review and publication hygiene

Initial published head `b36f98e9b754f15893bc64043e36d376da358c93` passed local
checks, but its hosted Node 26 job failed the competing-process test with the
wrapper's generic uncertain-commit error. A deterministic held-reader regression
reproduces that symptom locally through `SQLITE_BUSY`; the hosted log did not
retain the underlying SQLite error code. The correction retries only the active commit, with a bounded
wait; it does not reapply the business operation. Other commit errors still require
reopen/reconciliation. Fresh technical review additionally found that a failed
rollback after timeout must quarantine the handle rather than report a safe retry.
That failure is now explicit and requires reopening; its fault-injection test
does not claim a naturally observed filesystem I/O failure. The failing hosted run and before-fix regression are retained
as failure evidence, not replaced by the later result. The hosted retest is
required to establish the corrected candidate's Node 26 result.

The earlier fresh-context technical reviews requested as Terra6.1 identified and
verified fixes for checker execution, invoice deadlines and oversized-work
eligibility. The final in-memory review reported no remaining finding in its
changed/affected paths. A separate fresh-context review independently rebuilt the
durable wrapper and passed all 16 storage tests, reporting no actionable defect
within the offline trusted-filesystem scope. Unchanged bytes reuse that evidence;
the commit-busy change receives fresh technical review. Delivery documentation and
the new CI step also received a separate source-delivery review. Exact-head review
and hosted results are recorded in the PR rather than predeclared here.

Requested model labels do not establish the actual served model; served identity
is unknown from available metadata. These are finite technical reviews, not
formal GitHub approval or proof of actor authority, custody or actual settlement.

The entire proposed source was checked for private keys, provider/GitHub tokens,
wallet addresses, internal conversation/thread identifiers, private prompts,
real account/customer data and misleading banking/authentication claims. No such
sensitive content was found. Only synthetic saved-page/credit fixtures and source
with compatible MIT provenance are included. Private scratch evidence, raw test
keys, account information and conversation transcripts are excluded.

## Remaining gates and limits

Hosted checks and repository-protection/ownership requirements must be satisfied
before integration. Branch protection remains enabled; its complete settings are
not readable by the current GitHub integration. No formal approval is submitted
by this work, and another model on the author's account does not count as another
GitHub reviewer. Source delivery does not change repository visibility or access.

The examples trust local composition and filesystem ownership. They provide no
genuine customer authentication, independent checkpoint custody, hostile-filesystem
guarantee, physical-power-loss proof, payment provider or real settlement. No
public endpoint is provided. Real activation still requires the authorization,
outbox/reconciliation, sandbox, checkpoint, merchant/currency/custody and legal
gates in the [prototype guide](README.md).

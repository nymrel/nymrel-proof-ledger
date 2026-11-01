# Experimental offline agent work ledger

These source-only prototypes demonstrate how an explicitly identified software
agent can perform scoped work, deliver an artifact, obtain separate fictional
customer acceptance, and account for fictional earnings and obligations. The
durable variant adds local SQLite storage and restart recovery.

**All identities, customer work, credits, receipts and time are synthetic.**
There is no financial account, wallet, payment connection, customer contract,
public server or production authentication. This is a validation stage toward a
possible real-payment product, not evidence of a bank, legal person, real revenue,
deposit insurance, market novelty or business viability. Agent wallets and machine
payments already have implementations; this experiment concerns accepted-work
accounting and recovery.

## Reproduce offline

Use Node 24–26, npm 11 and the checkout's locked development dependencies. Node
24 is the locally tested runtime. The durable example uses built-in `node:sqlite`;
it adds no package dependency or external database service. The library's existing
Node 22 compatibility remains unchanged. From the repository root:

```sh
npm ci --ignore-scripts
node_modules/.bin/tsc -p prototypes/agent-work/tsconfig.json
node_modules/.bin/tsc -p prototypes/agent-work-durable/tsconfig.json
node --test dist/agent-work/prototypes/agent-work/engine.test.js dist/agent-work-durable/prototypes/agent-work-durable/store.test.js
node dist/agent-work/prototypes/agent-work/demo.js
node dist/agent-work-durable/prototypes/agent-work-durable/demo.js
```

Dependency setup may use npm's cache or registry; after setup, the prototypes,
tests and demos require no network, model provider or credentials. To require
cached setup explicitly, add `--offline` to `npm ci`.

The in-memory demo prints the work-to-refund lifecycle and a reference fixture:
`1000 opening - 200 reserve - 150 outstanding commitments - 300 settled spend = 350`
available FAKE_CREDIT units. Its independent work/refund scenario ends at 1,200
available units. Pending and unknown earnings are excluded from spendable funds.

The durable demo creates a private temporary directory and prints its SQLite path.
It closes and reopens the ledger, retaining 90 units for an unknown outcome,
710 available units and zero settled spend. An exact assignment retry recovers
the original result without reserving twice. The demo retains its fictional
temporary database for inspection; tests remove their own temporary directories.
Both demos accept `--json`. Replay the in-memory JSON directly:

```sh
node dist/agent-work/prototypes/agent-work/demo.js --json | node dist/agent-work/prototypes/agent-work/replay-cli.js
```

Unpinned replay establishes deterministic integrity only. A coherent replacement
or rollback cannot be detected without an independently retained checkpoint.

## Work and accounting boundaries

The work adapter compares at most ten saved fictional page records with a supplied
manifest: status, title, canonical string and required links. It does not crawl,
execute page text, edit sites or certify security/SEO/live-site status. Discovery
checks the combined output limit before reserving credits. Assignment inputs,
criteria revision, deadline, denomination, price and cost ceiling are frozen and
hashed. The engine generates the packet internally and accepts delivery only of
those exact bytes.

The lifecycle separates discovery, scoped assignment, authorization, execution,
delivery, acceptance/rejection, invoicing, partial payment and settlement.
Cancellation, expiry, revocation, disputes and refunds have distinct paths.
New invoices must precede the assignment deadline; observations of already issued
invoices remain reconcilable afterward.

A configured distinct fictional customer must accept the exact artifact digest,
scope digest and criteria revision. Worker commands cannot manufacture customer
acceptance, change policy, select another actor, or create observed settlement.
Job descriptions and reasons remain inert data. The optional JSONL worker entry
point exposes only the in-memory worker port and never accepts a role selector.

All amounts are bounded safe integers in one immutable denomination,
`FAKE_CREDIT`, with minor-unit exponent zero. Opening seed funding is separate
from earnings. Available units are:

```
opening + settled earnings - settled spend - settled refunds
- reserve - outstanding commitments - refund obligations - dispute reserves
```

Accepting work reserves its cost ceiling against availability and the discretionary
budget. Concurrent attempts cannot reuse a reservation. Unknown/requested/pending
outcomes retain their holds; closure releases unused capacity only. Duplicate
receipts have no accounting effect, conflicting IDs fail, and observations require
contiguous sequence numbers. Partial settlement cannot exceed the invoice amount.
Dispute reserves do not double-count refund obligations. One refund obligation
per invoice is supported in this experiment.

Fixture model labels are requested labels only; observed served identity remains
unknown. Unobserved real provider cost remains null rather than zero. No model
provider is called by these examples.

## Durable storage and authority

`AtomicAuditStore` is a trusted application-code adapter, not an adversarial plugin
interface. `DurableLedger` exposes separate frozen worker, customer, operator and
fake-observation ports. Issuing those capabilities is the trusted composition
root's responsibility. Copying a port and changing its displayed role does not
change the role captured by its submit function. Command JSON cannot select a
tenant or grant itself a role. Every database binds the full immutable synthetic
tenant, merchant, simulation ID and configuration.

SQLite uses `BEGIN IMMEDIATE`, rollback journals and `synchronous=FULL`. Each
transaction loads the latest audit, verifies its binding, restores the unchanged
reducer, applies a command and commits the whole bounded snapshot before returning.
Same-process calls share a queue; independent processes coordinate through SQLite.
Storage version advances for changed audit records; reads and exact retries retain
the checkpoint. A lost acknowledgement is recovered by retrying the same request
ID, not inventing another intent. Commit uncertainty requires closing/reopening
and reconciling durable state. Unknown payment outcomes remain held on restart.

Creation is exclusive in an already existing private local directory. Empty,
partial, corrupt, linked or replaced files are refused rather than silently
reseeded. POSIX file creation requests mode 0600; existing permissions are checked,
not changed. Extension loading is disabled. Opening can compare an exact externally
retained storage-version/head checkpoint.

**Trusted local filesystem only:** these capabilities are not genuine customer
authentication. An operator controlling composition or stored evidence can forge
fictional history. Same-file hashes do not prove action truth, authority or actual
settlement, and cannot detect a coherent rollback without independent retained
state. Hostile local users, dishonest storage, physical power loss, unsupported
network filesystems and Windows ACL behavior are not established by the tests.
Do not replace a live database or expose these ports as a public service.

## Scope, packaging and activation

The stable library, receipt protocols and public APIs are unchanged. Prototypes
and their compiled subdirectories are excluded from npm, wheel and source
distributions. CI adds prototype checks on Node 24/26 while preserving all existing
jobs and permissions. Limits include 128 catalog entries/scopes, ten saved pages,
8 KiB packet output, 32 KiB admitted command JSON, 2,048 audit records and a
16 MiB durable audit snapshot.

Before adding a public endpoint, establish genuine operator/customer/worker
authentication and authorization. Before external work/payment adapters, establish
independent customer acceptance, authenticated provider observations, durable
outbox/reconciliation and independently retained checkpoints/recovery operations.
External effects must not run during reducer replay. Any real-money integration
still requires separately authorized sandbox/account ownership, terms/contracts,
currency/fees/reversals, merchant, jurisdiction, reserve and custody controls.

The repository's [MIT license](../LICENSE), including Nymrel / JalenBuilds LLC
attribution, applies. Runtime TypeScript bytes are reused from the reviewed local
checkpoints; no private repository code, customer data, credentials or conversation
transcripts are included. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) binds the
published source bytes. [VALIDATION.md](VALIDATION.md) distinguishes local tests,
technical review, hosted checks and remaining integration gates.

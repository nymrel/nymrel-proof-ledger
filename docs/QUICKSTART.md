# Install and verify from source

The repository is the current distribution channel. The npm name
`@nymrel/proof-ledger` and PyPI name `nymrel-proof-ledger` are not currently
published. There is no hosted verifier required for these workflows.

## Run the Ed25519 demo

Install Node.js 22.12 through 26.x and npm 11, then run:

```sh
git clone https://github.com/nymrel/nymrel-proof-ledger.git
cd nymrel-proof-ledger
npm ci --ignore-scripts
npm run build
node examples/ed25519-demo.mjs
```

The [executable demo](../examples/ed25519-demo.mjs) saves a receipt and an artifact
in a temporary directory. Before creating the receipt, it provisions a separate
verifier configuration containing only an Ed25519 public key and the expected
algorithm. Verification reads that configuration, checks the signature, and
checks the artifact bytes. It never takes the verification key or algorithm from
the receipt and never saves or prints the private key.

Three outcomes are checked: authenticated verification succeeds; verification
without a key reports integrity only; changing signed metadata fails signature
verification even though the Merkle root still matches. A successful demo exits
zero and removes the temporary directory. An unexpected outcome exits nonzero.

This is a local experiment with ephemeral keys. In a real integration, provision
the verifier's public key and algorithm through an authenticated channel.
`trusted: true` authenticates the documented signed fields under that key. It does
not independently prove execution or register a real-world signer identity.

## Try the retained task-policy demo (unreleased source)

From a built, reviewed checkout containing the new example, run one command:

```sh
node examples/task-success-demo.mjs ../new-ledger-task-demo
```

Use a new directory whose parent already exists. The demo refuses an existing
file, directory or symlink at that output path. It leaves its output in place on
success and on failure; it never removes or replaces user files. Inspect any
partial output before retrying with another new path.
Unknown options are rejected; use `./--name` for a literal hyphen-leading path.

The command signs two synthetic task records with a disposable Ed25519 key held
only in memory. It provisions `public.json` outside the `success/` and `failure/`
artifact directories, then invokes this same package's actual CLI with that
explicit public key/algorithm, `--check-files` and `--require-task-success`.

| Synthetic signed record | Authentication and artifact checks | Requested task policy | Verifier exit |
| --- | --- | --- | --- |
| SUCCESS, exit 0 | Pass | Pass | 0 |
| FAILURE, exit 1 | Pass | Fail | 1 |

The demo itself prints JSON `status: "PASS"` and exits zero only when **both
expected outcomes** match. Its failed task fixture remains a failed claim.
No task is executed, and no private key is printed or saved. The retained public
configuration is experimental provisioning; real verifiers obtain their trusted
key and algorithm through an independently authenticated channel.

To try the same script from a separate application, first build/pack and install
the exact local archive using the steps below. Copy
`node_modules/@nymrel/proof-ledger/examples/task-success-demo.mjs` into that
application and run `node task-success-demo.mjs ./new-demo-output`. It resolves
the installed package API and CLI rather than importing a source checkout.
Older archives can lack this example even if they include the task-policy flag.
This source demo establishes neither actual execution nor signer authority,
authorization, freshness, artifact completeness or outside adoption.

## Install into a Node project

From the built checkout, create a local archive:

```sh
npm pack --ignore-scripts
```

Package version 2.0.1 produces `nymrel-proof-ledger-2.0.1.tgz`. In your consuming project,
install that file using its actual path:

```sh
npm install /absolute/path/to/nymrel-proof-ledger/nymrel-proof-ledger-2.0.1.tgz --ignore-scripts
```

The installed package exposes the compiled API and `proof-ledger` CLI. In an ES
module, use `import { attestExecution, verifyProof } from '@nymrel/proof-ledger'`.
The archive contains the runtime, README, executable examples and detailed
guides. Creating or installing this archive does
not publish it to npm.

## Install into a Python environment

With Python 3.11 through 3.14, run from the source checkout in your chosen virtual
environment:

```sh
python -m pip install .
proof-ledger-py --help
```

For a fresh environment on macOS or Linux, create and activate it with
`python -m venv .venv` and `source .venv/bin/activate` first. On Windows PowerShell,
use `py -m venv .venv` and `.venv\Scripts\Activate.ps1`.

The local install makes `from nymrel_proof_ledger import create_receipt,
verify_receipt` available. It installs the bounded `cryptography` and `rfc8785`
runtime dependencies declared in `pyproject.toml`; it does not publish to PyPI.
Both runtimes implement the same versioned receipt contract. Follow the
[cross-runtime demo](CROSS_RUNTIME_DEMO.md) to sign in Node and verify in Python,
then reverse the direction, with disk checks and explicit tamper rejections.

## Verify with a public-only CLI key file

After building the checkout, the signer can create a local experimental keypair:

```sh
node bin/proof-ledger.js keygen --algo Ed25519 --out signer.key
```

Choose a new output path: key generation refuses to replace existing files or
symlinks. New key files use owner-only `0600` permissions on POSIX; on Windows,
use a directory with a restrictive ACL. Omitting `--out` explicitly exports the
private key to stdout. Attestation requires a supplied signing key and never
creates or logs a replacement key.

`signer.key` contains both private and public key material. Keep it private and
outside version control. To prepare a public-only file in this local experiment:

```sh
node --input-type=module -e 'import { readFileSync, writeFileSync } from "node:fs"; const keys = JSON.parse(readFileSync("signer.key", "utf8")); writeFileSync("verifier-key.json", JSON.stringify({ algorithm: "Ed25519", publicKey: keys.publicKey }, null, 2), { flag: "wx" });'
```

Give only `verifier-key.json` to the verifier through an authenticated channel.
The verifier must independently choose Ed25519 as its expected algorithm:

```sh
node bin/proof-ledger.js attest --task "Local build manifest" --files README.md --key-file signer.key --algo Ed25519 --out proof.json
node bin/proof-ledger.js verify proof.json --key-file verifier-key.json --algo Ed25519 --check-files --json
```

For an automation gate, add `--require-trusted-v2` to the verification command.
It exits one unless signature authentication, protocol v2, and all requested
checks succeed. JSON output includes `policy.passed` and `policy.errors`; these
are policy decisions alongside the original cryptographic result fields. The
same flag is available in `proof-ledger-py verify`.

### Require a signed success claim in CI

The current source adds the **unreleased** `--require-task-success` policy.
Authentication can succeed for an honestly recorded failed task. Use the
stronger policy when your downstream job must accept only an authenticated v2
record whose signed task status is `SUCCESS` and signed exit code is numeric
integer zero:

```sh
node bin/proof-ledger.js verify proof.json --key-file verifier-key.json --algo Ed25519 --check-files --require-task-success --json
proof-ledger-py verify proof.json --key-file verifier-key.json --algo Ed25519 --check-files --require-task-success --json
```

The flag implies `--require-trusted-v2`; you do not need both. It emits policy
name `authenticated-v2-task-success`. An authenticated `FAILURE`, `WARNING` or
`ATTESTED` record, a missing/null outcome, or a successful status with a nonzero
exit code fails this policy and exits one. Booleans and strings never stand in
for zero; canonical-equivalent JSON numeric forms such as `0.0` are integer zero.
Cryptographic `valid`/`trusted` results retain their meanings when only the task
policy fails. The existing default and authentication-only gate remain unchanged.

Artifact reads remain an explicit `--check-files` request. This gate evaluates
the signed claim; it does not observe execution, authenticate a real-world signer
identity, establish authorization or freshness, or discover omitted expected
artifacts. Evaluate a pinned checkout containing this change; older archives
and installed versions do not acquire a new flag from these instructions.

Run this experiment from the checkout root so the relative artifact path resolves
to the same file. Separate verification environments must have matching artifact
bytes under their own verification root when using `--check-files`.

Require `trusted: true`, and require receipt version `2.0.0` if your policy needs
v2 signed fields. Without `--require-trusted-v2`, CLI exit zero by itself is
insufficient: integrity-only verification also exits zero. Badges and certificates present receipt data; they
do not establish trust. Production key custody, identity binding, rotation, and
revocation remain operator responsibilities. Read [verification boundaries](VERIFICATION_SECURITY.md)
and [SECURITY.md](../SECURITY.md) before using this as a release or authorization gate.

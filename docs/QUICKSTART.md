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

## Install into a Node project

From the built checkout, create a local archive:

```sh
npm pack --ignore-scripts
```

Version 2.0.0 produces `nymrel-proof-ledger-2.0.0.tgz`. In your consuming project,
install that file using its actual path:

```sh
npm install /absolute/path/to/nymrel-proof-ledger/nymrel-proof-ledger-2.0.0.tgz --ignore-scripts
```

The installed package exposes the compiled API and `proof-ledger` CLI. In an ES
module, use `import { attestExecution, verifyProof } from '@nymrel/proof-ledger'`.
The archive contains the runtime and README; the executable demo and detailed
guides remain in the source repository. Creating or installing this archive does
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
The first-run executable demo above uses Node. Both runtimes implement the same
versioned receipt contract.

## Verify with a public-only CLI key file

After building the checkout, the signer can create a local experimental keypair:

```sh
node bin/proof-ledger.js keygen --algo Ed25519 --out signer.key
```

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

Run this experiment from the checkout root so the relative artifact path resolves
to the same file. Separate verification environments must have matching artifact
bytes under their own verification root when using `--check-files`.

Require `trusted: true`, and require receipt version `2.0.0` if your policy needs
v2 signed fields. CLI exit zero by itself is insufficient: integrity-only
verification also exits zero. Badges and certificates present receipt data; they
do not establish trust. Production key custody, identity binding, rotation, and
revocation remain operator responsibilities. Read [verification boundaries](VERIFICATION_SECURITY.md)
and [SECURITY.md](../SECURITY.md) before using this as a release or authorization gate.

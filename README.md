# Nymrel Proof Ledger

Nymrel Proof Ledger is a dual-runtime cryptographic attestation library and CLI for
producing portable, offline-verifiable proof receipts.

Protocol v2 uses:

- RFC 8785 JSON Canonicalization Scheme (JCS)
- RFC 6962 domain-separated Merkle trees
- HMAC-SHA256 or Ed25519 signatures
- identical shared vectors in TypeScript and Python
- fail-closed envelope validation before hashing, cryptography, or disk access

The repository is the current source of truth. The npm name
@nymrel/proof-ledger and PyPI name nymrel-proof-ledger are not currently
published, and proofs.nymrel.com is not represented here as an active
verification service.

Use it to attach signed receipts to build artifacts, automation outputs, or
audit exports that another process can verify offline with a known public key.
The signer supplies the task record; the library does not independently observe
execution or establish the real-world identity of the signer.

## First run from source

With Node.js 22.12 through 26.x and npm 11 installed:

~~~sh
git clone https://github.com/nymrel/nymrel-proof-ledger.git
cd nymrel-proof-ledger
npm ci --ignore-scripts
npm run build
node examples/ed25519-demo.mjs
~~~

The demo creates a v2 Ed25519 receipt for a local artifact, then verifies the
saved receipt using a separately configured **public** key and expected algorithm.
It also checks the artifact bytes on disk. Expect:

~~~text
Original receipt + configured public key + disk check: valid=true, trusted=true, signatureChecked=true
Original receipt without a verification key: valid=true, trusted=false, signatureChecked=false
Receipt with changed signed metadata: valid=false, trusted=false, signatureChecked=true
~~~

The last result is an expected tamper rejection; the demo exits successfully only
when all expectations pass. It uses fresh experimental keys, saves no private key,
removes its temporary files, and needs no account or hosted verifier.

For source installation into another Node or Python project and public-key-only
CLI verification, see the [source installation guide](docs/QUICKSTART.md).
Registry installs such as `npm install @nymrel/proof-ledger` and
`pip install nymrel-proof-ledger` are not the current installation path.

## Runtime support

| Runtime | Supported | Production dependencies |
| --- | --- | --- |
| Node.js | 22.12 through 26.x | None |
| Python | 3.11 through 3.14 | cryptography, rfc8785 |

TypeScript is compiled with TypeScript 7 and explicit Node types. Python Ed25519
operations use PyCA cryptography; there is no homegrown curve implementation.

## Trust semantics

The verify command distinguishes mathematical integrity from authenticated trust:

| Result | Meaning |
| --- | --- |
| valid true, trusted true | Envelope, Merkle data, requested disk checks, and signature all passed with a supplied key. |
| valid true, trusted false | Integrity passed, but no verification key was supplied. The signature was not checked. |
| valid false | At least one structural, Merkle, artifact, or signature check failed. |

A badge or certificate is a presentation of receipt data, not independent proof.
Trust requires verification with key material obtained through an authenticated
channel.

Visual generators validate the receipt envelope before rendering and default to
`UNVERIFIED RECEIPT`. Task success is displayed as task outcome; it is never
used as a trust signal. Pass the corresponding verification result to render
`TRUSTED RECEIPT` or `INTEGRITY ONLY`. A QR code contains an offline receipt URN
unless the caller explicitly supplies an absolute HTTPS verifier base URL; this
package does not assume that a hosted verifier exists.

SVG badge QR payloads support up to 134 UTF-8 bytes. Longer receipt URNs or
verifier URLs raise an error rather than encoding a truncated target. Generated
badges include the four-module white margin required around a QR code.

## Local development

### Node.js

~~~powershell
npm install --ignore-scripts
npm run test:release
~~~

The release gate builds the TypeScript files. When packing a checkout without
running that gate, run `npm run build` before `npm pack` or `npm pack --dry-run`;
the compiled package files are not stored in Git.

### Python

~~~powershell
uv run --isolated --no-project --python 3.13 --with "cryptography>=50.0.1,<51" --with "rfc8785==0.1.4" python -m unittest discover -s test/python -p "test_*.py"
~~~

To install the Python package from this checkout:

~~~powershell
python -m pip install .
~~~

## TypeScript API

After building this checkout, a script at the repository root can import the
compiled API as below. A consumer that installs the local npm archive described
in the [source installation guide](docs/QUICKSTART.md) can instead import from
`@nymrel/proof-ledger`.

~~~typescript
import {
  ProofLedger,
  attestExecution,
  verifyProof,
} from './dist/src/index.js';

const secret = ProofLedger.generateSecretKey();

const receipt = await attestExecution({
  task: {
    name: 'Release acceptance',
    status: 'SUCCESS',
    exitCode: 0,
  },
  artifacts: [{ path: 'README.md' }],
  signingKey: secret,
  signerIdentity: 'nymrel-release',
  metadata: { environment: 'local-acceptance' },
});

const result = await verifyProof(receipt, {
  expectedAlgorithm: 'HMAC-SHA256', publicKeyOrSecret: secret,
  checkFilesOnDisk: true,
});

if (!result.trusted) {
  throw new Error(result.errors.join('\n') || 'Signature was not checked');
}
~~~

## Python API

~~~python
from nymrel_proof_ledger import ProofSigner, create_receipt, verify_receipt

secret = ProofSigner.generate_secret_key()

receipt = create_receipt(
    task={"name": "Release acceptance", "status": "SUCCESS", "exitCode": 0},
    artifacts=[{"path": "README.md"}],
    signing_key=secret,
    signer_identity="nymrel-release",
    metadata={"environment": "local-acceptance"},
)

result = verify_receipt(
    receipt,
    expected_algorithm='HMAC-SHA256', public_key_or_secret=secret,
    check_files_on_disk=True,
)

if not result["trusted"]:
    raise RuntimeError(result["errors"] or ["Signature was not checked"])
~~~

## CLI

Build the checkout first. The [source installation guide](docs/QUICKSTART.md)
shows how to prepare a separate public-only verifier key file.

~~~powershell
# Generate portable raw-hex Ed25519 keys.
node bin/proof-ledger.js keygen --algo Ed25519 --out signer.key

# Create a v2 receipt.
node bin/proof-ledger.js attest --task "Build and test" --files "dist/src/index.js,README.md" --key-file signer.key --algo Ed25519 --out proof.json

# Authenticated verification.
node bin/proof-ledger.js verify proof.json --key-file verifier-key.json --algo Ed25519 --check-files

# Integrity-only verification is explicit and is never labeled trusted.
node bin/proof-ledger.js verify proof.json
~~~

The Python entry point is proof-ledger-py after package installation.
--key-file accepts raw text or the JSON envelope produced by keygen.
The generated Ed25519 signing envelope contains a private key. Keep it with the
signer; share only its public key and independently configure `--algo Ed25519`
for the verifier. Never obtain the trusted key or expected algorithm from a receipt.

Authenticated verification requires an independently configured algorithm together
with the key: `expectedAlgorithm` in TypeScript, keyword-only `expected_algorithm`
in Python, and `--algo` in either CLI (including with `--key-file`). Configure the
algorithm alongside your trusted key; never copy it from an untrusted receipt.
A missing or mismatched pair returns an invalid, untrusted result. Existing
key-only callers must migrate. Omitting both retains integrity-only verification.
This applies to the public aliases, `ProofLedger.verify`, and Signal bundle APIs.

Git collection is disabled by default. Set `includeGitContext: true`,
`include_git_context=True`, or `attest --include-git-context` only for a trusted
working directory and Git installation; this opt-in executes Git commands.
Signal bundles retain the safe default. See [verification migration and trust
boundaries](docs/VERIFICATION_SECURITY.md) for the complete contract.

Disk checks are confined to the verification working directory after real-path
resolution. Receipts cannot use parent traversal, absolute external paths, or
symlink indirection to make verification read outside that root.

## Protocol v2

Every emitted receipt has:

- protocol: nymrel-proof-ledger
- version: 2.0.0
- merkle.algorithm: RFC6962-SHA256

The Merkle input order is:

1. RFC 8785 hash of the task record
2. RFC 8785 hash of the environment record
3. one RFC 8785 hash per complete artifact record

Each input is then encoded as an RFC 6962 leaf:
SHA-256(0x00 || input). Interior nodes are
SHA-256(0x01 || left || right). The empty root is SHA-256 of the empty
byte string; an odd node is promoted without duplication.

The v2 signature authenticates the protocol/version, Merkle algorithm and root,
proof identifier and timestamps, organization and task name, signature
algorithm/key ID/signer identity, and an RFC 8785 hash of metadata.

Malformed I-JSON values, non-finite numbers, lone UTF-16 surrogates, sparse
arrays, accessors, symbol properties, invalid hashes, and malformed key material
fail closed.

## Protocol v1 compatibility

Receipts with version 1.0.0 remain verification-compatible. Their frozen legacy
serializer and duplicated-odd Merkle profile are selected only by the v1 version
gate. New receipts are always v2.

The v1 signature authenticates artifact digests only, not artifact path, size,
MIME type or artifact count, metadata, or signature identity fields.
Successful v1 signature verification is limited to the legacy signed payload;
it emits a warning and must not be interpreted as authenticating the whole envelope.

The shared fixture at test/fixtures/protocol-v2-vectors.json contains:

- RFC 8785 number and Unicode ordering vectors
- RFC 6962 empty and three-leaf vectors
- RFC 8032 Ed25519 test vector 1
- a cross-runtime v2 receipt
- a frozen real-shape v1 receipt

## Key handling

- HMAC keys are symmetric: possession permits both signing and verification.
- Ed25519 private and public keys are exact 32-byte raw values encoded as
  64 hexadecimal characters.
- The Node implementation also accepts valid Ed25519 PEM keys for source
  compatibility.
- Invalid Python Ed25519 text is never transformed into a key.
- Generated ephemeral keys are suitable only for local experiments. Production
  key custody, rotation, revocation, and identity binding are operator concerns
  outside this library.

## Acceptance commands

~~~powershell
npm run test:release
npm audit --audit-level=high
npm pack --dry-run
uvx ruff@0.16.5 check --select E4,E7,E9,F python test
uvx pip-audit .
~~~

See SECURITY.md before using receipts as an authorization or release gate.

`npm run test:release` includes both runtime suites and actual bidirectional
authentication and Signal checks. Run `npm run test:cross` for the cross-runtime
checks alone; it builds the Node package first and uses an isolated Python 3.13
environment. The TypeScript runner allows five minutes per suite, and each
cross-runtime Node bridge call allows one minute before failing.

CI also audits dependencies and workflow definitions every Tuesday at 07:17 UTC
on the default branch. Scheduled runs skip the runtime matrices and use a
separate concurrency group so normal CI cannot cancel the periodic audit.

## License

MIT License. Copyright 2026 Nymrel.

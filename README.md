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

The [90-day improvement goal](https://github.com/nymrel/nymrel-proof-ledger/blob/main/docs/90_DAY_GOAL.md) tracks safer key handling,
explicit automation gates, independent adoption, large-artifact efficiency,
and release readiness through January 16, 2027.

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
CLI verification, see the [source installation guide](https://github.com/nymrel/nymrel-proof-ledger/blob/main/docs/QUICKSTART.md).
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
Long proof IDs are abbreviated in the visible label; the QR target and embedded
metadata retain the complete identifier.

## Contributing

Ideas, questions, documentation improvements, and independent reports from
trying the examples are welcome. An early idea can describe the problem, who
it helps, and open questions; it does not need code or a finished specification.
Check existing [issues and pull requests](https://github.com/nymrel/nymrel-proof-ledger/issues)
for related work. See [CONTRIBUTING.md](https://github.com/nymrel/nymrel-proof-ledger/blob/main/CONTRIBUTING.md)
for setup and validation, and the [human trial guide](https://github.com/nymrel/nymrel-proof-ledger/blob/main/docs/HUMAN_TRIAL.md)
for an independent installed-consumer trial. Report security concerns privately
as described in [SECURITY.md](https://github.com/nymrel/nymrel-proof-ledger/blob/main/SECURITY.md).

## Local development

### Node.js

~~~powershell
npm ci --ignore-scripts
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

The API examples below use an inline artifact, so no files need to be prepared.
For artifacts already on disk, omit `data`, set `path` to your file, and enable
`checkFilesOnDisk: true` or `check_files_on_disk=True` when verifying from that
working directory.

## TypeScript API

After building this checkout, a script at the repository root can import the
compiled API as below. A consumer that installs the local npm archive described
in the [source installation guide](https://github.com/nymrel/nymrel-proof-ledger/blob/main/docs/QUICKSTART.md) can instead import from
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
  artifacts: [{ path: 'dist/manifest.json', data: '{"build":"example"}' }],
  signingKey: secret,
  signerIdentity: 'nymrel-release',
  metadata: { environment: 'local-acceptance' },
});

const result = await verifyProof(receipt, {
  expectedAlgorithm: 'HMAC-SHA256', publicKeyOrSecret: secret,
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
    artifacts=[{"path": "dist/manifest.json", "data": '{"build":"example"}'}],
    signing_key=secret,
    signer_identity="nymrel-release",
    metadata={"environment": "local-acceptance"},
)

result = verify_receipt(
    receipt,
    expected_algorithm='HMAC-SHA256', public_key_or_secret=secret,
)

if not result["trusted"]:
    raise RuntimeError(result["errors"] or ["Signature was not checked"])
~~~

## HTML certificates

Use `node bin/proof-ledger.js badge proof.json --format html --out certificate.html`
or either runtime's HTML certificate API to create a portable receipt view. It adapts to phone widths
and keeps the original receipt JSON available. Copy Merkle Root reports success
after the browser accepts the copy; if the clipboard is unavailable, it selects
the root for manual copying. Without JavaScript, select the root directly and
use the browser's Print command. Generating, copying, or printing a certificate
does not verify the receipt or its reported task outcome.

## CLI

Build the checkout first. The [source installation guide](https://github.com/nymrel/nymrel-proof-ledger/blob/main/docs/QUICKSTART.md)
shows how to prepare a separate public-only verifier key file.

~~~powershell
# Generate portable raw-hex Ed25519 keys.
node bin/proof-ledger.js keygen --algo Ed25519 --out signer.key

# Create a v2 receipt.
node bin/proof-ledger.js attest --task "Build and test" --files "dist/src/index.js,README.md" --key-file signer.key --algo Ed25519 --out proof.json

# Authenticated verification.
node bin/proof-ledger.js verify proof.json --key-file verifier-key.json --algo Ed25519 --check-files

# Automation gate: require an authenticated v2 receipt and requested disk checks.
node bin/proof-ledger.js verify proof.json --key-file verifier-key.json --algo Ed25519 --check-files --require-trusted-v2 --json

# Integrity-only verification is explicit and is never labeled trusted.
node bin/proof-ledger.js verify proof.json
~~~

The Python entry point is proof-ledger-py after package installation.
--key-file accepts raw text or the JSON envelope produced by keygen.
Attestation requires an explicit `--key-file` or `--key`; a missing key fails
before generating a receipt. Prefer key files so secrets stay out of shell
history and process arguments.
The generated Ed25519 signing envelope contains a private key. Keep it with the
signer; share only its public key and independently configure `--algo Ed25519`
for the verifier. Never obtain the trusted key or expected algorithm from a receipt.

`verify --json` returns the verification-result JSON object with exit code 1
when a receipt cannot be read or parsed as UTF-8 JSON. These input failures have
`valid: false`, `trusted: false`, `receipt: null`, and no signature or disk checks;
`errors` explains how to retry without including receipt contents. Successfully
parsed values continue through the regular envelope and integrity checks.
With `--require-trusted-v2`, loading failures also include the failed policy
verdict; the policy does not trigger key or artifact reads after a load failure.

`keygen --out PATH` creates a new key file exclusively, with owner-only permissions
(`0600`) on POSIX systems. It refuses an
existing file, directory, or destination symlink, preserving the existing key.
Choose a new filename when generating a replacement key. On Windows, access is
controlled by the destination directory's ACLs; use a private directory.

Both CLIs accept `--algo Ed25519` / `--algo=Ed25519` and `--out PATH` /
`--out=PATH`. HMAC-SHA256 is the default algorithm. Unsupported algorithms and
missing or empty option values fail; an empty `--out` never selects stdout.
Node keygen also rejects unknown or repeated options and unexpected positional
arguments; place `keygen` before its options.
Omitting `--out` deliberately prints the secret-bearing JSON envelope to stdout.
Prefer `--out` for stored keys: shell redirection uses the shell's file permissions
and overwrite behavior instead of the CLI's protections.

Authenticated verification requires an independently configured algorithm together
with the key: `expectedAlgorithm` in TypeScript, keyword-only `expected_algorithm`
in Python, and `--algo` in either CLI (including with `--key-file`). Configure the
algorithm alongside your trusted key; never copy it from an untrusted receipt.
A missing or mismatched pair returns an invalid, untrusted result. Existing
key-only callers must migrate. Omitting both retains integrity-only verification.
This applies to the public aliases, `ProofLedger.verify`, and Signal bundle APIs.

Both CLIs support `verify --require-trusted-v2` for automation. Exit zero then
requires `valid: true`, `trusted: true`, and receipt version `2.0.0`. With `--json`,
the result adds `policy: { name: 'authenticated-v2', passed, errors }`; the core
verification fields retain their original meanings. A rejected legacy receipt
can still have `valid: true` and `trusted: true` while `policy.passed` is false
and the command exits one. File checks remain explicit through `--check-files`.
Default verification behavior is unchanged.

Git collection is disabled by default. Set `includeGitContext: true`,
`include_git_context=True`, or `attest --include-git-context` only for a trusted
working directory and Git installation; this opt-in executes Git commands.
Signal bundles retain the safe default. See [verification migration and trust
boundaries](https://github.com/nymrel/nymrel-proof-ledger/blob/main/docs/VERIFICATION_SECURITY.md) for the complete contract.

Disk checks are confined to the verification working directory after real-path
resolution. Receipts cannot use parent traversal, absolute external paths, or
symlink indirection to make verification read outside that root.
File-backed artifacts are hashed in bounded chunks during creation and disk
verification; file size does not determine the hashing buffer size. In-memory
artifact inputs keep their existing behavior.

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
npm run test:installed
npm audit --audit-level=high
npm pack --dry-run
uvx ruff@0.16.5 check --select E4,E7,E9,F python test
uvx pip-audit .
~~~

See SECURITY.md before using receipts as an authorization or release gate.

`npm run test:installed` builds and installs the exact npm archive, Python wheel,
and source archive outside the checkout, then checks public-only bidirectional
verification and installed CLI gates. See the
[installed consumer guide](https://github.com/nymrel/nymrel-proof-ledger/blob/main/docs/INSTALLED_CONSUMERS.md) for dependencies and
retained artifact evidence. These checks demonstrate installation and integration,
not publication or independent human adoption.

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

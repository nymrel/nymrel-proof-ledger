# Verify receipts across Node and Python

Run this example to sign a receipt in Node and verify it in Python, then sign in
Python and verify in Node. Both directions use fresh Ed25519 keys and check a
copied artifact on disk. The example also demonstrates how signed metadata and
artifact tampering fail verification.

## Run from source

Use Node.js 22.12 through 26.x, npm 11, and uv. From this checkout:

```sh
npm ci --ignore-scripts
npm run build
uv run --isolated --no-project --python 3.13 --with "cryptography>=50.0.1,<51" --with "rfc8785==0.1.4" python examples/cross-runtime-demo.py
```

If your Python 3.11 through 3.14 environment already has the runtime dependencies
installed, run `python examples/cross-runtime-demo.py` after the Node build.
The example loads Python source relative to its own location and imports the
built Node library. Neither package needs to be installed from a registry. After
dependencies and runtimes are available and the build is complete, the example
needs no network access or hosted verifier.

The [Python driver](../examples/cross-runtime-demo.py) orchestrates both
directions and supplies the Python worker; the
[Node worker](../examples/cross-runtime-worker.mjs) performs the Node operations.
Each worker has a 60-second timeout. An unexpected outcome exits nonzero, and
the checks remain active with Python's `-O` option. Temporary files are removed
on success or failure.

## What the example checks

Each direction uses separate signer and verifier directories. A signer child
process generates an ephemeral keypair and signs a receipt for a local artifact.
The verifier receives a separate configuration containing only the public key
and expected algorithm. Artifact and receipt files are copied byte for byte,
then the signer directory is removed before verification begins. The private
key is never saved, printed, or passed to a verifier.

The following four checks run in each direction:

| Check | Expected result |
| --- | --- |
| Original receipt, configured public key, and disk check | `valid: true`, `trusted: true`; one artifact checked. |
| Original receipt and disk check, without a key | `valid: true`, `trusted: false`; signature not checked. |
| Changed signed metadata | `valid: false`, `trusted: false`; Merkle data still matches, but the signature fails. Disk checks are skipped after the signature failure. |
| Original receipt restored, artifact bytes changed | `valid: false`, `trusted: false`; the signature remains valid, but the artifact hash fails. |

The two tamper cases show why both signature and disk checks matter. Metadata is
signed in protocol v2 without being part of the Merkle tree. A signature also
does not establish that the files currently on disk still match their signed
digests.

## Use the pattern in an integration

This example simulates public-key provisioning within a local experiment. Its
separate processes and directories do not establish an independent identity or
an authenticated delivery channel. `trusted: true` authenticates the documented
signed fields under the configured key; it does not independently prove task
execution or the signer's real-world identity.

For a real integration, provision the expected algorithm and public key through
an authenticated channel, then transport the receipt and artifacts separately.
Verify against an explicit artifact root and require `trusted: true`. Require
receipt version `2.0.0` when your policy depends on v2 signed fields. Keep the
private key with the signer and arrange key custody, rotation, and revocation
for your deployment.

This is a source-checkout workflow; it does not publish an npm or PyPI package.
See [verification boundaries](VERIFICATION_SECURITY.md) and
[SECURITY.md](../SECURITY.md) before using receipts as an authorization or release
gate.

# Verification migration and trust boundaries

Authenticated verification binds **both** the key and its algorithm from trusted
configuration. The receipt's algorithm is only checked for equality. It cannot
choose how a supplied key is interpreted. This prevents an attacker who knows an
Ed25519 public key from using that public text as an HMAC secret and presenting
the resulting receipt as an authenticated Ed25519 claim.

```ts
const result = await verifyReceipt(receipt, {
  publicKeyOrSecret: configuredPublicKey,
  expectedAlgorithm: 'Ed25519',
});
```

```python
result = verify_receipt(
    receipt, public_key_or_secret=configured_public_key,
    expected_algorithm='Ed25519',
)
```

Use `HMAC-SHA256` with a secret supplied through trusted configuration. HMAC
possession permits signing as well as verification. The portable Ed25519 key
format is exactly 32 bytes encoded as 64 hexadecimal characters; Node additionally
supports PEM. Do not convert a public key into an HMAC secret. The library does
not supply identity registration, authorization, key custody, rotation or revocation.

Existing key-only callers must add the algorithm. Python's new parameter is
keyword-only; existing positional file-check and working-directory arguments keep
their positions. TypeScript rejects incomplete pairs at compile time and both
runtimes reject them at runtime. Public aliases and Signal bundle verification
use the same core check. CLI callers must include `--algo Ed25519` or
`--algo HMAC-SHA256`, even when a key file contains an algorithm field.
That declared algorithm must match the flag. JSON HMAC files must contain
`secretKey`; Ed25519 signing uses `privateKey` and verification uses `publicKey`.
Contradictory or missing role-specific material fails closed, never falls back to
another algorithm's key field or to treating the JSON document as a secret.
Key files must use valid UTF-8; a leading UTF-8 BOM is supported. UTF-16,
NUL-containing or replacement-character text is rejected. Both runtimes strip
the same surrounding whitespace/BOM characters before detecting JSON key envelopes.
This includes edge U+001C–U+001F, U+0085 and U+FEFF; raw files relying on the
previous runtime-specific edge stripping must migrate. Internal line endings
remain unchanged. Direct API key strings are never trimmed.

Omit both key and algorithm for integrity-only checking: a consistent receipt can
return `valid: true` with `trusted: false`. `trusted: true` requires a valid
signature under the configured pair, not proof that a task occurred or that a
signer identity is independently registered. Legacy v1 verification preserves the
frozen signed payload and authenticates artifact digests only, not artifact path,
size, MIME type or artifact count, metadata, or signature identity fields. Relabelled
or duplicate legacy artifacts can retain the original signature; the warning
must not be ignored in release gates. New receipts remain protocol v2; no wire-version change is
needed for this verifier API correction.

Unknown top-level, signature and Merkle extension fields are not signed claims.
They may appear in the returned receipt; consumers must not promote them into
authenticated assertions. Authentication covers the documented versioned payload.

Both runtimes reject malformed signature hex even without a verification key,
newline-suffixed hashes/timestamps, and timestamps containing non-ASCII digits.
Artifact sizes use the common JSON integer domain: integral `7.0` is accepted as
`7`, but fractions, booleans, negatives and values above `2^53 - 1` are rejected.
Nonempty envelope labels preserve their bytes. Signal fields requiring nonblank
text use the same explicit Unicode whitespace set in both runtimes. Neither
verification API normalizes key bytes. Unsupported canonical JSON values return
an invalid result rather than creating authenticated output.

Receipt creation no longer inspects Git by default. Explicit opt-in
(`includeGitContext: true`, `include_git_context=True`, or CLI
`attest --include-git-context`) executes Git in the selected working directory.
Only use it with trusted directories and a trusted Git installation. Applications
accepting untrusted working directories should keep it disabled.

## Standalone Merkle proof contract

`MerkleTree.verifyProof` / `verify_proof` verifies that a caller-supplied hash and
the supplied ordered sibling path combine to the supplied root. It does not take
leaf data, a leaf index, or a tree size, and does not authenticate those values.
An empty path succeeds if the supplied hash equals the root; this alone is not
evidence that the hash represents a leaf rather than an internal node.

For the RFC 6962 profile, derive the leaf from the actual expected data using
`hashLeaf(data)` / `hash_leaf(data)` and obtain the expected root through an
authenticated channel. If verifying prehashed application data, first derive that
application digest independently and then apply the domain-separated leaf hash
with the prehashed/hex option. Do not accept an alleged leaf hash from the prover
as a substitute for deriving it. Applications needing an authenticated index or
tree size must use a separate protocol that binds and verifies that context;
this low-level path helper does not provide indexed inclusion verification.

Receipt verification does not use this standalone helper. It recomputes the
entire ordered canonical leaf list and root from the receipt payload and checks
the signature according to the receipt version and configured algorithm.

## API hardening and compatibility decisions

Signal bundles require a v2 receipt even when legacy core verification succeeds.
Malformed JSON-shaped inputs return invalid results instead of exceptions. The
canonical core continues to accept frozen v1 receipts for compatibility; a caller
that requires v2 must require `result.receipt.version === '2.0.0'` (Python:
`result['receipt']['version'] == '2.0.0'`) after successful verification. Gate
consumers must require `result.trusted`, not merely `valid` or CLI exit zero.
API consumers continue to enforce policy using the explicit result and version
fields. Both CLIs additionally offer the opt-in `--require-trusted-v2` gate:
exit zero requires a valid, trusted receipt with version `2.0.0`. This leaves
the default integrity-only exit behavior unchanged. The flag does not require
local artifacts unless `--check-files` is also requested.

With `--json`, this flag adds a `policy` object containing `name` (always
`authenticated-v2`), `passed`, and `errors`. Policy rejection does not rewrite
`valid`, `trusted`, or signature fields. Error strings in `policy.errors` are,
in order when applicable: `Receipt verification failed`,
`Authenticated verification is required`, and `Receipt protocol v2 is required`.
Core filesystem errors retain native runtime diagnostic wording. Never obtain
the verification key or expected algorithm from the receipt itself.

CLI attestation now fails when no signing key is supplied. Generate an explicit
experimental key with `keygen --out` and provide `--key-file` to migrate keyless
scripts. New key files are created exclusively with POSIX mode `0600`; existing
files and symlinks are refused. Windows operators must configure destination ACLs.
Only an explicit `keygen` without `--out` exports private key material to stdout.
The Node CLI accepts `--name=value` syntax for value options and rejects unknown
`keygen`/`verify` options, multi-character single-dash spellings, and values on
boolean flags. A misspelled output option cannot silently select key export,
and a later malformed flag cannot disable an explicitly requested policy gate.

Signature and Merkle failures now prevent artifact filesystem resolution and
reads. `artifactsValid` is false when requested disk checks were skipped due to
these failures, and `checkedArtifacts` remains zero. Unkeyed integrity-only disk
checks remain an explicit caller capability. Portable disk paths reject Windows
device names, alternate streams, trailing dots/spaces and reserved characters on
all hosts, in addition to existing root confinement. A filename accepted for
in-memory attestation can therefore be ineligible for portable disk verification.
Names beginning with two dots, such as `..notes.txt` or `..cache/artifact.txt`,
remain valid when their resolved paths stay within the verification root. Only
the `..` parent component denotes traversal; symlinks are checked after resolution.

Git context still requires opt-in and a trusted directory/installation. It resolves
an executable from absolute PATH directories, excluding the selected working
directory and relative/empty entries, then invokes the absolute executable without
a shell. PATH trust remains the caller's responsibility; this is not a Git sandbox.
Python Signal creation now exposes the same explicit opt-in as the core.

Human CLI receipt fields and errors escape terminal controls and directional
formatting characters. Markdown additionally escapes markup delimiters. JSON
results preserve the original values. Rendering a report does not establish trust.
Raw key files reject JSON delimiters so invisible prefixes cannot turn a public
JSON envelope into an HMAC secret. Secrets containing those delimiters remain
supported as the `secretKey` field of an explicit algorithm-bound JSON envelope.
Existing strict UTF-8, role/algorithm selection and edge-whitespace rules still apply.
Raw key files carry no algorithm declaration: a bare hex or PEM public key cannot
be distinguished from a caller-configured HMAC secret. Use an algorithm-bound
JSON envelope when carrying key-role metadata; the caller's algorithm is trusted
configuration, never selected from the receipt.

Legacy serializers are intentionally frozen: integral floating-point values and
lone surrogates can have different historical representations in Python and JS.
Do not manufacture new cross-runtime v1 receipts with these edge values. Use v2
for portable new receipts; changing the v1 serializer would invalidate historical
signatures. Unknown extra fields, including extra signature fields, are returned
as input data but are not authenticated unless the versioned signed payload
explicitly includes them. Consumers must not infer trust in all returned fields.

Python's standalone Merkle path verifier now accepts its exported frozen
`MerkleProofStep` dataclass as well as dictionaries. It still does not authenticate
leaf data, an index, tree size or root provenance, and is distinct from receipt
verification despite the similarly named convenience APIs.

## Regression evidence (runtime checks)

The shared cases in `test/fixtures/auth-context-cases.json` run in each runtime.
`python test/cross_runtime_auth.py` additionally compares their actual results and
cross-verifies newly generated HMAC and Ed25519 receipts in both directions after
`npm run build`. Use a Python environment with this package's runtime dependencies.
The same command also runs `test/cross_runtime_signal.py` against both actual
runtimes. API-hardening suites cover malformed bundles, valid legacy rejection,
zero disk I/O on invalid crypto, portable path preflight, direct Git execution,
display escaping, disguised key files and the exported Python proof-step type.

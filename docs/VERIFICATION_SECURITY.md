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

## Regression evidence

The shared cases in `test/fixtures/auth-context-cases.json` run in each runtime.
`python test/cross_runtime_auth.py` additionally compares their actual results and
cross-verifies newly generated HMAC and Ed25519 receipts in both directions after
`npm run build`. Use a Python environment with this package's runtime dependencies.

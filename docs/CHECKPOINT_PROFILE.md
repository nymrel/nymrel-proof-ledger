# External checkpoint profile (design draft)

**Status:** proposed `0.1.0`, October 28, 2026. Tracking:
[issue 9](https://github.com/nymrel/nymrel-proof-ledger/issues/9).
The experimental, text-only verification core is implemented in both runtimes.
It requires independently provisioned pins and a caller-supplied adapter; it provides
no real-source adapter, pin storage, update channel, or recovery mechanism.
Existing v1 verification and v2 receipt semantics do not change.

The observable outcome is offline comparison of protected evidence with an
independently retained, signed checkpoint. A shorter replacement or a changed
prefix must fail relative to that checkpoint. A valid signature alone does not
establish completeness, execution, authorization, signer authority, or trusted
time.

## Retention and trust inputs

Keep the checkpoint bundle outside the ledger/directory it protects. Separately
provision the verifier with the expected source identity, source adapter, source
epoch digest, checkpoint digest, and trust-bundle pin. Neither the ledger nor a
checkpoint may choose its own trusted key, algorithm, checkpoint floor, or bundle.

The trust-bundle pin is `{bundleId, revision, sha256}` from an authenticated
operator channel. The checkpoint pin is the SHA-256 digest of its canonical
checkpoint object. Compare both pins exactly before acceptance. Persist their
latest accepted values outside the protected source; never fall back to an older
available bundle/checkpoint after a mismatch. Replacing all independently
retained state defeats this comparison. This draft provides no storage service,
automatic update channel, or protection against operator-channel compromise.

## Wire objects and strict admission

The portable checkpoint bundle has exactly two properties:

```json
{"checkpoint": {"schema": "nymrel.checkpoint", "version": "0.1.0"}, "receipt": {}}
```

The abbreviated objects above are not valid instances. `checkpoint` has exactly
the following required properties; extension properties require a new profile
version. `null` is allowed only for an empty source's `highestSequence`.

| Property | Type and rule |
| --- | --- |
| `schema` | Literal `nymrel.checkpoint` |
| `version` | Literal `0.1.0` |
| `sourceProtocol`, `sourceVersion` | Nonempty ASCII identifiers for the independently configured source adapter; no implicit fallback |
| `sourceId` | Nonempty opaque ASCII identifier, matched to verifier configuration |
| `highestSequence` | Zero-based contiguous logical sequence: `eventCount - 1`, or `null` when empty |
| `eventCount` | Integer from 0 through 9,007,199,254,740,991 |
| `chainHeadOrStateHash` | `sha256:` followed by exactly 64 lowercase hexadecimal characters |
| `sourceEpochDigest` | Same digest syntax; identifies an independently expected genesis/epoch, not a timestamp |
| `checkpointId`, `signerIdentity`, `keyId` | Nonempty opaque ASCII identifiers |

Identifiers are case-sensitive, 1–128 bytes, using `[A-Za-z0-9._:@/-]` only.
Do not normalize, trim, coerce, or resolve identifiers as URLs/paths. Booleans
are not integers. An adapter maps its native indices into the logical sequence;
this draft does not redefine that source's hash chain or introduce a new Merkle
profile. The adapter must specify its empty-state hash and epoch derivation.

An implementation must reject duplicate JSON property names at decoding, values
outside I-JSON/RFC 8785, unsupported versions, unknown properties, wrong types,
out-of-range integers, and invalid digest/identifier syntax before cryptography
or source I/O. Apply a 2 MiB decoded UTF-8 limit and a nesting-depth limit of 32
to each complete bundle. In-memory APIs must likewise reject accessors, custom
prototypes and non-JSON properties. These are proposed profile admission rules;
the current core receipt validator is not a checkpoint schema validator.

## Bind the checkpoint using an unchanged v2 receipt

Canonicalize the complete checkpoint with the existing RFC 8785 implementation.
Create a normal v2 receipt with exactly one inline artifact, `checkpoint.json`,
whose bytes are that canonical UTF-8 string and whose MIME type is
`application/json`. Use the existing `createReceipt` / `create_receipt` with an
explicit Ed25519 key, key ID, and signer identity. Do not add a second detached
signature format. The existing receipt's RFC 6962 tree binds the complete
artifact record. `receipt.signature.signerIdentity` and `keyId` must exactly
match the checkpoint fields, and its algorithm must be `Ed25519`.

Use `task.name = "Retain external checkpoint"`, `task.status = "ATTESTED"`,
and `task.exitCode = 0`, with empty receipt metadata. Other required task and
environment values retain their existing v2 semantics. The task status and
receipt timestamps do not prove action success, key activation time, or age.

On verification, reuse the existing envelope validation and `verifyReceipt` /
`verify_receipt` with the independently resolved public key and explicit
`Ed25519` algorithm, with disk checks disabled. Require version `2.0.0`,
`valid`, `trusted`, `signatureChecked`, and `signatureValid`. Then recompute the
checkpoint's canonical digest and byte length, require exactly the reserved
artifact record and compare its name, MIME type, digest, and size. A valid
receipt for a different checkpoint is a binding failure. Do not read a path from
the receipt or treat receipt metadata as the authoritative checkpoint.

Enforce the prescribed task name, status and exit code, and require empty
metadata during profile admission; these are profile constraints, not optional
presentation conventions. Reject a different task/metadata shape as
`RECEIPT_PROFILE_MISMATCH`. Other existing required task/environment fields
still pass core validation. If the core result has `signatureValid: false`,
report `INVALID_SIGNATURE`. If its signature is valid but its Merkle/integrity
checks fail, report `RECEIPT_INTEGRITY_FAILURE`; never relabel a valid signature
as a cryptographic failure. Neither result permits source reads or acceptance.

Only after successful admission, key resolution, signature verification, and
binding may the explicitly configured adapter inspect protected evidence.
Adapters retain their source's containment and bounded-read controls.

## Operator-managed public trust bundle

The trust bundle has exactly these required properties:

```json
{
  "schema": "nymrel.checkpoint-trust-bundle",
  "version": "0.1.0",
  "bundleId": "operator-example",
  "revision": 1,
  "keys": [{
    "signerIdentity": "example-signer",
    "keyId": "example-key-1",
    "algorithm": "Ed25519",
    "publicKey": "<64 lowercase hex characters>",
    "state": "ACTIVE",
    "historicalCheckpointDigests": []
  }]
}
```

The placeholder is intentionally not valid key material. No private key, HMAC
secret, embedded trust URL, or self-declared root is permitted. The bundle uses
the same strict JSON/identifier rules as the checkpoint. `revision` is an integer
from 1 through 9,007,199,254,740,991. `keys` has 1–256 entries. Each key entry has
exactly the properties shown. Reject duplicate `(signerIdentity, keyId)` pairs,
duplicate public-key bytes, unsupported algorithms and malformed lifecycle
states. A pin mismatch is a trust-input failure, not an invalid checkpoint
signature. Hash the canonical bundle with existing `canonicalHash` /
`canonical_hash`; the digest pin must be independently supplied, not copied from
the same downloaded document.

`historicalCheckpointDigests` is an array of at most 1,024 unique checkpoint
digests in the `sha256:` syntax above. Its policy is deliberately independent of
signer-supplied timestamps:

| State | Acceptance policy in this draft |
| --- | --- |
| `ACTIVE` | Verify under the configured public key; the historical list must be empty. |
| `SUPERSEDED` | Accept only an exact checkpoint digest that the operator admitted independently before superseding the key and explicitly retained in this list. Report historical acceptance distinctly. An empty list permits none. |
| `REVOKED` | Reject all checkpoints under this key, including previously admitted ones; the historical list must be empty. This is explicit retroactive revocation. |

Supersession never makes an arbitrary old-looking signature acceptable. The
operator records admitted digests through its authenticated update process,
then publishes a new pinned bundle revision. A checkpoint digest on the list
still needs a valid signature, profile binding, the current checkpoint pin and
source comparison. Re-signing different content with an old key cannot enter
that list. Reusing identical public-key bytes under a new ID is rejected so it
cannot evade a revocation entry within a bundle. Operators must also preserve
revocation history when issuing later bundles.

Prospective revocation and timestamp-based historical acceptance are deferred;
they require independently trusted ordering/time evidence and a separately
reviewed version. An old, cryptographically valid bundle is insufficient when
its revision/digest differs from the verifier's current pin. Offline use proves
compliance with the supplied pinned policy, not that no newer revocation exists.

## Source comparison and result contract

The adapter must recompute the source epoch, number of valid contiguous events,
and the chain head or state hash at the checkpoint's exact prefix. It must
validate the underlying source's chain/state rules; copying a claimed head from
an untrusted footer or checking only row count is insufficient. A source adapter
that cannot prove a historical prefix returns unavailable, not a match.

Require the source protocol, version, ID, and epoch to match configured values
and the checkpoint. Fewer valid events than `eventCount` means truncation
relative to the retained checkpoint, including replacement with a shorter valid
chain. Equal count with a different recomputed head is a state mismatch.
Additional valid events are allowed only if the recomputed checkpoint prefix
matches; report the uncheckpointed suffix count separately.

**Unavoidable limit:** deleting only events appended after the last retained
checkpoint cannot be detected by that checkpoint. If the retained checkpoint
covers three events, evidence containing those same three events matches even
if an unretained fourth event once existed. A newer independently retained
checkpoint or another authenticated high-water mark is necessary. Interpret
issue 9's truncation acceptance relative to the checkpoint's covered prefix,
never as protection of an unknown later suffix.

The experimental core returns separate `admission`, `keyPolicy`,
`authentication`, `binding`, and `sourceComparison` results; unattempted stages
are `NOT_CHECKED`. It sets `accepted: true` only after every required stage
passes. Core receipt `valid` / `trusted` retain their existing meanings and
must not stand in for profile acceptance.

| Distinct result | Meaning |
| --- | --- |
| `MALFORMED_PROFILE` / `UNSUPPORTED_VERSION` | Strict structural admission failed. |
| `TRUST_BUNDLE_PIN_MISMATCH` / `CHECKPOINT_PIN_MISMATCH` | Independently retained input does not match; no fallback. |
| `UNKNOWN_KEY` | No unique configured identity/key entry exists. |
| `REVOKED_KEY` | Current pinned policy retroactively rejects the key. |
| `SUPERSEDED_NOT_ADMITTED` | Historical digest was never admitted by current policy. |
| `INVALID_SIGNATURE` | Signature checked with independently configured key and failed. |
| `RECEIPT_INTEGRITY_FAILURE` | Core receipt integrity failed, even if the signature over the retained root is valid. |
| `RECEIPT_PROFILE_MISMATCH` | Receipt task/metadata violates the checkpoint profile's prescribed values. |
| `INTEGRITY_ONLY` | No trusted key configuration was supplied; never accepted. |
| `CHECKPOINT_BINDING_MISMATCH` | Receipt and canonical checkpoint differ. |
| `SOURCE_IDENTITY_MISMATCH` / `SOURCE_EPOCH_MISMATCH` | Configured source identity or epoch differs. |
| `SOURCE_UNAVAILABLE` / `SOURCE_INVALID` | Adapter/evidence unavailable or source validation failed. |
| `TRUNCATED_RELATIVE_TO_CHECKPOINT` / `STATE_MISMATCH` | Protected prefix is shorter or changed. |
| `CHECKPOINT_MATCH` / `CHECKPOINT_PREFIX_MATCH` | Complete covered prefix matches, with suffix count explicit. |

Successful key policy is separately `ACTIVE` or
`HISTORICAL_SUPERSEDED_ALLOWED`; both still require all later stages. Keep
cryptographic failure, lifecycle rejection, and unavailable evidence distinct.

## Fixtures and implementation acceptance

The companion shared fixture is `test/fixtures/checkpoint-v0.1-vectors.json`.
It uses the public RFC 8032 test key already in the existing protocol vectors,
synthetic opaque source identifiers, an ordinary generated v2 receipt, and
canonical checkpoint/bundle hashes. Its source observations are proposed
adapter-output examples, not independently verified ledger evidence.

Matched fixture tests exercise the existing runtime primitives: canonical bytes
and hashes, public-only receipt authentication, checkpoint artifact binding,
wrong-key rejection, signed-metadata tampering, and integrity-only trust state.
The experimental core tests lifecycle and source-comparison behavior against synthetic adapter observations; they do not certify a real source adapter.

Before production adoption, review the strict schema, adapter mapping,
external pin update/recovery and the intentionally retroactive revocation
policy. Then require matched runtime regressions for every result above,
including duplicate-property rejection before I/O, superseded signing of new
content, stale-bundle/checkpoint rollback, empty source, same-length fork,
shorter replacement, epoch reset, valid extension, unavailable prefix evidence,
and undetectable deletion wholly beyond the checkpoint. Reuse the configured
release checks and independently review the exact source. No transparency
adapter is included; any later anchor must contain only the permitted digest
and inclusion proof, never private run contents or unrestricted metadata.

## Experimental core interface

Call `verifyCheckpoint(bundleJson, trustJson, options)` in TypeScript or
`verify_checkpoint(bundle_json, trust_json, *, bundle_pin, checkpoint_pin, source, adapter)`
in Python. Both inputs are JSON text, limited individually to 2 MiB and depth 32.
`bundlePin`/`bundle_pin` contains `bundleId`, `revision`, and `sha256`;
`source` contains `sourceProtocol`, `sourceVersion`, `sourceId`, and
`sourceEpochDigest`. These are independent trusted caller inputs, never chosen
from the bundle. Pin update, persistence, and recovery remain operator duties.

The adapter is called with a copy of the authenticated checkpoint only after
admission, key policy, signature/integrity checks, and binding succeed. It must
validate its source rules and return `status: VALID`, the configured source
identity and epoch fields, `eventCount` for the valid contiguous source, and
`prefixHash` recomputed at the requested checkpoint count. For a shorter valid
source, `prefixHash` may be absent. Return `status: UNAVAILABLE` when a source
or historical prefix cannot be read, or `status: INVALID` for invalid evidence.
An exception also means unavailable. The adapter is trusted code: the core
cannot determine whether it actually validated the source or computed the
prefix correctly. No actual source implementation is bundled.

The result contains stage values, `accepted`, and, for a successful comparison,
`suffixCount`. The interface does not establish signer authority, trusted time,
pin freshness, external persistence, or independent execution. The absence of
a retained newer checkpoint cannot reveal deletion of an uncheckpointed suffix.

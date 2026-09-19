# Nymrel Signal ProofReceipt profile

The Signal profile adds a customer-facing evidence envelope using the existing Proof Ledger v2 receipt protocol. Core legacy v1 wire behavior remains unchanged, but Signal does not accept v1 receipts.

## What is bound

`createSignalProofBundle()` / `create_signal_proof_bundle()` canonicalizes a `SignalProofEnvelopeV1` and includes it as the reserved artifact:

```text
signal-proof-envelope.json
```

The artifact digest is part of the existing Proof Ledger Merkle tree. The returned portable bundle carries both:

- the canonical Signal envelope payload; and
- the normal `ProofReceipt` containing its bound artifact digest.

The verifier recomputes the envelope bytes, hash, size and core Proof Ledger invariants. Signal identity and scopes are read from the bound envelope, never from `receipt.metadata`.

## What the envelope contains

- Signal receipt ID and schema/profile version
- optional Need Drop and challenge IDs
- claim and disclosure snapshot digests
- explicit attested scopes
- observer and optional evaluator declarations
- public/private/restricted evidence references
- material limitations

Supported scopes are deliberately narrow:

- `artifact_integrity`
- `execution_observed`
- `timing_observed`
- `price_source_checked`
- `outcome_rubric_replayed`
- `identity_verified`

A scope is an attestation claim. Applications remain responsible for establishing whether the signer had authority to make it.

## What a valid proof does not prove

Cryptographic validity does not establish:

- subjective product quality or universal customer fit;
- testimonial neutrality or absence of bias;
- signer identity or authority without a trusted public-key resolution policy;
- any scope that is absent from the envelope; or
- publication permission for private or restricted evidence.

The verifier returns a `doesNotProve` list and keeps `signerIdentityTrust` at `unresolved`. A product UI must not replace these field-level semantics with a blanket **Verified** badge.

## HMAC and Ed25519

The verification result distinguishes:

- `shared_secret_integrity` for HMAC-SHA256; and
- `asymmetric_signature` for Ed25519.

HMAC can establish integrity inside a shared trust domain. It is not independently reproducible public verification because the verifier needs the shared secret.

Ed25519 permits public signature verification, but a public key still needs an external, trusted resolution and revocation policy before the application can claim who controls it.

## TypeScript example

```ts
import {
  ProofSigner,
  createSignalProofBundle,
  verifySignalProofBundle,
} from '@nymrel/proof-ledger';

const keys = ProofSigner.generateKeyPair();

const bundle = await createSignalProofBundle({
  envelope: {
    profile: 'nymrel-signal-proof-receipt',
    profileVersion: '1.0.0',
    signalReceiptId: 'receipt_123',
    needDropId: 'need_123',
    challengeId: 'challenge_123',
    claimSnapshotDigest: `sha256:${'a'.repeat(64)}`,
    disclosureSnapshotDigest: `sha256:${'b'.repeat(64)}`,
    attestedScopes: ['artifact_integrity', 'execution_observed'],
    observer: {
      kind: 'system',
      id: 'signal-runner',
      observedAt: new Date().toISOString(),
      method: 'screen-recorded run',
    },
    evidence: [
      { ref: 'artifact://public-output', privacy: 'public' },
      { ref: 'artifact://private-input', privacy: 'private' },
    ],
    limitations: ['Result applies only to the declared task and environment.'],
  },
  task: {
    name: 'Signal Proof Challenge',
    status: 'ATTESTED',
  },
  artifacts: [{ path: 'output.json', data: '{"status":"complete"}' }],
  signingKey: keys.privateKey,
  signerIdentity: 'declared-signal-verifier',
  algorithm: 'Ed25519',
});

const result = await verifySignalProofBundle(bundle, {
  expectedAlgorithm: 'Ed25519', publicKeyOrSecret: keys.publicKey,
});

if (!result.valid) {
  throw new Error(result.errors.join('; '));
}
```

## Python example

```python
from nymrel_proof_ledger import (
    ProofSigner,
    create_signal_proof_bundle,
    verify_signal_proof_bundle,
)

keys = ProofSigner.generate_key_pair()

bundle = create_signal_proof_bundle(
    envelope={
        "profile": "nymrel-signal-proof-receipt",
        "profileVersion": "1.0.0",
        "signalReceiptId": "receipt_123",
        "claimSnapshotDigest": "sha256:" + "a" * 64,
        "disclosureSnapshotDigest": "sha256:" + "b" * 64,
        "attestedScopes": ["artifact_integrity", "execution_observed"],
        "observer": {
            "kind": "system",
            "id": "signal-runner",
            "observedAt": "2026-08-21T22:00:00Z",
        },
        "evidence": [],
    },
    task={"name": "Signal Proof Challenge", "status": "ATTESTED"},
    signing_key=keys["privateKey"],
    signer_identity="declared-signal-verifier",
    algorithm="Ed25519",
)

result = verify_signal_proof_bundle(
    bundle,
    expected_algorithm='Ed25519', public_key_or_secret=keys["publicKey"],
)
assert result["valid"]
```

## Metadata is not authoritative

Signal requires Proof Ledger v2 receipts. Legacy v1 cannot authenticate the artifact label or metadata mirror and is rejected even when its core signature is valid. The profile mirrors selected fields under `metadata.signalProfile` only for convenience; consumers derive Signal values from the bound envelope. A mismatch between that mirror and the bound envelope is a profile validation error.

Consumers must never use metadata-only Signal IDs or scopes as verified values.

## Portable verification and disk checks

The portable bundle verifier validates the in-memory envelope against the bound artifact digest. The core `checkFilesOnDisk` option still checks every receipt artifact by path. Enable it only when the reserved envelope and all other artifacts have been materialized in the chosen `cwd`; otherwise use portable envelope validation plus separate application-controlled artifact retrieval.

Signal first verifies core cryptography and profile/envelope binding with disk I/O disabled. It performs requested disk checks only after those checks pass. Failed admission reports zero checked artifacts. `authoritative` fields are populated only for structurally valid bundles; consumers must still require `valid` for authenticated acceptance. Unkeyed structural inspection never establishes signer identity or authority.

## Versioning and release boundary

- Unknown Signal profile and bundle major versions fail closed.
- The profile does not alter existing `ProofReceipt` v1 leaf or signature construction.
- Malformed JSON-shaped bundles, receipts and noncanonical envelope values return structured invalid results. This does not promise safe execution of arbitrary JavaScript proxies/getters or arbitrary Python objects.
- No package publication is implied by merging the source change. npm/PyPI publication and `v*` tags remain separate release decisions.
- V2 already binds metadata through its signed payload; Signal additionally validates the envelope artifact and convenience mirror. Both runtimes offer explicit Git-context opt-in on creation, disabled by default.

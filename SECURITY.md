# Security Policy

## Reporting a vulnerability

Send a concise report to contact@nymrel.com with the affected version, impact,
reproduction steps, and any proposed mitigation. Do not include production
private keys, secrets, customer data, or exploit payloads that could harm a
third party. Request an encrypted channel before sending sensitive details.

Nymrel will acknowledge and triage reports as operating capacity allows. Public
disclosure should be coordinated after a fix and affected-user guidance exist.

## Supported protocol eras

- Protocol 2.0.0 is the current emission format.
- Protocol 1.0.0 is accepted for legacy verification only.
- Unsupported versions fail envelope validation.

The repository is source-only at present; no npm or PyPI release is claimed by
this policy.

## Security boundaries

Proof Ledger establishes receipt integrity and, when a trusted verification key
is supplied, signature authenticity. It does not establish:

- that the signer was authorized to perform the underlying action
- that key custody, rotation, revocation, or identity proofing is correct
- that a displayed badge has been independently verified
- that a reserved web verification URL is live
- that artifact content is safe to execute

Use valid true plus trusted true for authenticated gates. A result with trusted
false is an integrity-only check.

## Cryptographic design

- RFC 8785 canonicalization rejects values outside the I-JSON model.
- RFC 6962 leaf and interior domains are separated with 0x00 and 0x01.
- Odd RFC 6962 nodes are promoted; they are not duplicated.
- HMAC comparisons use timing-safe comparison primitives.
- Python Ed25519 uses PyCA cryptography.
- TypeScript Ed25519 uses Node.js crypto.
- Raw Ed25519 keys must be exactly 32 bytes encoded as 64 hexadecimal
  characters.
- Protocol v2 signatures bind signer metadata and a canonical metadata digest
  in addition to the receipt root and identity fields.
- Protocol v1 behavior is isolated behind explicit legacy profiles.

## Filesystem safety

Disk verification treats receipt paths as untrusted. Paths are resolved against
the requested verification root, real paths are checked to account for
symlinks, and reads outside that root are refused.

Git remotes recorded in receipts are sanitized. URL user information, query
strings, and fragments are removed; unsafe local paths are omitted.

## Dependency policy

The Node.js runtime has no production dependencies. The Python runtime uses:

- cryptography for audited Ed25519 primitives
- rfc8785 for standards-correct cross-runtime canonicalization

Dependency updates must retain the shared cryptographic vectors, pass the full
runtime matrix, and receive security-audit review.

## Key custody

Do not place production keys in source control, command history, receipts,
badges, or logs. HMAC keys are symmetric and should not be distributed as
public verification material. Prefer Ed25519 when verifiers must not gain
signing capability. Obtain public keys through an authenticated channel.

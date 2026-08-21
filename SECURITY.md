# Security Policy

## Reporting Security Vulnerabilities

Nymrel and JalenBuilds LLC take cryptographic protocol security seriously. If you discover a potential vulnerability or weakness within `@nymrel/proof-ledger` or `nymrel_proof_ledger`, please report it promptly.

### Contact

- **Primary Contact:** `security@jalenbuilds.com` or `contact@nymrel.com`
- **PGP / Sensitive Inquiries:** Please request our security team's public key before transmitting unencrypted vulnerability details.

### Scope

The following components are in scope:
- **Merkle Tree Implementation:** Resistance against second-preimage attacks, RFC 6962 domain separation (leaf `0x00` and node `0x01` prefixes), and audit path verification correctness.
- **Canonical Serialization:** Determinism of RFC 8785 canonical JSON generation across platforms.
- **Signer Engine:** Timing-attack resistance of HMAC-SHA256 verification (`crypto.timingSafeEqual` / `hmac.compare_digest`) and Ed25519 asymmetric curve verification.
- **Receipt Validation:** Tamper-proofing of execution hashes and environment anchoring.

### Response Timeline

- **Initial Response:** Within 24 hours.
- **Triage & Status Update:** Within 48 hours.
- **Remediation & Advisory Release:** Coordinated disclosure after fix validation.

---
*Parent Organization: Nymrel -> JalenBuilds LLC*

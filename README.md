# Nymrel Proof Ledger (`@nymrel/proof-ledger` / `nymrel_proof_ledger`)

<p align="center">
  <img src="https://img.shields.io/badge/nymrel%20proof-verified%20%E2%9C%93-2A332E?style=for-the-badge&labelColor=1C2320" alt="Nymrel Verified"/>
  <img src="https://img.shields.io/badge/dependencies-0%20runtime-A8541F?style=for-the-badge&labelColor=1C2320" alt="Zero Dependencies"/>
  <img src="https://img.shields.io/badge/language-TypeScript%20%2B%20Python-FAF8F2?style=for-the-badge&labelColor=2A332E" alt="Dual Language"/>
  <img src="https://img.shields.io/badge/license-MIT-E2DDD5?style=for-the-badge&labelColor=1C2320" alt="MIT License"/>
</p>

> **Zero-dependency, dual-language (TypeScript/Node.js + Python) cryptographic attestation and proof-of-execution protocol library and CLI.**
> Prove what ran, what it produced, and that nothing changed since — then let anyone else verify it independently.

---

## ⚡ 60-Second Quickstart

> **Install today:** the `@nymrel/proof-ledger` npm / `nymrel-proof-ledger` PyPI packages are rolling out. Until they resolve on your registry, install from source:
> ```bash
> git clone https://github.com/nymrel/nymrel-proof-ledger && cd nymrel-proof-ledger
> ```
> then run the CLI from the repo root (`node bin/proof-ledger.js …` or `python -m proof_ledger …`). The steps below work unchanged against the local install.

```bash
# 1. Install (either runtime — receipts are cross-verifiable)
npm install @nymrel/proof-ledger      # or: pip install nymrel-proof-ledger

# 2. Generate a signing key
npx proof-ledger keygen --algo HMAC-SHA256 --out secret.key

# 3. Attest an execution: hashes your files into an RFC 6962 Merkle tree and signs them
npx proof-ledger attest \
  --task "Production Release Build" \
  --files "dist/index.js,package.json" \
  --key-file secret.key \
  --signer "ci-bot-01" \
  --out proof.json \
  --badge badge.svg

# 4. Verify it (exit code 0 = trusted; wire this into CI to gate deploys)
npx proof-ledger verify proof.json --key-file secret.key --check-files
```

That's a complete proof: task metadata, environment, git lineage, and artifact hashes,
Merkle-committed and signed — plus an SVG badge you can embed anywhere.

---

## 🤝 Verifying a Proof Left by Someone Else

This is what the protocol is built for: **the producer and the verifier don't have to be
the same machine, runtime, or even organization.**

### The one rule to remember

| You have | What you can prove |
| :--- | :--- |
| Just `proof.json` | **Integrity** — the Merkle math is internally consistent and untampered |
| + producer's **public key** (Ed25519) | **Authenticity** — the producer signed exactly this proof |
| + producer's **secret** (HMAC) | Authenticity — but you could also forge proofs, so prefer Ed25519 for third parties |

### Walkthrough: Alice produces, Bob verifies

**Alice (producer)** attests her build with Ed25519 so she never shares signing power:

```bash
npx proof-ledger keygen --algo Ed25519 --out alice.key          # contains privateKey + publicKey
npx proof-ledger attest --task "nightly-build" \
  --files "dist/app.js" --algo Ed25519 \
  --key-file alice.key --out proof.json
# Alice ships proof.json (+ the artifacts) and publishes alice.key's publicKey
```

**Bob (verifier)** — a different person, machine, or runtime entirely:

```bash
# Integrity check, no key needed: Merkle root recomputation + structure validation
npx proof-ledger verify proof.json

# Full verification once Bob has Alice's public key
npx proof-ledger verify proof.json --key-file alice-public.key
```

Or programmatically, cross-runtime (proof produced by the Node CLI, verified in Python):

```python
from nymrel_proof_ledger import validate_receipt_envelope, verify_receipt
import json

with open("proof.json", encoding="utf-8") as f:
    receipt = json.load(f)

envelope = validate_receipt_envelope(receipt)   # protocol/version/schema gate
assert envelope["valid"], envelope["errors"]

result = verify_receipt(receipt, public_key_or_secret="<alice-public-key-hex>")
print("Trusted:", result["valid"])              # False = tampered or forged
```

`verify` exits non-zero on any failure, so `proof-ledger verify proof.json --key-file ...`
is a drop-in CI gate. Receipts carry a versioned envelope (`nymrel-proof-ledger` / `1.0.0`)
validated identically in both runtimes, so a TypeScript-produced proof verifies byte-for-byte
in Python and vice versa.

---

## 📋 Feature Examples (copy-paste)

### Attest an execution

```typescript
import { attestExecution, ProofLedger } from '@nymrel/proof-ledger';

const secretKey = ProofLedger.generateSecretKey();

const receipt = await attestExecution({
  task: { name: 'Core Security Suite', status: 'SUCCESS', exitCode: 0 },
  artifacts: [{ path: 'dist/app.bundle.js' }, { path: 'reports/security.json' }],
  signingKey: secretKey,
  signerIdentity: 'nymrel-security-agent',
});

console.log('Proof ID:', receipt.proofId);
console.log('Merkle Root:', receipt.merkle.root);
```

```python
from nymrel_proof_ledger import attest_execution, ProofSigner

secret_key = ProofSigner.generate_secret_key()

receipt = attest_execution(
    task={"name": "ETL Pipeline Execution", "status": "SUCCESS", "exitCode": 0},
    artifacts=[{"path": "data/processed_transactions.parquet"}],
    signing_key=secret_key,
    signer_identity="etl-daemon",
)
```

### Verify a receipt

```typescript
import { verifyProof } from '@nymrel/proof-ledger';

const verification = await verifyProof(receipt, {
  publicKeyOrSecret: secretKey,   // omit to check integrity only
  checkFilesOnDisk: true,         // re-hash artifacts against the committed Merkle leaves
});

if (verification.valid) {
  console.log('✓ Cryptographic attestation verified');
} else {
  console.log('Errors:', verification.errors);
}
```

```python
from nymrel_proof_ledger import verify_proof

result = verify_proof(receipt, public_key_or_secret=secret_key, check_files_on_disk=True)
print("Valid:", result["valid"], "| Errors:", result["errors"])
```

### Embed a proof badge

```bash
# Full SVG card, compact card, GitHub-style shield, or HTML certificate
npx proof-ledger badge proof.json --format svg    --out badge.svg
npx proof-ledger badge proof.json --format shield --out shield.svg
npx proof-ledger badge proof.json --format html   --out certificate.html
```

Commit the generated file and drop it into any README or page:

```markdown
![verified build](./shield.svg)
```

```html
<iframe src="certificate.html" width="480" height="640" style="border:0"></iframe>
```

Every badge is a single self-contained SVG/HTML file — vector QR code included, no external
assets, no JavaScript, no tracking.

---

## 🌍 Language & Runtime Coverage

**Works today:**

| Runtime | Library | CLI | Status |
| :--- | :--- | :--- | :--- |
| Node.js ≥ 18 (TypeScript) | ✅ Full API | ✅ `proof-ledger` | Production-ready, zero runtime deps |
| Python ≥ 3.9 | ✅ Full API | ✅ `proof-ledger-py` | Production-ready, zero runtime deps |

- Both engines implement the identical protocol (`nymrel-proof-ledger` v1.0.0): RFC 6962
  Merkle trees, RFC 8785 canonical JSON, HMAC-SHA256 + Ed25519 signatures, envelope
  validation, SVG/HTML badges. A receipt from either runtime verifies in the other
  (enforced by a dedicated cross-parity test suite).
- **Ed25519 key encodings differ between runtimes** (Node uses PEM via `node:crypto`;
  Python uses raw hex seeds per RFC 8032). Signatures cross-verify, but key *material* is
  not directly portable — generate keys with the runtime that will sign. HMAC-SHA256 hex
  secrets work identically in both.
- Not available today: browser/WASM builds, bindings for other languages (Rust, Go, Java),
  and a hosted verification gateway. Badge QR codes encode a verification URL
  (`https://proofs.nymrel.com/v/:proofId`) reserved for a future service; offline
  verification with this library/CLI is the supported path today.

---

## 🔒 Cryptographic Architecture

```
                       ┌────────────────────────────────────────┐
                       │          EXECUTION CONTEXT             │
                       │ Task Metadata + Git Lineage + Env Hash │
                       └───────────────────┬────────────────────┘
                                           │
 ┌──────────────────────┐                  │                 ┌──────────────────────┐
 │ Artifact 1 (SHA-256) │                  │                 │ Artifact 2 (SHA-256) │
 └──────────┬───────────┘                  │                 └──────────┬───────────┘
            │                              │                            │
            ▼                              ▼                            ▼
   H(0x00 || Leaf_1)              H(0x00 || Leaf_2)            H(0x00 || Leaf_3)
            │                              │                            │
            └──────────────┬───────────────┘                            │
                           ▼                                            │
               H(0x01 || Node_L || Node_R)                              │
                           │                                            │
                           └──────────────────────┬─────────────────────┘
                                                  ▼
                                     ┌─────────────────────────┐
                                     │    MERKLE ROOT (32B)    │
                                     └────────────┬────────────┘
                                                  │
                                                  ▼  Canonical RFC 8785 Payload
                                     ┌─────────────────────────┐
                                     │  CRYPTOGRAPHIC SIGNER   │
                                     │   (HMAC-SHA256/Ed25519) │
                                     └────────────┬────────────┘
                                                  │
                                                  ▼
                                     ┌─────────────────────────┐
                                     │       PROOF.JSON        │
                                     │  + Standalone SVG/HTML  │
                                     └─────────────────────────┘
```

### Core Cryptographic Invariants
- **Domain-Separated Merkle Trees (RFC 6962):** Leaves are hashed as `SHA-256(0x00 || data)` and interior nodes as `SHA-256(0x01 || left || right)`. This provably defends against second-preimage collision attacks.
- **Canonical JSON Serialization (RFC 8785):** Guarantees exact byte-for-byte serialization and hashing parity across TypeScript and Python runtimes regardless of key insertion order.
- **Dual Signing Engines:** Symmetric **HMAC-SHA256** (constant-time verification) and asymmetric **Ed25519** (pure-python RFC 8032 and Node.js `node:crypto`).
- **100% Zero Runtime Dependencies:** Standard library only (`node:crypto` / Python `hashlib` & `hmac`).

---

## 🖥️ CLI Reference

```bash
proof-ledger <command> [options]

attest    Generate cryptographic attestation receipt for task and files
verify    Verify Merkle root, artifact hashes, and signature of a proof.json
badge     Generate SVG badge, shield, or HTML certificate from a proof.json
inspect   Pretty-print audit trail and cryptographic details in terminal
keygen    Generate HMAC-SHA256 secret or Ed25519 keypair
export    Export proof as Markdown audit report, JSON-LD, or HTML certificate
```

Key files written by `keygen` (JSON envelopes) are accepted directly by
`--key-file` on `attest` and `verify`; plain-text key files work too.
Python users: same commands via `proof-ledger-py`.

---

## 🎨 Visual Proof Badges (Nymrel Aesthetics)

| Token | Hex Code | Usage |
| :--- | :--- | :--- |
| **Warm Cream** | `#FAF8F2` | Card surface and canvas background |
| **Warm Paper** | `#F4F0E6` | Gradient depth and container fill |
| **Cedar Green** | `#2A332E` | Verified status pill and primary headers |
| **Terracotta** | `#A8541F` | Hash highlights and warning accents |
| **Stone Slate** | `#1C2320` | High-contrast typography and QR code modules |
| **Warm Linen** | `#E2DDD5` | Card borders and divider rules |

Every badge renders a pure-vector QR code encoding the verification URI (`https://proofs.nymrel.com/v/:proofId`) with zero third-party canvas or bitmap dependencies.

---

## 📂 Repository Structure

```
nymrel-proof-ledger/
├── bin/
│   ├── proof-ledger.js          # Node.js executable wrapper
│   └── proof-ledger             # Unix shell executable
├── src/                         # TypeScript Engine (Zero runtime deps)
│   ├── index.ts                 # Main Public API & ProofLedger class
│   ├── cli.ts                   # Multi-command CLI tool
│   ├── core/
│   │   ├── canonical.ts         # RFC 8785 Canonical JSON (JCS)
│   │   ├── envelope.ts          # Portable receipt envelope validator
│   │   ├── merkle.ts            # RFC 6962 Domain-Separated Merkle Tree
│   │   ├── signer.ts            # HMAC-SHA256 & Ed25519 Signers
│   │   └── receipt.ts           # Proof receipt generator & validator
│   └── visual/
│       ├── qr.ts                # Zero-dependency QR matrix synthesizer
│       └── badge.ts             # SVG & HTML badge generator
├── python/                      # Python Engine (Zero runtime deps)
│   └── nymrel_proof_ledger/
│       ├── __init__.py          # Python Public API
│       ├── canonical.py         # RFC 8785 Canonical JSON
│       ├── envelope.py          # Portable receipt envelope validator
│       ├── merkle.py            # RFC 6962 Domain-Separated Merkle Tree
│       ├── signer.py            # HMAC & pure-python Ed25519
│       ├── receipt.py           # Proof receipt generator & validator
│       ├── qr.py                # Zero-dependency QR synthesizer
│       ├── badge.py             # SVG & HTML badge generator
│       └── cli.py               # Python CLI runner (proof-ledger-py)
├── test/
│   ├── ts/                      # Node.js test suite (node:test)
│   │   ├── run-tests.ts         # Test discovery runner
│   │   ├── canonical.test.ts
│   │   ├── merkle.test.ts
│   │   ├── signer.test.ts
│   │   ├── receipt.test.ts
│   │   ├── envelope.test.ts
│   │   ├── badge.test.ts
│   │   └── cli.test.ts
│   └── python/                  # Python unittest suite
│       ├── test_merkle.py
│       ├── test_signer.py
│       ├── test_receipt.py
│       ├── test_envelope.py
│       ├── test_badge.py
│       ├── test_keyfile.py      # Key-file loading regression tests
│       └── test_cross_parity.py # Exact TS/Python mathematical parity
├── .github/workflows/publish.yml  # npm & PyPI release automation (OIDC provenance)
├── package.json
├── tsconfig.json
├── pyproject.toml
├── setup.py
├── llms.txt                     # Autonomous AI Discoverability
├── SECURITY.md
├── CONTRIBUTING.md
└── LICENSE                      # MIT License
```

---

## 🧪 Testing & Verification

### Running TypeScript Tests
```bash
npm run build
npm test
```

### Running Python Tests
```bash
python -m unittest discover -s test/python -p "test_*.py"
```

### Cross-Language Mathematical Parity Test
Ensures identical Merkle Roots, Canonical JSON stringification, and HMAC digests across both engines.

---

## 📄 License & Attribution

MIT License © 2026 **Nymrel / JalenBuilds LLC**  
Operating Contact: `contact@nymrel.com` • [nymrel.com](https://nymrel.com)

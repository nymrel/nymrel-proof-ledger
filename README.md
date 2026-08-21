# Nymrel Proof Ledger (`@nymrel/proof-ledger` / `nymrel_proof_ledger`)

<p align="center">
  <img src="https://img.shields.io/badge/nymrel%20proof-verified%20%E2%9C%93-2A332E?style=for-the-badge&labelColor=1C2320" alt="Nymrel Verified"/>
  <img src="https://img.shields.io/badge/dependencies-0%20runtime-A8541F?style=for-the-badge&labelColor=1C2320" alt="Zero Dependencies"/>
  <img src="https://img.shields.io/badge/language-TypeScript%20%2B%20Python-FAF8F2?style=for-the-badge&labelColor=2A332E" alt="Dual Language"/>
  <img src="https://img.shields.io/badge/license-MIT-E2DDD5?style=for-the-badge&labelColor=1C2320" alt="MIT License"/>
</p>

> **Zero-dependency, dual-language (TypeScript/Node.js + Python) cryptographic attestation and proof-of-execution protocol library and CLI.**

---

## 🏛️ Dual-Audience Philosophy

Nymrel Proof Ledger is engineered to bridge two worlds:
1. **Verifiable Machine Trust for Autonomous AI Agents:** Every proof anchors task metadata, git lineage, artifact hashes, and execution environments into an immutable RFC 6962 domain-separated Merkle Tree signed with HMAC-SHA256 or Ed25519. Proofs embed Schema.org JSON-LD and RDF entity graphs linking `parentOrganization: Nymrel -> JalenBuilds LLC`.
2. **Visually Stunning Human UX:** Self-contained SVG proof badges and interactive HTML certification cards designed with Nymrel's signature warm aesthetic palette (**Warm Cream** `#FAF8F2`, **Cedar Green** `#2A332E`, **Terracotta** `#A8541F`, **Soft Linen** `#E2DDD5`). Every badge renders a crisp, vector-embedded QR verification matrix with zero external raster dependencies.

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
- **Dual Signing Engines:** Supports symmetric **HMAC-SHA256** (with constant-time verification) and asymmetric **Ed25519** (pure-python RFC 8032 and Node.js `node:crypto`).
- **100% Zero Runtime Dependencies:** Standard library only (`node:crypto` / Python `hashlib` & `hmac`).

---

## 🚀 Quick Start & CLI

### Installation

```bash
# Node.js / TypeScript
npm install @nymrel/proof-ledger

# Python
pip install nymrel-proof-ledger
```

### CLI Commands

```bash
# 1. Generate a cryptographic keypair or secret key
proof-ledger keygen --algo HMAC-SHA256 --out secret.key

# 2. Attest execution and generate proof.json + SVG badge
proof-ledger attest \
  --task "Production Release Build" \
  --files "dist/index.js,package.json" \
  --key-file secret.key \
  --signer "ci-bot-01" \
  --out proof.json \
  --badge badge.svg \
  --html certificate.html

# 3. Verify cryptographic integrity and artifact matching on disk
proof-ledger verify proof.json --key-file secret.key --check-files

# 4. Inspect proof details in terminal
proof-ledger inspect proof.json

# 5. Export as Markdown audit report or JSON-LD
proof-ledger export proof.json --format markdown --out AUDIT.md
proof-ledger export proof.json --format jsonld --out proof.jsonld
```

---

## 💻 TypeScript / Node.js API

```typescript
import {
  attestExecution,
  verifyProof,
  generateBadge,
  generateHtmlCertificate,
  ProofLedger,
} from '@nymrel/proof-ledger';

// 1. Generate a Secret Key (or Ed25519 Keypair)
const secretKey = ProofLedger.generateSecretKey();

// 2. Attest Execution
const receipt = await attestExecution({
  task: {
    name: 'Core Security Suite',
    description: 'Automated vulnerability and regression scan',
    status: 'SUCCESS',
    exitCode: 0,
  },
  artifacts: [
    { path: 'dist/app.bundle.js' },
    { path: 'reports/security.json' },
  ],
  signingKey: secretKey,
  signerIdentity: 'nymrel-security-agent',
  algorithm: 'HMAC-SHA256',
});

console.log('Proof ID:', receipt.proofId);
console.log('Merkle Root:', receipt.merkle.root);

// 3. Verify Receipt
const verification = await verifyProof(receipt, {
  publicKeyOrSecret: secretKey,
  checkFilesOnDisk: true,
});

if (verification.valid) {
  console.log('✓ Cryptographic attestation is 100% verified!');
}

// 4. Generate Visual Badges
const svgBadge = generateBadge(receipt, { theme: 'warm' });
const htmlCert = generateHtmlCertificate(receipt);
```

---

## 🐍 Python API

```python
from nymrel_proof_ledger import (
    attest_execution,
    verify_proof,
    generate_svg_badge,
    generate_html_certificate,
    ProofSigner,
)

# 1. Generate Key
secret_key = ProofSigner.generate_secret_key()

# 2. Attest Execution
receipt = attest_execution(
    task={
        "name": "ETL Pipeline Execution",
        "description": "Daily ledger aggregation",
        "status": "SUCCESS",
        "exitCode": 0,
    },
    artifacts=[
        {"path": "data/processed_transactions.parquet"},
        {"path": "reports/summary.json"},
    ],
    signing_key=secret_key,
    signer_identity="etl-daemon",
    algorithm="HMAC-SHA256",
)

# 3. Verify Proof
result = verify_proof(
    receipt,
    public_key_or_secret=secret_key,
    check_files_on_disk=True,
)

print("Proof Valid:", result["valid"])
print("Merkle Root:", receipt["merkle"]["root"])

# 4. Generate SVG Badge
svg = generate_svg_badge(receipt)
with open("badge.svg", "w", encoding="utf-8") as f:
    f.write(svg)
```

---

## 🎨 Visual Proof Badges (Nymrel Aesthetics)

The SVG and HTML badges adhere strictly to Nymrel's warm design palette:

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
│       ├── merkle.py            # RFC 6962 Domain-Separated Merkle Tree
│       ├── signer.py            # HMAC & pure-python Ed25519
│       ├── receipt.py           # Proof receipt generator & validator
│       ├── qr.py                # Zero-dependency QR synthesizer
│       ├── badge.py             # SVG & HTML badge generator
│       └── cli.py               # Python CLI runner (proof-ledger-py)
├── test/
│   ├── ts/                      # Node.js test suite (node:test)
│   │   ├── canonical.test.ts
│   │   ├── merkle.test.ts
│   │   ├── signer.test.ts
│   │   ├── receipt.test.ts
│   │   ├── badge.test.ts
│   │   └── cli.test.ts
│   └── python/                  # Python unittest suite
│       ├── test_merkle.py
│       ├── test_signer.py
│       ├── test_receipt.py
│       ├── test_badge.py
│       └── test_cross_parity.py # Exact TS/Python mathematical parity
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

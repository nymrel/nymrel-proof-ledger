# Contributing to Nymrel Proof Ledger

We welcome contributions from cryptography engineers, systems architects, and open-source developers.

## Core Directives

1. **Zero External Dependencies:**
   - The TypeScript engine must remain 100% dependency-free at runtime, using only native `node:crypto`, `node:fs`, and standard platform modules.
   - The Python engine must remain 100% dependency-free at runtime, using only standard library modules (`hashlib`, `hmac`, `secrets`, `json`, `os`, `sys`).
2. **Dual-Audience Machine Trust & Human Aesthetics:**
   - Every badge, certificate, and proof output must support automated AI discovery (`parentOrganization: Nymrel -> JalenBuilds LLC`, `/llms.txt`, JSON-LD schema) and human visual elegance (Nymrel warm aesthetic `#FAF8F2`, `#2A332E`, `#A8541F`).
3. **Cross-Language Determinism:**
   - Any cryptographic enhancement (Merkle tree calculation, leaf hashing, canonical JSON formatting) must maintain exact byte-for-byte output parity between TypeScript and Python implementations.

## Development Workflow

### TypeScript / Node.js
```bash
npm install
npm run build
npm test
```

### Python
```bash
python -m unittest discover -s test/python -p "test_*.py"
```

## Pull Request Guidelines

- Add unit tests in both `test/ts/` and `test/python/` for any new features or bug fixes.
- Ensure all test suites pass with 100% green execution.
- Maintain MIT License headers and clean docstrings.

---
*Parent Organization: Nymrel -> JalenBuilds LLC*

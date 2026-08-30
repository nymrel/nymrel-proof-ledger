#!/usr/bin/env node
/**
 * CLI Driver for @nymrel/proof-ledger.
 *
 * Commands:
 *   attest   - Generate cryptographic attestation receipt and optional visual badges.
 *   verify   - Verify proof receipt integrity, Merkle tree, and signatures.
 *   badge    - Generate SVG / HTML badges from an existing proof receipt.
 *   inspect  - Display a formatted, human-readable terminal inspection of a proof.
 *   keygen   - Generate cryptographic keys (HMAC-SHA256 secret or Ed25519 keypair).
 *   export   - Export proof receipt as Markdown report, JSON-LD, or HTML certificate.
 *
 * @module @nymrel/proof-ledger/cli
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createReceipt, verifyReceipt, type ProofReceipt } from './core/receipt.js';
import { generateSvgBadge, generateShieldSvg, generateHtmlCertificate } from './visual/badge.js';
import { ProofSigner, type SignatureAlgorithm } from './core/signer.js';

function printHelp(): void {
  console.log(`
\x1b[1m\x1b[32mNYMREL PROOF LEDGER CLI\x1b[0m (v2.0.0)
Cryptographic Attestation & Proof-of-Execution Protocol
Parent Organization: Nymrel

\x1b[1mUSAGE:\x1b[0m
  proof-ledger <command> [options]

\x1b[1mCOMMANDS:\x1b[0m
  \x1b[33mattest\x1b[0m    Generate cryptographic attestation receipt for task and files
  \x1b[33mverify\x1b[0m    Verify Merkle root, artifact hashes, and signature of a proof.json
  \x1b[33mbadge\x1b[0m     Generate SVG badge, shield, or HTML certificate from a proof.json
  \x1b[33minspect\x1b[0m   Pretty-print audit trail and cryptographic details in terminal
  \x1b[33mkeygen\x1b[0m    Generate HMAC-SHA256 secret or Ed25519 keypair
  \x1b[33mexport\x1b[0m    Export proof as Markdown audit report, JSON-LD, or HTML certificate

\x1b[1mOPTIONS:\x1b[0m
  --help, -h       Show this help message
  --version, -v    Show version number

\x1b[1mEXAMPLES:\x1b[0m
  $ proof-ledger keygen --algo HMAC-SHA256
  $ proof-ledger attest --task "Build and Test" --files "dist/index.js,README.md" --key "secret123" --out proof.json --badge badge.svg
  $ proof-ledger verify proof.json --key "secret123" --check-files
  $ proof-ledger inspect proof.json
  $ proof-ledger badge proof.json --format svg --out badge.svg
  $ proof-ledger export proof.json --format markdown --out AUDIT_REPORT.md
`);
}

interface ParsedArgs {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Reads a flag value trying multiple spellings (kebab-case and camelCase),
 * because parseArgs stores flag names verbatim as typed by the user.
 */
function getFlag(parsed: ParsedArgs, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = parsed.flags[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Loads signing key material from a file.
 *
 * Supports both plain-text key files and the JSON envelopes written by
 * `proof-ledger keygen`:
 *   - HMAC-SHA256: { "algorithm": "HMAC-SHA256", "secretKey": "<hex>" }
 *   - Ed25519:     { "algorithm": "Ed25519", "privateKey": "...", "publicKey": "..." }
 */
async function loadKeyMaterial(keyFile: string, role: 'sign' | 'verify'): Promise<string> {
  const raw = (await fs.readFile(path.resolve(keyFile), 'utf8')).trim();
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const secretKey = parsed.secretKey;
      const privateKey = parsed.privateKey;
      const publicKey = parsed.publicKey;
      if (typeof secretKey === 'string' && secretKey.length > 0) return secretKey;
      if (role === 'sign' && typeof privateKey === 'string' && privateKey.length > 0) return privateKey;
      if (role === 'verify') {
        if (typeof publicKey === 'string' && publicKey.length > 0) return publicKey;
        if (typeof privateKey === 'string' && privateKey.length > 0) return privateKey;
      }
    } catch {
      // Not valid JSON — treat the file as raw key material below.
    }
  }
  return raw;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    positionals: [],
    flags: {},
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        result.flags[key] = args[i + 1];
        i++;
      } else {
        result.flags[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        result.flags[key] = args[i + 1];
        i++;
      } else {
        result.flags[key] = true;
      }
    } else {
      if (!result.command) {
        result.command = arg;
      } else {
        result.positionals.push(arg);
      }
    }
  }

  return result;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.flags.help || parsed.flags.h || !parsed.command) {
    printHelp();
    return 0;
  }

  if (parsed.flags.version || parsed.flags.v) {
    console.log('2.0.0');
    return 0;
  }

  switch (parsed.command) {
    case 'keygen': {
      const algo = (parsed.flags.algo as SignatureAlgorithm) || 'HMAC-SHA256';
      const outPath = parsed.flags.out as string | undefined;

      if (algo === 'Ed25519') {
        const keypair = ProofSigner.generateKeyPair();
        const output = JSON.stringify(keypair, null, 2);
        if (outPath) {
          await fs.writeFile(path.resolve(outPath), output, 'utf8');
          console.log(`\x1b[32m✓ Ed25519 keypair saved to ${outPath}\x1b[0m`);
        } else {
          console.log(output);
        }
      } else {
        const secret = ProofSigner.generateSecretKey();
        const output = JSON.stringify({ algorithm: 'HMAC-SHA256', secretKey: secret }, null, 2);
        if (outPath) {
          await fs.writeFile(path.resolve(outPath), output, 'utf8');
          console.log(`\x1b[32m✓ HMAC-SHA256 secret key saved to ${outPath}\x1b[0m`);
        } else {
          console.log(output);
        }
      }
      return 0;
    }

    case 'attest': {
      const taskName = (parsed.flags.task as string) || parsed.positionals[0] || 'Execution Task';
      const description = parsed.flags.description as string | undefined;
      const signer = (parsed.flags.signer as string) || 'nymrel-agent';
      const algo = (parsed.flags.algo as SignatureAlgorithm) || 'HMAC-SHA256';
      let key = parsed.flags.key as string | undefined;
      const keyFile = getFlag(parsed, 'key-file', 'keyFile');

      if (!key && keyFile) {
        key = await loadKeyMaterial(keyFile, 'sign');
      }
      if (!key) {
        key = ProofSigner.generateSecretKey();
        console.warn(`\x1b[33m! Warning: No signing key provided. Generated ephemeral secret key: ${key}\x1b[0m`);
      }

      // Collect files
      const filesArg = (parsed.flags.files as string) || (parsed.flags.f as string) || '';
      const fileList = filesArg
        ? filesArg.split(',').map((f) => f.trim()).filter(Boolean)
        : [];

      const artifacts: Array<{ path: string }> = fileList.map((p) => ({ path: p }));

      const status = (parsed.flags.status as 'SUCCESS' | 'FAILURE' | 'ATTESTED') || 'SUCCESS';
      const outProofPath = (parsed.flags.out as string) || 'proof.json';
      const badgeSvgPath = parsed.flags.badge as string | undefined;
      const certHtmlPath = parsed.flags.html as string | undefined;

      const receipt = await createReceipt({
        task: {
          name: taskName,
          description,
          status,
          runner: signer,
        },
        artifacts,
        signingKey: key,
        signerIdentity: signer,
        algorithm: algo,
      });

      await fs.writeFile(path.resolve(outProofPath), JSON.stringify(receipt, null, 2), 'utf8');
      console.log(`\x1b[32m✓ Attestation generated successfully!\x1b[0m`);
      console.log(`  Proof ID:    \x1b[1m${receipt.proofId}\x1b[0m`);
      console.log(`  Merkle Root: \x1b[33m${receipt.merkle.root}\x1b[0m`);
      console.log(`  Receipt:     ${outProofPath}`);

      if (badgeSvgPath) {
        const svg = generateSvgBadge(receipt);
        await fs.writeFile(path.resolve(badgeSvgPath), svg, 'utf8');
        console.log(`  SVG Badge:   ${badgeSvgPath}`);
      }

      if (certHtmlPath) {
        const html = generateHtmlCertificate(receipt);
        await fs.writeFile(path.resolve(certHtmlPath), html, 'utf8');
        console.log(`  Certificate: ${certHtmlPath}`);
      }

      return 0;
    }

    case 'verify': {
      const proofPath = (parsed.positionals[0] || (parsed.flags.proof as string) || 'proof.json');
      const key = parsed.flags.key as string | undefined;
      const keyFile = getFlag(parsed, 'key-file', 'keyFile');
      let signingKey = key;
      if (!signingKey && keyFile) {
        signingKey = await loadKeyMaterial(keyFile, 'verify');
      }

      const checkFiles = Boolean(parsed.flags.checkFiles || parsed.flags['check-files']);

      const raw = await fs.readFile(path.resolve(proofPath), 'utf8');
      const receipt: unknown = JSON.parse(raw);

      const result = await verifyReceipt(receipt, {
        publicKeyOrSecret: signingKey,
        checkFilesOnDisk: checkFiles,
      });

      if (parsed.flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.valid ? 0 : 1;
      }

      console.log('\n\x1b[1m--- PROOF VERIFICATION REPORT ---\x1b[0m');
      if (result.receipt === null) {
        result.errors.forEach((error) => console.log(`  ✗ ${error}`));
        console.log('\nOverall:     \x1b[1m\x1b[31mFAILED (UNVERIFIED)\x1b[0m\n');
        return 1;
      }
      console.log(`Proof ID:    ${result.receipt.proofId}`);
      console.log(`Task:        ${result.receipt.task.name}`);
      console.log(`Merkle Root: ${result.receipt.merkle.root}`);
      console.log(`Merkle Math: ${result.merkleValid ? '\x1b[32mVALID ✓\x1b[0m' : '\x1b[31mINVALID ✗\x1b[0m'}`);
      
      if (result.signatureChecked) {
        console.log(`Signature:   ${result.signatureValid ? '\x1b[32mVALID ✓\x1b[0m' : '\x1b[31mINVALID ✗\x1b[0m'}`);
      } else {
        console.log(`Signature:   \x1b[33mNOT CHECKED (no key supplied)\x1b[0m`);
      }

      if (checkFiles) {
        console.log(`Disk Files:  ${result.artifactsValid ? '\x1b[32mALL MATCHED ✓\x1b[0m' : '\x1b[31mTAMPERED/MISSING ✗\x1b[0m'} (${result.checkedArtifacts} checked)`);
      }

      if (result.errors.length > 0) {
        console.log('\n\x1b[31mErrors:\x1b[0m');
        result.errors.forEach((err) => console.log(`  ✗ ${err}`));
      }

      if (result.warnings.length > 0) {
        console.log('\n\x1b[33mWarnings:\x1b[0m');
        result.warnings.forEach((w) => console.log(`  ! ${w}`));
      }

      const overall = result.trusted
        ? '\x1b[1m\x1b[32mPASSED (TRUSTED)\x1b[0m'
        : result.valid
          ? '\x1b[1m\x1b[33mPASSED (INTEGRITY ONLY)\x1b[0m'
          : '\x1b[1m\x1b[31mFAILED (UNVERIFIED)\x1b[0m';
      console.log(`\nOverall:     ${overall}\n`);
      return result.valid ? 0 : 1;
    }

    case 'badge': {
      const proofPath = parsed.positionals[0] || (parsed.flags.proof as string) || 'proof.json';
      const outPath = (parsed.flags.out as string) || 'badge.svg';
      const format = (parsed.flags.format as string) || 'svg';
      const compact = Boolean(parsed.flags.compact);

      const raw = await fs.readFile(path.resolve(proofPath), 'utf8');
      const receipt: ProofReceipt = JSON.parse(raw);

      let content: string;
      if (format === 'html') {
        content = generateHtmlCertificate(receipt);
      } else if (format === 'shield') {
        content = generateShieldSvg(receipt);
      } else {
        content = generateSvgBadge(receipt, { compact });
      }

      await fs.writeFile(path.resolve(outPath), content, 'utf8');
      console.log(`\x1b[32m✓ Badge generated: ${outPath} (${format})\x1b[0m`);
      return 0;
    }

    case 'inspect': {
      const proofPath = parsed.positionals[0] || (parsed.flags.proof as string) || 'proof.json';
      const raw = await fs.readFile(path.resolve(proofPath), 'utf8');
      const receipt: ProofReceipt = JSON.parse(raw);

      console.log('\n\x1b[1m╔══════════════════════════════════════════════════════════════════╗\x1b[0m');
      console.log('\x1b[1m║               NYMREL PROOF LEDGER AUDIT INSPECTOR                ║\x1b[0m');
      console.log('\x1b[1m╚══════════════════════════════════════════════════════════════════╝\x1b[0m');
      console.log(`  Protocol:     \x1b[32m${receipt.protocol} v${receipt.version}\x1b[0m`);
      console.log(`  Parent Org:   \x1b[36m${receipt.parentOrganization}\x1b[0m`);
      console.log(`  Proof ID:     ${receipt.proofId}`);
      console.log(`  Timestamp:    ${receipt.timestamp}`);
      console.log(`  Task:         \x1b[1m${receipt.task.name}\x1b[0m (${receipt.task.status})`);
      console.log(`  Runner:       ${receipt.task.runner}`);
      console.log(`  Platform:     ${receipt.environment.platform} (${receipt.environment.runtime})`);
      if (receipt.environment.git) {
        console.log(`  Git Lineage:  ${receipt.environment.git.branch}@${receipt.environment.git.commit.slice(0, 8)} (Dirty: ${receipt.environment.git.dirty})`);
      }
      console.log('\n\x1b[1m--- CRYPTOGRAPHIC PROOFS ---\x1b[0m');
      console.log(`  Merkle Root:  \x1b[33m${receipt.merkle.root}\x1b[0m`);
      console.log(`  Leaf Count:   ${receipt.merkle.leaves.length}`);
      console.log(`  Signer:       ${receipt.signature.signerIdentity} [${receipt.signature.keyId}]`);
      console.log(`  Algorithm:    ${receipt.signature.algorithm}`);
      console.log(`  Signature:    ${receipt.signature.value.slice(0, 32)}...`);

      if (receipt.artifacts.length > 0) {
        console.log(`\n\x1b[1m--- ATTESTED ARTIFACTS (${receipt.artifacts.length}) ---\x1b[0m`);
        receipt.artifacts.forEach((art, idx) => {
          console.log(`  [${idx + 1}] ${art.path}`);
          console.log(`      SHA256: \x1b[37m${art.sha256}\x1b[0m (${art.sizeBytes} bytes)`);
        });
      }
      console.log('');
      return 0;
    }

    case 'export': {
      const proofPath = parsed.positionals[0] || (parsed.flags.proof as string) || 'proof.json';
      const format = (parsed.flags.format as string) || 'markdown';
      const outPath = parsed.flags.out as string | undefined;

      const raw = await fs.readFile(path.resolve(proofPath), 'utf8');
      const receipt: ProofReceipt = JSON.parse(raw);

      let output = '';
      if (format === 'jsonld' || format === 'json-ld') {
        output = JSON.stringify(
          {
            '@context': 'https://schema.org',
            '@type': 'DigitalDocument',
            name: `${receipt.task.name} Attestation`,
            identifier: receipt.proofId,
            dateCreated: receipt.timestamp,
            parentOrganization: {
              '@type': 'Organization',
              name: 'Nymrel',
            },
            merkleRoot: receipt.merkle.root,
            hasPart: receipt.artifacts.map((a) => ({
              '@type': 'DigitalDocument',
              name: a.path,
              sha256: a.sha256,
              size: a.sizeBytes,
            })),
          },
          null,
          2
        );
      } else if (format === 'html') {
        output = generateHtmlCertificate(receipt);
      } else {
        // Markdown audit report
        output = `# Attestation Audit Report: ${receipt.task.name}

- **Proof ID:** \`${receipt.proofId}\`
- **Timestamp:** ${receipt.timestamp}
- **Parent Organization:** ${receipt.parentOrganization}
- **Status:** **${receipt.task.status}** (Exit Code: ${receipt.task.exitCode})
- **Runner:** \`${receipt.task.runner}\`

## Cryptographic Attestation

- **Merkle Root (SHA-256):** \`${receipt.merkle.root}\`
- **Signer Identity:** \`${receipt.signature.signerIdentity}\`
- **Algorithm:** \`${receipt.signature.algorithm}\`
- **Signature Hash:** \`${receipt.signature.value}\`

## Attested Artifacts

| Path | SHA-256 Digest | Size (Bytes) |
| :--- | :--- | :--- |
${receipt.artifacts.map((a) => `| \`${a.path}\` | \`${a.sha256}\` | ${a.sizeBytes} |`).join('\n')}

---
*Generated by [@nymrel/proof-ledger](https://github.com/nymrel/nymrel-proof-ledger)*
`;
      }

      if (outPath) {
        await fs.writeFile(path.resolve(outPath), output, 'utf8');
        console.log(`\x1b[32m✓ Exported ${format} to ${outPath}\x1b[0m`);
      } else {
        console.log(output);
      }
      return 0;
    }

    default:
      console.error(`\x1b[31mUnknown command: ${parsed.command}\x1b[0m`);
      printHelp();
      return 1;
  }
}

// Auto-run if executed directly as script
if (process.argv[1] && (process.argv[1].endsWith('cli.js') || process.argv[1].endsWith('cli.ts'))) {
  runCli().then((code) => {
    if (code !== 0) process.exit(code);
  });
}

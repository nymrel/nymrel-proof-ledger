/**
 * Visual Proof Badge and Certificate Generation Engine.
 *
 * Implements self-contained SVG badges and interactive HTML certificate cards
 * adhering to Nymrel's signature warm design aesthetics:
 * - Warm Cream: #FAF8F2
 * - Soft Warm Paper: #F4F0E6
 * - Cedar Green: #2A332E
 * - Terracotta: #A8541F
 * - Stone Slate: #1C2320
 *
 * @module @nymrel/proof-ledger/visual/badge
 */

import { validateReceiptEnvelope } from "../core/envelope.js";
import type { ProofReceipt, VerificationResult } from "../core/receipt.js";
import { generateQRMatrix, generateQRSvgPath } from "./qr.js";

export type BadgeVerification = Pick<
  VerificationResult,
  "valid" | "trusted" | "signatureChecked" | "signatureValid"
>;

export interface BadgeOptions {
  theme?: "warm" | "light" | "dark";
  compact?: boolean;
  verificationBaseUrl?: string;
  verification?: BadgeVerification;
}

type PresentationState =
  | "trusted"
  | "integrity-only"
  | "unverified"
  | "invalid";

interface PresentationDetails {
  state: PresentationState;
  label: string;
  color: string;
}

function assertRenderableReceipt(receipt: ProofReceipt): void {
  const validation = validateReceiptEnvelope(receipt);
  if (!validation.valid) {
    const details = validation.errors.map(
      (error) => `${error.path ?? "<root>"}: ${error.message}`,
    );
    throw new TypeError(
      `Cannot render an invalid proof receipt: ${details.join("; ")}`,
    );
  }
}

function resolvePresentation(
  verification?: BadgeVerification,
): PresentationDetails {
  if (verification === undefined) {
    return {
      state: "unverified",
      label: "UNVERIFIED RECEIPT",
      color: "#5C665F",
    };
  }

  const trusted =
    verification.valid &&
    verification.trusted &&
    verification.signatureChecked &&
    verification.signatureValid === true;
  if (trusted)
    return { state: "trusted", label: "TRUSTED RECEIPT", color: "#2A332E" };

  if (!verification.valid) {
    return { state: "invalid", label: "INVALID RECEIPT", color: "#A8541F" };
  }

  const integrityOnly =
    !verification.trusted &&
    !verification.signatureChecked &&
    verification.signatureValid === null;
  if (integrityOnly) {
    return {
      state: "integrity-only",
      label: "INTEGRITY ONLY",
      color: "#A8541F",
    };
  }

  return { state: "invalid", label: "INVALID VERIFY RESULT", color: "#A8541F" };
}

function resolvePresentationTarget(
  proofId: string,
  verificationBaseUrl?: string,
): { value: string; label: string; host: string } {
  if (verificationBaseUrl === undefined) {
    return {
      value: `urn:nymrel:proof:${encodeURIComponent(proofId)}`,
      label: "RECEIPT ID",
      host: "nymrel.com",
    };
  }

  const base = new URL(verificationBaseUrl);
  if (
    base.protocol !== "https:" ||
    !base.hostname ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new TypeError(
      "verificationBaseUrl must be an absolute HTTPS URL without credentials, query, or fragment",
    );
  }
  base.pathname = `${base.pathname.replace(/\/$/, "")}/${encodeURIComponent(proofId)}`;
  return {
    value: base.toString(),
    label: "OPEN VERIFIER",
    host: base.hostname,
  };
}

function safeJsonForHtml(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Truncates a 64-char hex hash into a copy-friendly 16-char format (8..8).
 */
export function truncateHash(hash: string, lead = 8, trail = 8): string {
  if (!hash || hash.length <= lead + trail + 2) return hash || "";
  return `${hash.slice(0, lead)}...${hash.slice(-trail)}`;
}

/**
 * Escapes XML/HTML special characters.
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generates a full vector SVG proof badge card.
 */
export function generateSvgBadge(
  receipt: ProofReceipt,
  options: BadgeOptions = {},
): string {
  assertRenderableReceipt(receipt);
  const isCompact = options.compact ?? false;
  const presentation = resolvePresentation(options.verification);
  const target = resolvePresentationTarget(
    receipt.proofId,
    options.verificationBaseUrl,
  );

  const width = isCompact ? 480 : 640;
  const height = isCompact ? 180 : 300;

  // Generate QR Code vector path
  const qrMatrix = generateQRMatrix(target.value);
  const qrCellSize = isCompact ? 3 : 4;
  const qrSizePx = qrMatrix.length * qrCellSize;
  const qrOffsetX = width - qrSizePx - 32;
  const qrOffsetY = isCompact ? 30 : 60;
  const qrPath = generateQRSvgPath(qrMatrix, qrCellSize, qrOffsetX, qrOffsetY);

  const gitCommit = receipt.environment.git?.commit
    ? receipt.environment.git.commit.slice(0, 7)
    : "n/a";
  const gitBranch = receipt.environment.git?.branch || "standalone";
  const truncatedRoot = truncateHash(receipt.merkle.root, 8, 8);
  const truncatedProofId = receipt.proofId;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, sans-serif">
  <defs>
    <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FAF8F2"/>
      <stop offset="100%" stop-color="#F4F0E6"/>
    </linearGradient>
    <filter id="cardShadow" x="-5%" y="-5%" width="110%" height="115%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#1C2320" flood-opacity="0.06"/>
    </filter>
  </defs>

  <!-- Card Background -->
  <rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="14" fill="url(#cardGrad)" stroke="#E2DDD5" stroke-width="1.5" filter="url(#cardShadow)"/>

  <!-- Top Decorative Header Bar -->
  <path d="M 8 22 A 14 14 0 0 1 22 8 L ${width - 22} 8 A 14 14 0 0 1 ${width - 8} 22 L ${width - 8} 34 L 8 34 Z" fill="#2A332E"/>
  <text x="24" y="24" fill="#FAF8F2" font-size="11" font-weight="700" letter-spacing="1.2">NYMREL PROOF LEDGER</text>
  <text x="${width - 24}" y="24" fill="#FAF8F2" opacity="0.8" font-size="10" text-anchor="end" font-weight="500">PUBLISHER: NYMREL</text>

  <!-- Status Pill -->
  <g transform="translate(24, 48)">
    <rect width="190" height="24" rx="12" fill="${presentation.color}"/>
    <circle cx="12" cy="12" r="4" fill="#FAF8F2"/>
    <text x="24" y="16" fill="#FAF8F2" font-size="10" font-weight="700" letter-spacing="0.5">${presentation.label}</text>
  </g>

  <!-- Task Title & Proof ID -->
  <text x="24" y="94" fill="#1C2320" font-size="18" font-weight="700">${escapeXml(receipt.task.name)}</text>
  <text x="24" y="112" fill="#5C665F" font-size="11" font-family="'SF Mono', Monaco, Consolas, monospace">ID: ${escapeXml(truncatedProofId)} • TASK: ${escapeXml(receipt.task.status)}</text>

  <!-- Cryptographic Details Grid -->
  <g transform="translate(24, 134)" font-size="11">
    <text x="0" y="0" fill="#5C665F" font-weight="600">MERKLE ROOT</text>
    <text x="0" y="18" fill="#1C2320" font-family="'SF Mono', Monaco, Consolas, monospace" font-weight="700">${escapeXml(truncatedRoot)}</text>

    <text x="0" y="44" fill="#5C665F" font-weight="600">SIGNER IDENTITY</text>
    <text x="0" y="62" fill="#1C2320">${escapeXml(receipt.signature.signerIdentity)} <tspan fill="#A8541F" font-weight="600">(${escapeXml(receipt.signature.algorithm)})</tspan></text>

    <text x="220" y="0" fill="#5C665F" font-weight="600">LINEAGE &amp; ENV</text>
    <text x="220" y="18" fill="#1C2320" font-family="'SF Mono', Monaco, Consolas, monospace">${escapeXml(gitBranch)}@${escapeXml(gitCommit)} (${escapeXml(receipt.environment.platform)})</text>

    <text x="220" y="44" fill="#5C665F" font-weight="600">TIMESTAMP</text>
    <text x="220" y="62" fill="#1C2320">${escapeXml(receipt.timestamp)}</text>
  </g>

  <!-- QR Verification Container -->
  <g>
    <rect x="${qrOffsetX - 8}" y="${qrOffsetY - 8}" width="${qrSizePx + 16}" height="${qrSizePx + 16}" rx="8" fill="#FFFFFF" stroke="#E2DDD5" stroke-width="1"/>
    <path d="${qrPath}" fill="#1C2320"/>
    <text x="${qrOffsetX + qrSizePx / 2}" y="${qrOffsetY + qrSizePx + 18}" fill="#5C665F" font-size="9" text-anchor="middle" font-weight="600">${target.label}</text>
  </g>

  <!-- Footer Dual-Audience Marker -->
  <line x1="24" y1="${height - 38}" x2="${width - 24}" y2="${height - 38}" stroke="#E2DDD5" stroke-width="1"/>
  <text x="24" y="${height - 20}" fill="#5C665F" font-size="10">Portable receipt • Verify with authenticated key material</text>
  <text x="${width - 24}" y="${height - 20}" fill="#2A332E" font-weight="700" font-size="10" text-anchor="end">${escapeXml(target.host)}</text>

  <!-- Machine-Readable Metadata Anchor -->
  <metadata>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:nymrel="https://nymrel.com/ns#">
      <rdf:Description rdf:about="${escapeXml(target.value)}">
        <nymrel:proofId>${escapeXml(receipt.proofId)}</nymrel:proofId>
        <nymrel:merkleRoot>${escapeXml(receipt.merkle.root)}</nymrel:merkleRoot>
        <nymrel:publisher>Nymrel</nymrel:publisher>
        <nymrel:presentationState>${presentation.state}</nymrel:presentationState>
        <nymrel:taskStatus>${escapeXml(receipt.task.status)}</nymrel:taskStatus>
      </rdf:Description>
    </rdf:RDF>
  </metadata>
</svg>`;
}

/**
 * Generates an inline GitHub-style SVG shield badge.
 */
export function generateShieldSvg(
  receipt: ProofReceipt,
  options: BadgeOptions = {},
): string {
  assertRenderableReceipt(receipt);
  const presentation = resolvePresentation(options.verification);
  const label = "nymrel proof";
  const value = presentation.state;
  const color = presentation.color;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="20" role="img" aria-label="${label}: ${value}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="220" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="90" height="20" fill="#1C2320"/>
    <rect x="90" width="130" height="20" fill="${color}"/>
    <rect width="220" height="20" fill="url(#s)"/>
  </g>
  <g fill="#FAF8F2" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="45" y="14">${label}</text>
    <text x="155" y="14" font-weight="bold">${value}</text>
  </g>
</svg>`;
}

/**
 * Generates a complete standalone, interactive HTML certification page.
 */
export function generateHtmlCertificate(
  receipt: ProofReceipt,
  options: BadgeOptions = {},
): string {
  assertRenderableReceipt(receipt);
  const presentation = resolvePresentation(options.verification);
  const svgBadge = generateSvgBadge(receipt, { ...options, compact: false });
  const jsonStr = JSON.stringify(receipt, null, 2);
  const structuredData = safeJsonForHtml({
    "@context": "https://schema.org",
    "@type": "DigitalDocument",
    name: `${receipt.task.name} Attestation`,
    identifier: receipt.proofId,
    dateCreated: receipt.timestamp,
    publisher: {
      "@type": "Organization",
      name: "Nymrel",
      url: "https://nymrel.com",
    },
    additionalProperty: [
      {
        "@type": "PropertyValue",
        name: "presentationState",
        value: presentation.state,
      },
      {
        "@type": "PropertyValue",
        name: "taskStatus",
        value: receipt.task.status,
      },
      {
        "@type": "PropertyValue",
        name: "merkleRoot",
        value: receipt.merkle.root,
      },
    ],
    hasPart: receipt.artifacts.map((artifact) => ({
      "@type": "DigitalDocument",
      name: artifact.path,
      sha256: artifact.sha256,
      size: artifact.sizeBytes,
    })),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Attestation Certificate - ${escapeXml(receipt.task.name)} | Nymrel Proof Ledger</title>
  <meta name="description" content="Cryptographic proof-of-execution attestation for ${escapeXml(receipt.task.name)}. Merkle Root: ${receipt.merkle.root}">
  
  <!-- JSON-LD receipt metadata; presentation state is not a substitute for verification. -->
  <script type="application/ld+json">
${structuredData}
  </script>

  <style>
    :root {
      --bg: #FAF8F2;
      --card-bg: #F4F0E6;
      --border: #E2DDD5;
      --text-main: #1C2320;
      --text-muted: #5C665F;
      --cedar: #2A332E;
      --terracotta: #A8541F;
      --white: #FFFFFF;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding: 40px 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1.5px solid var(--border);
      padding-bottom: 20px;
    }
    .brand-title {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: var(--cedar);
    }
    .brand-sub {
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .badge-card {
      background: var(--white);
      border-radius: 16px;
      border: 1.5px solid var(--border);
      padding: 24px;
      margin-bottom: 30px;
      box-shadow: 0 4px 12px rgba(28, 35, 32, 0.04);
      display: flex;
      justify-content: center;
    }
    .section-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--cedar);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .data-card {
      background: var(--card-bg);
      border-radius: 12px;
      border: 1px solid var(--border);
      padding: 20px;
      margin-bottom: 24px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .label {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .value {
      font-size: 0.95rem;
      font-weight: 600;
      word-break: break-all;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.88rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 0.9rem;
    }
    th, td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
    }
    .btn {
      background: var(--cedar);
      color: var(--bg);
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: opacity 0.2s ease;
    }
    .btn:hover { opacity: 0.9; }
    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-main);
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 20px;
    }
    pre {
      background: #1C2320;
      color: #FAF8F2;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 0.82rem;
      max-height: 300px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <div class="brand-title">NYMREL PROOF LEDGER</div>
        <div class="brand-sub">Cryptographic Attestation &amp; Audit Protocol</div>
      </div>
      <div>
        <span class="btn btn-secondary" style="font-size: 0.8rem;">Publisher: Nymrel</span>
      </div>
    </header>

    <div class="badge-card">
      ${svgBadge}
    </div>

    <div class="section-title">Execution Context</div>
    <div class="data-card">
      <div class="grid-2">
        <div>
          <div class="label">Task</div>
          <div class="value">${escapeXml(receipt.task.name)}</div>
        </div>
        <div>
          <div class="label">Status</div>
          <div class="value" style="color: var(--cedar);">${escapeXml(receipt.task.status)} (Exit Code: ${receipt.task.exitCode})</div>
        </div>
        <div>
          <div class="label">Proof ID</div>
          <div class="value mono">${escapeXml(receipt.proofId)}</div>
        </div>
        <div>
          <div class="label">Attestation Timestamp</div>
          <div class="value">${escapeXml(receipt.timestamp)}</div>
        </div>
        <div>
          <div class="label">Presentation State</div>
          <div class="value">${presentation.label}</div>
        </div>
        <div>
          <div class="label">Signer Identity</div>
          <div class="value">${escapeXml(receipt.signature.signerIdentity)} (${escapeXml(receipt.signature.algorithm)})</div>
        </div>
        <div>
          <div class="label">Git Lineage</div>
          <div class="value mono">${escapeXml(receipt.environment.git?.branch || "standalone")} @ ${escapeXml(receipt.environment.git?.commit ? receipt.environment.git.commit.slice(0, 8) : "n/a")}</div>
        </div>
      </div>
    </div>

    <div class="section-title">Cryptographic Merkle Tree</div>
    <div class="data-card">
      <div class="label">Merkle Root (SHA-256 Domain-Separated)</div>
      <div class="value mono" style="margin-bottom: 16px; color: var(--terracotta);">${escapeXml(receipt.merkle.root)}</div>
      
      <div class="label">Attested Artifacts (${receipt.artifacts.length})</div>
      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th>SHA-256 Hash</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          ${receipt.artifacts
            .map(
              (a) => `
          <tr>
            <td><strong>${escapeXml(a.path)}</strong></td>
            <td class="mono" style="font-size: 0.8rem;">${escapeXml(a.sha256)}</td>
            <td>${a.sizeBytes} B</td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <div class="section-title">Raw Proof Receipt (JSON)</div>
    <div class="data-card">
      <pre><code>${escapeXml(jsonStr)}</code></pre>
    </div>

    <div class="actions">
      <button class="btn" onclick="navigator.clipboard.writeText('${escapeXml(receipt.merkle.root)}'); alert('Merkle Root copied to clipboard!');">Copy Merkle Root</button>
      <button class="btn btn-secondary" onclick="window.print()">Print Certificate</button>
    </div>
  </div>
</body>
</html>`;
}

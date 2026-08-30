"""
Visual Proof Badge and Certificate Generation in Python.

Implements SVG badges and HTML certificates adhering to Nymrel's warm design aesthetics.
"""

import html
import json
from collections.abc import Mapping
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

from .envelope import validate_receipt_envelope
from .qr import generate_qr_matrix, generate_qr_svg_path


def _assert_renderable_receipt(receipt: Mapping[str, Any]) -> None:
    validation = validate_receipt_envelope(receipt)
    if validation["valid"]:
        return
    details = "; ".join(
        f"{error.get('path') or '<root>'}: {error.get('message', 'invalid field')}"
        for error in validation["errors"]
    )
    raise ValueError(f"Cannot render an invalid proof receipt: {details}")


def _presentation_state(
    verification_result: Mapping[str, Any] | None,
) -> tuple[str, str, str]:
    if verification_result is None:
        return "unverified", "UNVERIFIED RECEIPT", "#5C665F"

    trusted = (
        verification_result.get("valid") is True
        and verification_result.get("trusted") is True
        and verification_result.get("signatureChecked") is True
        and verification_result.get("signatureValid") is True
    )
    if trusted:
        return "trusted", "TRUSTED RECEIPT", "#2A332E"

    if verification_result.get("valid") is not True:
        return "invalid", "INVALID RECEIPT", "#A8541F"

    integrity_only = (
        verification_result.get("trusted") is False
        and verification_result.get("signatureChecked") is False
        and verification_result.get("signatureValid") is None
    )
    if integrity_only:
        return "integrity-only", "INTEGRITY ONLY", "#A8541F"

    return "invalid", "INVALID VERIFY RESULT", "#A8541F"


def _presentation_target(
    proof_id: str, verification_base_url: str | None
) -> tuple[str, str, str]:
    if verification_base_url is None:
        return (
            f"urn:nymrel:proof:{quote(proof_id, safe='')}",
            "RECEIPT ID",
            "nymrel.com",
        )

    parsed = urlsplit(verification_base_url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "verification_base_url must be an absolute HTTPS URL without "
            "credentials, query, or fragment"
        )
    path = f"{parsed.path.rstrip('/')}/{quote(proof_id, safe='')}"
    return (
        urlunsplit((parsed.scheme, parsed.netloc, path, "", "")),
        "OPEN VERIFIER",
        parsed.hostname,
    )


def _safe_json_for_html(value: Any) -> str:
    return (
        json.dumps(value, ensure_ascii=False, indent=2)
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def truncate_hash(h: str, lead: int = 8, trail: int = 8) -> str:
    """Truncates a 64-char hex hash into a copy-friendly format."""
    if not h or len(h) <= lead + trail + 2:
        return h or ""
    return f"{h[:lead]}...{h[-trail:]}"


def generate_svg_badge(
    receipt: Mapping[str, Any],
    compact: bool = False,
    verification_base_url: str | None = None,
    verification_result: Mapping[str, Any] | None = None,
) -> str:
    """Generates a full vector SVG proof badge card."""
    _assert_renderable_receipt(receipt)
    proof_id = str(receipt.get("proofId", ""))
    presentation_state, status_text, status_color = _presentation_state(
        verification_result
    )
    target_value, target_label, target_host = _presentation_target(
        proof_id, verification_base_url
    )

    task = receipt.get("task", {})
    task_status = str(task.get("status", ""))

    width = 480 if compact else 640
    height = 180 if compact else 300

    qr_matrix = generate_qr_matrix(target_value)
    qr_cell_size = 3 if compact else 4
    qr_size_px = len(qr_matrix) * qr_cell_size
    qr_offset_x = width - qr_size_px - 32
    qr_offset_y = 30 if compact else 60
    qr_path = generate_qr_svg_path(qr_matrix, qr_cell_size, qr_offset_x, qr_offset_y)

    env = receipt.get("environment", {})
    git_info = env.get("git") or {}
    git_commit = git_info.get("commit", "n/a")[:7] if git_info.get("commit") else "n/a"
    git_branch = git_info.get("branch", "standalone")

    merkle_info = receipt.get("merkle", {})
    merkle_root = merkle_info.get("root", "")
    truncated_root = truncate_hash(merkle_root, 8, 8)

    sig_info = receipt.get("signature", {})
    signer_id = sig_info.get("signerIdentity", "unknown")
    sig_algo = sig_info.get("algorithm", "HMAC-SHA256")
    timestamp = receipt.get("timestamp", "")
    platform_name = env.get("platform", "unknown")
    task_name = task.get("name", "Execution Task")

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, sans-serif">
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
  <rect x="8" y="8" width="{width - 16}" height="{height - 16}" rx="14" fill="url(#cardGrad)" stroke="#E2DDD5" stroke-width="1.5" filter="url(#cardShadow)"/>

  <!-- Top Header Bar -->
  <path d="M 8 22 A 14 14 0 0 1 22 8 L {width - 22} 8 A 14 14 0 0 1 {width - 8} 22 L {width - 8} 34 L 8 34 Z" fill="#2A332E"/>
  <text x="24" y="24" fill="#FAF8F2" font-size="11" font-weight="700" letter-spacing="1.2">NYMREL PROOF LEDGER</text>
  <text x="{width - 24}" y="24" fill="#FAF8F2" opacity="0.8" font-size="10" text-anchor="end" font-weight="500">PUBLISHER: NYMREL</text>

  <!-- Status Pill -->
  <g transform="translate(24, 48)">
    <rect width="190" height="24" rx="12" fill="{status_color}"/>
    <circle cx="12" cy="12" r="4" fill="#FAF8F2"/>
    <text x="24" y="16" fill="#FAF8F2" font-size="10" font-weight="700" letter-spacing="0.5">{html.escape(status_text)}</text>
  </g>

  <!-- Task Title & Proof ID -->
  <text x="24" y="94" fill="#1C2320" font-size="18" font-weight="700">{html.escape(task_name)}</text>
  <text x="24" y="112" fill="#5C665F" font-size="11" font-family="'SF Mono', Monaco, Consolas, monospace">ID: {html.escape(proof_id)} • TASK: {html.escape(task_status)}</text>

  <!-- Cryptographic Details -->
  <g transform="translate(24, 134)" font-size="11">
    <text x="0" y="0" fill="#5C665F" font-weight="600">MERKLE ROOT</text>
    <text x="0" y="18" fill="#1C2320" font-family="'SF Mono', Monaco, Consolas, monospace" font-weight="700">{html.escape(truncated_root)}</text>

    <text x="0" y="44" fill="#5C665F" font-weight="600">SIGNER IDENTITY</text>
    <text x="0" y="62" fill="#1C2320">{html.escape(signer_id)} <tspan fill="#A8541F" font-weight="600">({html.escape(sig_algo)})</tspan></text>

    <text x="220" y="0" fill="#5C665F" font-weight="600">LINEAGE &amp; ENV</text>
    <text x="220" y="18" fill="#1C2320" font-family="'SF Mono', Monaco, Consolas, monospace">{html.escape(git_branch)}@{html.escape(git_commit)} ({html.escape(platform_name)})</text>

    <text x="220" y="44" fill="#5C665F" font-weight="600">TIMESTAMP</text>
    <text x="220" y="62" fill="#1C2320">{html.escape(timestamp)}</text>
  </g>

  <!-- QR Verification Container -->
  <g>
    <rect x="{qr_offset_x - 8}" y="{qr_offset_y - 8}" width="{qr_size_px + 16}" height="{qr_size_px + 16}" rx="8" fill="#FFFFFF" stroke="#E2DDD5" stroke-width="1"/>
    <path d="{qr_path}" fill="#1C2320"/>
    <text x="{qr_offset_x + qr_size_px / 2}" y="{qr_offset_y + qr_size_px + 18}" fill="#5C665F" font-size="9" text-anchor="middle" font-weight="600">{target_label}</text>
  </g>

  <!-- Footer Dual-Audience Marker -->
  <line x1="24" y1="{height - 38}" x2="{width - 24}" y2="{height - 38}" stroke="#E2DDD5" stroke-width="1"/>
  <text x="24" y="{height - 20}" fill="#5C665F" font-size="10">Portable receipt • Verify with authenticated key material</text>
  <text x="{width - 24}" y="{height - 20}" fill="#2A332E" font-weight="700" font-size="10" text-anchor="end">{html.escape(target_host)}</text>

  <!-- Machine-Readable Metadata -->
  <metadata>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:nymrel="https://nymrel.com/ns#">
      <rdf:Description rdf:about="{html.escape(target_value, quote=True)}">
        <nymrel:proofId>{html.escape(proof_id)}</nymrel:proofId>
        <nymrel:merkleRoot>{html.escape(merkle_root)}</nymrel:merkleRoot>
        <nymrel:publisher>Nymrel</nymrel:publisher>
        <nymrel:presentationState>{presentation_state}</nymrel:presentationState>
        <nymrel:taskStatus>{html.escape(task_status)}</nymrel:taskStatus>
      </rdf:Description>
    </rdf:RDF>
  </metadata>
</svg>"""


def generate_shield_svg(
    receipt: Mapping[str, Any],
    verification_result: Mapping[str, Any] | None = None,
) -> str:
    """Generates an inline GitHub-style SVG shield badge."""
    _assert_renderable_receipt(receipt)
    presentation_state, _, color = _presentation_state(verification_result)
    label = "nymrel proof"
    val = presentation_state

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="220" height="20" role="img" aria-label="{label}: {val}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0%" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="220" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="90" height="20" fill="#1C2320"/>
    <rect x="90" width="130" height="20" fill="{color}"/>
    <rect width="220" height="20" fill="url(#s)"/>
  </g>
  <g fill="#FAF8F2" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="45" y="14">{label}</text>
    <text x="155" y="14" font-weight="bold">{val}</text>
  </g>
</svg>"""


def generate_html_certificate(
    receipt: Mapping[str, Any],
    verification_result: Mapping[str, Any] | None = None,
    verification_base_url: str | None = None,
) -> str:
    """Generates a standalone HTML certification document."""
    _assert_renderable_receipt(receipt)
    presentation_state, presentation_label, _ = _presentation_state(verification_result)
    svg_badge = generate_svg_badge(
        receipt,
        verification_base_url=verification_base_url,
        verification_result=verification_result,
    )
    json_str = json.dumps(receipt, indent=2)
    task = receipt.get("task", {})
    artifacts = receipt.get("artifacts", [])
    merkle_root = (
        receipt.get("merkle", {}).get("root", "")
        if isinstance(receipt.get("merkle"), dict)
        else ""
    )

    structured_data = _safe_json_for_html(
        {
            "@context": "https://schema.org",
            "@type": "DigitalDocument",
            "name": f"{task.get('name', 'Task')} Attestation",
            "identifier": receipt.get("proofId", ""),
            "dateCreated": receipt.get("timestamp", ""),
            "publisher": {
                "@type": "Organization",
                "name": "Nymrel",
                "url": "https://nymrel.com",
            },
            "additionalProperty": [
                {
                    "@type": "PropertyValue",
                    "name": "presentationState",
                    "value": presentation_state,
                },
                {
                    "@type": "PropertyValue",
                    "name": "taskStatus",
                    "value": task.get("status", ""),
                },
                {
                    "@type": "PropertyValue",
                    "name": "merkleRoot",
                    "value": merkle_root,
                },
            ],
        }
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Attestation Certificate - {html.escape(task.get("name", "Task"))} | Nymrel Proof Ledger</title>
  <script type="application/ld+json">
{structured_data}
  </script>
  <style>
    :root {{
      --bg: #FAF8F2;
      --card-bg: #F4F0E6;
      --border: #E2DDD5;
      --text-main: #1C2320;
      --text-muted: #5C665F;
      --cedar: #2A332E;
      --terracotta: #A8541F;
      --white: #FFFFFF;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background-color: var(--bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding: 40px 20px;
    }}
    .container {{
      max-width: 800px;
      margin: 0 auto;
    }}
    header {{
      margin-bottom: 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1.5px solid var(--border);
      padding-bottom: 20px;
    }}
    .brand-title {{
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: var(--cedar);
    }}
    .badge-card {{
      background: var(--white);
      border-radius: 16px;
      border: 1.5px solid var(--border);
      padding: 24px;
      margin-bottom: 30px;
      box-shadow: 0 4px 12px rgba(28, 35, 32, 0.04);
      display: flex;
      justify-content: center;
    }}
    .section-title {{
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--cedar);
      margin-bottom: 12px;
    }}
    .data-card {{
      background: var(--card-bg);
      border-radius: 12px;
      border: 1px solid var(--border);
      padding: 20px;
      margin-bottom: 24px;
    }}
    .grid-2 {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }}
    .label {{
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 4px;
    }}
    .value {{
      font-size: 0.95rem;
      font-weight: 600;
      word-break: break-all;
    }}
    .mono {{
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.88rem;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 0.9rem;
    }}
    th, td {{
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }}
    th {{
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
    }}
    pre {{
      background: #1C2320;
      color: #FAF8F2;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 0.82rem;
      max-height: 300px;
    }}
    .btn {{
      background: var(--cedar);
      color: var(--bg);
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
    }}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <div class="brand-title">NYMREL PROOF LEDGER</div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">Python Attestation Engine</div>
      </div>
      <div>
        <span style="border: 1px solid var(--border); padding: 6px 12px; border-radius: 6px; font-size: 0.8rem;">Publisher: Nymrel</span>
      </div>
    </header>

    <div class="badge-card">
      {svg_badge}
    </div>

    <div class="section-title">Execution Context</div>
    <div class="data-card">
      <div class="grid-2">
        <div>
          <div class="label">Task</div>
          <div class="value">{html.escape(task.get("name", ""))}</div>
        </div>
        <div>
          <div class="label">Status</div>
          <div class="value" style="color: var(--cedar);">{html.escape(task.get("status", ""))} (Exit Code: {task.get("exitCode", 0)})</div>
        </div>
        <div>
          <div class="label">Proof ID</div>
          <div class="value mono">{html.escape(receipt.get("proofId", ""))}</div>
        </div>
        <div>
          <div class="label">Timestamp</div>
          <div class="value">{html.escape(receipt.get("timestamp", ""))}</div>
        </div>
        <div>
          <div class="label">Presentation State</div>
          <div class="value">{presentation_label}</div>
        </div>
      </div>
    </div>

    <div class="section-title">Cryptographic Proofs</div>
    <div class="data-card">
      <div class="label">Merkle Root</div>
      <div class="value mono" style="color: var(--terracotta); margin-bottom: 16px;">{html.escape(merkle_root)}</div>

      <div class="label">Artifacts ({len(artifacts)})</div>
      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th>SHA-256</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          {"".join([f'<tr><td><strong>{html.escape(a.get("path", ""))}</strong></td><td class="mono" style="font-size: 0.8rem;">{html.escape(a.get("sha256", ""))}</td><td>{a.get("sizeBytes", 0)} B</td></tr>' for a in artifacts])}
        </tbody>
      </table>
    </div>

    <div class="section-title">Raw Receipt</div>
    <div class="data-card">
      <pre><code>{html.escape(json_str)}</code></pre>
    </div>
  </div>
</body>
</html>"""

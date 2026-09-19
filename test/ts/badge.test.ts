import { describe, it } from "node:test";
import assert from "node:assert";
import { createReceipt, verifyReceipt } from "../../src/core/receipt.js";
import {
  generateSvgBadge,
  generateShieldSvg,
  generateHtmlCertificate,
} from "../../src/visual/badge.js";
import { ProofSigner } from "../../src/core/signer.js";

describe("Visual Badge & Certificate Generation", () => {
  it("defaults to an offline, explicitly unverified receipt presentation", async () => {
    const secret = ProofSigner.generateSecretKey();
    const receipt = await createReceipt({
      task: { name: "Core Pipeline Execution" },
      artifacts: [{ path: "dist/app.js", data: 'console.log("production");' }],
      signingKey: secret,
      signerIdentity: "nymrel-builder",
    });

    const svg = generateSvgBadge(receipt);

    assert.ok(svg.startsWith('<?xml version="1.0"'));
    assert.ok(svg.includes("<svg"));
    assert.ok(svg.includes("NYMREL PROOF LEDGER"));
    assert.ok(svg.includes("#FAF8F2")); // Warm cream
    assert.ok(svg.includes("#2A332E")); // Cedar green
    assert.ok(svg.includes("PUBLISHER: NYMREL"));
    assert.ok(svg.includes("UNVERIFIED RECEIPT"));
    assert.ok(svg.includes("RECEIPT ID"));
    assert.ok(svg.includes("urn:nymrel:proof:"));
    assert.ok(svg.includes(receipt.proofId));
    assert.ok(svg.includes('<path d="M')); // QR code path elements
    assert.ok(svg.includes("<metadata>")); // Machine-readable RDF
    assert.ok(!svg.includes("proofs.nymrel.com"));
    assert.ok(!svg.includes("JalenBuilds"));
  });

  it("shows trusted only from a consistent authenticated verification result", async () => {
    const secret = ProofSigner.generateSecretKey();
    const receipt = await createReceipt({
      task: { name: "Quick Check" },
      signingKey: secret,
      signerIdentity: "ci",
    });
    const verification = await verifyReceipt(receipt, {
      expectedAlgorithm: 'HMAC-SHA256', publicKeyOrSecret: secret,
    });

    const shield = generateShieldSvg(receipt, { verification });
    assert.ok(shield.includes("nymrel proof"));
    assert.ok(shield.includes("trusted"));
    assert.ok(shield.includes("#2A332E"));

    const svg = generateSvgBadge(receipt, {
      verification,
      verificationBaseUrl: "https://verifier.example/v",
    });
    assert.ok(svg.includes("TRUSTED RECEIPT"));
    assert.ok(svg.includes("OPEN VERIFIER"));
    assert.ok(svg.includes(`https://verifier.example/v/${receipt.proofId}`));
  });

  it("keeps task outcome distinct from receipt trust", async () => {
    const secret = ProofSigner.generateSecretKey();
    const receipt = await createReceipt({
      task: {
        name: "Expected Failure Capture",
        status: "FAILURE",
        exitCode: 1,
      },
      signingKey: secret,
      signerIdentity: "audit-runner",
    });
    const trusted = await verifyReceipt(receipt, { expectedAlgorithm: 'HMAC-SHA256', publicKeyOrSecret: secret });
    const integrityOnly = await verifyReceipt(receipt);

    assert.ok(
      generateShieldSvg(receipt, { verification: trusted }).includes("trusted"),
    );
    assert.ok(
      generateShieldSvg(receipt, { verification: integrityOnly }).includes(
        "integrity-only",
      ),
    );
    assert.ok(
      generateSvgBadge(receipt, { verification: trusted }).includes(
        "TASK: FAILURE",
      ),
    );
    assert.ok(
      generateSvgBadge(receipt, {
        verification: {
          valid: true,
          trusted: true,
          signatureChecked: false,
          signatureValid: null,
        },
      }).includes("INVALID VERIFY RESULT"),
    );
  });

  it("rejects malformed receipts and unsafe verifier URLs before rendering", async () => {
    const secret = ProofSigner.generateSecretKey();
    const receipt = await createReceipt({
      task: { name: "Render Guard" },
      signingKey: secret,
      signerIdentity: "render-guard",
    });

    assert.throws(
      () => generateSvgBadge({ ...receipt, proofId: "" }),
      /Cannot render an invalid proof receipt/,
    );
    assert.throws(
      () =>
        generateSvgBadge(receipt, {
          verificationBaseUrl: "http://user:pass@example.test/v",
        }),
      /absolute HTTPS URL/,
    );
  });

  it("generates safe standalone HTML and honest JSON-LD metadata", async () => {
    const secret = ProofSigner.generateSecretKey();
    const receipt = await createReceipt({
      task: { name: "</script><img src=x onerror=alert(1)>" },
      artifacts: [{ path: "bundle.tar.gz", data: "release-data" }],
      signingKey: secret,
      signerIdentity: "release-gate",
    });

    const html = generateHtmlCertificate(receipt);
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("application/ld+json"));
    assert.ok(html.includes("Publisher: Nymrel"));
    assert.ok(html.includes("UNVERIFIED RECEIPT"));
    assert.ok(html.includes(receipt.merkle.root));
    assert.ok(html.includes("bundle.tar.gz"));
    assert.equal(html.match(/<\/script>/g)?.length, 1);
    assert.ok(!html.includes("</script><img"));
    assert.ok(!html.includes("JalenBuilds"));
    assert.ok(!html.includes("proofs.nymrel.com"));

    const jsonLdMatch = html.match(
      /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/,
    );
    assert.ok(jsonLdMatch);
    const jsonLd = JSON.parse(jsonLdMatch[1] ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(jsonLd["identifier"], receipt.proofId);
    assert.deepEqual(jsonLd["publisher"], {
      "@type": "Organization",
      name: "Nymrel",
      url: "https://nymrel.com",
    });
  });
});

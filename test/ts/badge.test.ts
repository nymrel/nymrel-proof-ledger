import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createReceipt } from '../../src/core/receipt.js';
import { generateSvgBadge, generateShieldSvg, generateHtmlCertificate } from '../../src/visual/badge.js';
import { ProofSigner } from '../../src/core/signer.js';

describe('Visual Badge & Certificate Generation', () => {
  it('generates a valid SVG badge with Nymrel warm aesthetics and embedded QR code', async () => {
    const secret = ProofSigner.generateSecretKey();
    const receipt = await createReceipt({
      task: { name: 'Core Pipeline Execution' },
      artifacts: [{ path: 'dist/app.js', data: 'console.log("production");' }],
      signingKey: secret,
      signerIdentity: 'nymrel-builder',
    });

    const svg = generateSvgBadge(receipt);

    assert.ok(svg.startsWith('<?xml version="1.0"'));
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('NYMREL PROOF LEDGER'));
    assert.ok(svg.includes('#FAF8F2')); // Warm cream
    assert.ok(svg.includes('#2A332E')); // Cedar green
    assert.ok(svg.includes('PARENT: JALENBUILDS LLC'));
    assert.ok(svg.includes('VERIFIED ATTESTATION'));
    assert.ok(svg.includes(receipt.proofId));
    assert.ok(svg.includes('<path d="M')); // QR code path elements
    assert.ok(svg.includes('<metadata>')); // Machine-readable RDF
  });

  it('generates a compact GitHub-style shield SVG', async () => {
    const secret = ProofSigner.generateSecretKey();
    const receipt = await createReceipt({
      task: { name: 'Quick Check' },
      signingKey: secret,
      signerIdentity: 'ci',
    });

    const shield = generateShieldSvg(receipt);
    assert.ok(shield.includes('nymrel proof'));
    assert.ok(shield.includes('verified ✓'));
    assert.ok(shield.includes('#2A332E'));
  });

  it('generates a complete standalone HTML certificate card with JSON-LD', async () => {
    const secret = ProofSigner.generateSecretKey();
    const receipt = await createReceipt({
      task: { name: 'Release Attestation' },
      artifacts: [{ path: 'bundle.tar.gz', data: 'release-data' }],
      signingKey: secret,
      signerIdentity: 'release-gate',
    });

    const html = generateHtmlCertificate(receipt);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('application/ld+json'));
    assert.ok(html.includes('JalenBuilds LLC'));
    assert.ok(html.includes(receipt.merkle.root));
    assert.ok(html.includes('bundle.tar.gz'));
  });
});

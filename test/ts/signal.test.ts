import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  SIGNAL_PROOF_PROFILE,
  SIGNAL_PROOF_PROFILE_VERSION,
  canonicalizeSignalProofEnvelope,
  createSignalProofBundle,
  digestSignalProofEnvelope,
  validateSignalProofEnvelope,
  verifySignalProofBundle,
  type SignalProofBundleV1,
  type SignalProofEnvelopeV1,
} from '../../src/profiles/signal.js';
import { ProofSigner } from '../../src/core/signer.js';

const EXPECTED_FIXTURE_DIGEST =
  'sha256:dbad113cf71570d27242476d5d9fc9f21328d21d3ce5082f98d1fe7ce5436dcb';

function fixtureEnvelope(): SignalProofEnvelopeV1 {
  return {
    profile: SIGNAL_PROOF_PROFILE,
    profileVersion: SIGNAL_PROOF_PROFILE_VERSION,
    signalReceiptId: 'receipt-demo-001',
    needDropId: 'need-demo-001',
    challengeId: 'challenge-demo-001',
    claimSnapshotDigest: `sha256:${'a'.repeat(64)}`,
    disclosureSnapshotDigest: `sha256:${'b'.repeat(64)}`,
    attestedScopes: ['execution_observed', 'artifact_integrity'],
    observer: {
      kind: 'system',
      id: 'signal-evaluator',
      observedAt: '2026-08-21T22:00:00Z',
      method: 'screen-recorded run',
    },
    evaluator: {
      id: 'rubric-v1',
      version: '1.0.0',
    },
    evidence: [
      {
        ref: 'artifact://output',
        privacy: 'public',
        digest: `sha256:${'c'.repeat(64)}`,
      },
      {
        ref: 'artifact://private-input',
        privacy: 'private',
        digest: `sha256:${'d'.repeat(64)}`,
      },
    ],
    limitations: ['Fictional demonstration — not a customer result'],
  };
}

function cloneBundle(bundle: SignalProofBundleV1): SignalProofBundleV1 {
  return JSON.parse(JSON.stringify(bundle)) as SignalProofBundleV1;
}

function envelopeRecord(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(fixtureEnvelope())) as Record<string, unknown>;
}

function assertNoAuthoritativeSignalData(
  result: Awaited<ReturnType<typeof verifySignalProofBundle>>
): void {
  assert.strictEqual(result.authoritative.signalReceiptId, undefined);
  assert.strictEqual(result.authoritative.needDropId, undefined);
  assert.strictEqual(result.authoritative.challengeId, undefined);
  assert.deepStrictEqual(result.authoritative.attestedScopes, []);
  assert.deepStrictEqual(result.authoritative.publicEvidenceRefs, []);
  assert.strictEqual(result.authoritative.nonPublicEvidenceCount, 0);
  assert.ok(result.doesNotProve.includes('that the described execution occurred'));
}

describe('Nymrel Signal proof profile', () => {
  it('canonicalizes deterministically with the cross-language fixture digest', () => {
    const canonical = canonicalizeSignalProofEnvelope(fixtureEnvelope());

    assert.match(canonical, /^\{/);
    assert.strictEqual(digestSignalProofEnvelope(fixtureEnvelope()), EXPECTED_FIXTURE_DIGEST);
  });

  it('creates and verifies a bound HMAC Signal bundle without publishing private evidence', async () => {
    const secret = ProofSigner.generateSecretKey();
    const bundle = await createSignalProofBundle({
      envelope: fixtureEnvelope(),
      task: {
        name: 'Signal fictional challenge fixture',
        status: 'ATTESTED',
      },
      artifacts: [{ path: 'output.txt', data: 'fictional output' }],
      signingKey: secret,
      signerIdentity: 'signal-internal-verifier',
      algorithm: 'HMAC-SHA256',
    });

    assert.strictEqual(bundle.receipt.artifacts[0].path, 'signal-proof-envelope.json');

    const result = await verifySignalProofBundle(bundle, {
      publicKeyOrSecret: secret,
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.structurallyValid, true);
    assert.strictEqual(result.envelopeBound, true);
    assert.strictEqual(result.signatureChecked, true);
    assert.strictEqual(result.signatureMode, 'shared_secret_integrity');
    assert.strictEqual(result.signerIdentityTrust, 'unresolved');
    assert.deepStrictEqual(result.authoritative.publicEvidenceRefs, ['artifact://output']);
    assert.strictEqual(result.authoritative.nonPublicEvidenceCount, 1);
    assert.ok(
      result.doesNotProve.includes(
        'signer identity or authority without an external trusted-key resolution policy'
      )
    );
  });

  it('does not call an unchecked signature a valid Signal proof', async () => {
    const secret = ProofSigner.generateSecretKey();
    const bundle = await createSignalProofBundle({
      envelope: fixtureEnvelope(),
      task: { name: 'Unchecked signature fixture' },
      signingKey: secret,
      signerIdentity: 'signal-internal-verifier',
    });

    const result = await verifySignalProofBundle(bundle);

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.structurallyValid, true);
    assert.strictEqual(result.signatureChecked, false);
    assert.strictEqual(result.signatureMode, 'not_checked');
    assert.ok(result.warnings.some((warning) => warning.includes('no verification key')));
    assertNoAuthoritativeSignalData(result);
  });

  it('supports asymmetric verification without claiming signer authority', async () => {
    const keypair = ProofSigner.generateKeyPair();
    const bundle = await createSignalProofBundle({
      envelope: fixtureEnvelope(),
      task: { name: 'Public verification fixture' },
      signingKey: keypair.privateKey,
      signerIdentity: 'declared-signal-verifier',
      algorithm: 'Ed25519',
    });

    const result = await verifySignalProofBundle(bundle, {
      publicKeyOrSecret: keypair.publicKey,
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.signatureMode, 'asymmetric_signature');
    assert.strictEqual(result.signerIdentityTrust, 'unresolved');
  });

  it('rejects portable-envelope tampering even when the core receipt remains unchanged', async () => {
    const secret = ProofSigner.generateSecretKey();
    const original = await createSignalProofBundle({
      envelope: fixtureEnvelope(),
      task: { name: 'Envelope tamper fixture' },
      signingKey: secret,
      signerIdentity: 'signal-internal-verifier',
    });
    const tampered = cloneBundle(original);
    tampered.envelope.signalReceiptId = 'receipt-tampered';

    const result = await verifySignalProofBundle(tampered, {
      publicKeyOrSecret: secret,
    });

    assert.strictEqual(result.core.valid, true);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.envelopeBound, false);
    assert.ok(result.errors.some((error) => error.includes('digest does not match')));
    assertNoAuthoritativeSignalData(result);
  });

  it('rejects a signed metadata mirror that disagrees with the envelope', async () => {
    const secret = ProofSigner.generateSecretKey();
    const original = await createSignalProofBundle({
      envelope: fixtureEnvelope(),
      task: { name: 'Metadata mirror fixture' },
      signingKey: secret,
      signerIdentity: 'signal-internal-verifier',
    });
    const tampered = cloneBundle(original);
    const mirror = tampered.receipt.metadata.signalProfile as Record<string, unknown>;
    mirror.signalReceiptId = 'metadata-only-tamper';

    const result = await verifySignalProofBundle(tampered, {
      publicKeyOrSecret: secret,
    });

    assert.strictEqual(result.core.valid, false);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.envelopeBound, true);
    assert.ok(result.core.errors.some((error) => error.includes('signature verification failed')));
    assert.ok(result.errors.some((error) => error.includes('disagrees')));
    assertNoAuthoritativeSignalData(result);
  });

  it('is total and exposes no authoritative data for arbitrary malformed bundles', async () => {
    const malformedBundles: unknown[] = [
      null,
      [],
      'not-a-bundle',
      {},
      {
        profile: 'nymrel-signal-proof-bundle',
        bundleVersion: '1.0.0',
        envelope: fixtureEnvelope(),
        receipt: { artifacts: 'not-an-array' },
      },
    ];

    for (const malformed of malformedBundles) {
      const result = await verifySignalProofBundle(malformed, {
        publicKeyOrSecret: 'not-a-valid-key',
      });
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.structurallyValid, false);
      assertNoAuthoritativeSignalData(result);
    }
  });

  it('is total for hostile objects with throwing property access', async () => {
    const hostileBundles: unknown[] = [
      new Proxy(
        {},
        {
          get() {
            throw new Error('proxy getter trap');
          },
        }
      ),
      Object.defineProperty({}, 'profile', {
        get() {
          throw new Error('property getter trap');
        },
      }),
    ];

    for (const hostile of hostileBundles) {
      const result = await verifySignalProofBundle(hostile);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.structurallyValid, false);
      assert.ok(result.errors.includes('Signal verification could not be completed safely'));
      assertNoAuthoritativeSignalData(result);
    }
  });

  it('fails closed when an unchecked metadata mirror cannot be canonicalized', async () => {
    const bundle = await createSignalProofBundle({
      envelope: fixtureEnvelope(),
      task: { name: 'Non-canonical mirror fixture' },
      signingKey: ProofSigner.generateSecretKey(),
      signerIdentity: 'signal-internal-verifier',
    });
    (bundle.receipt.metadata.signalProfile as Record<string, unknown>).invalid = 1n;

    const result = await verifySignalProofBundle(bundle);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes('could not be canonicalized')));
    assertNoAuthoritativeSignalData(result);
  });

  it('fails closed on unsupported versions and reserved artifact-path collisions', async () => {
    const unsupported: unknown = {
      ...fixtureEnvelope(),
      profileVersion: '2.0.0',
    };
    assert.ok(validateSignalProofEnvelope(unsupported).some((error) => error.includes('version')));

    await assert.rejects(
      createSignalProofBundle({
        envelope: fixtureEnvelope(),
        task: { name: 'Reserved artifact fixture' },
        artifacts: [{ path: './signal-proof-envelope.json', data: '{}' }],
        signingKey: ProofSigner.generateSecretKey(),
        signerIdentity: 'signal-internal-verifier',
      }),
      /reserved/
    );
  });

  it('rejects uppercase digests and unknown envelope claims instead of dropping them', () => {
    const envelope = envelopeRecord();
    envelope.claimSnapshotDigest = `sha256:${'A'.repeat(64)}`;
    envelope.unreviewedClaim = { claim: 'must not be dropped' };
    (envelope.observer as Record<string, unknown>).unreviewedObserverClaim = true;
    (envelope.evaluator as Record<string, unknown>).unreviewedEvaluatorClaim = true;
    (envelope.evidence as Record<string, unknown>[])[0].unreviewedEvidenceClaim = true;

    const errors = validateSignalProofEnvelope(envelope);

    assert.ok(errors.includes('claimSnapshotDigest must use sha256:<64 lowercase hex> form'));
    assert.deepStrictEqual(
      errors.filter((error) => error.startsWith('Unknown')),
      [
        "Unknown Signal envelope field: 'unreviewedClaim'",
        "Unknown observer field: 'unreviewedObserverClaim'",
        "Unknown evaluator field: 'unreviewedEvaluatorClaim'",
        "Unknown evidence[0] field: 'unreviewedEvidenceClaim'",
      ]
    );
  });

  it('requires an offset timestamp with a real calendar date', () => {
    for (const timestamp of ['2026-08-21T22:00:00', '2026-02-30T22:00:00Z']) {
      const envelope = envelopeRecord();
      (envelope.observer as Record<string, unknown>).observedAt = timestamp;
      assert.ok(validateSignalProofEnvelope(envelope).includes('observer.observedAt must be an ISO-8601 timestamp'));
    }

    const validOffset = envelopeRecord();
    (validOffset.observer as Record<string, unknown>).observedAt = '2026-02-28T22:00:00.123+05:30';
    assert.ok(!validateSignalProofEnvelope(validOffset).includes('observer.observedAt must be an ISO-8601 timestamp'));
  });
});

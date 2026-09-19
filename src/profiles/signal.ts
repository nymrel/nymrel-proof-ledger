/**
 * Nymrel Signal customer-facing ProofReceipt attestation profile.
 *
 * The profile binds Signal identifiers, disclosure/claim snapshots and explicit
 * attestation scopes as a normal Proof Ledger artifact. It deliberately does
 * not change Proof Ledger v1 Merkle or signature semantics.
 */

import { createHash } from 'node:crypto';
import { canonicalize } from '../core/canonical.js';
import {
  createReceipt,
  verifyReceipt,
  type CreateReceiptOptions,
  type ProofReceipt,
  type VerificationResult,
  type VerifyReceiptOptions,
} from '../core/receipt.js';

export const SIGNAL_PROOF_PROFILE = 'nymrel-signal-proof-receipt' as const;
export const SIGNAL_PROOF_PROFILE_VERSION = '1.0.0' as const;
export const SIGNAL_PROOF_BUNDLE_PROFILE = 'nymrel-signal-proof-bundle' as const;
export const SIGNAL_PROOF_BUNDLE_VERSION = '1.0.0' as const;
export const SIGNAL_PROOF_ENVELOPE_PATH = 'signal-proof-envelope.json' as const;

export const SIGNAL_ATTESTED_SCOPES = [
  'artifact_integrity',
  'execution_observed',
  'timing_observed',
  'price_source_checked',
  'outcome_rubric_replayed',
  'identity_verified',
] as const;

export type SignalAttestedScope = (typeof SIGNAL_ATTESTED_SCOPES)[number];
export type SignalObserverKind = 'self' | 'system' | 'independent';
export type SignalEvidencePrivacy = 'public' | 'private' | 'restricted';
export type SignalSignatureMode =
  | 'not_checked'
  | 'shared_secret_integrity'
  | 'asymmetric_signature';

export interface SignalObserverV1 {
  kind: SignalObserverKind;
  id: string;
  observedAt: string;
  method?: string;
}

export interface SignalEvaluatorV1 {
  id: string;
  version: string;
}

export interface SignalEvidenceReferenceV1 {
  ref: string;
  privacy: SignalEvidencePrivacy;
  digest?: string;
}

export interface SignalProofEnvelopeV1 {
  profile: typeof SIGNAL_PROOF_PROFILE;
  profileVersion: typeof SIGNAL_PROOF_PROFILE_VERSION;
  signalReceiptId: string;
  needDropId?: string;
  challengeId?: string;
  claimSnapshotDigest: string;
  disclosureSnapshotDigest: string;
  attestedScopes: SignalAttestedScope[];
  observer: SignalObserverV1;
  evaluator?: SignalEvaluatorV1;
  evidence: SignalEvidenceReferenceV1[];
  limitations?: string[];
}

export interface SignalProofBundleV1 {
  profile: typeof SIGNAL_PROOF_BUNDLE_PROFILE;
  bundleVersion: typeof SIGNAL_PROOF_BUNDLE_VERSION;
  envelope: SignalProofEnvelopeV1;
  receipt: ProofReceipt;
}

export interface CreateSignalProofBundleOptions
  extends Omit<CreateReceiptOptions, 'artifacts' | 'metadata'> {
  envelope: SignalProofEnvelopeV1;
  artifacts?: CreateReceiptOptions['artifacts'];
  metadata?: Record<string, unknown>;
}

export interface SignalProofVerificationResult {
  valid: boolean;
  structurallyValid: boolean;
  profileValid: boolean;
  envelopeBound: boolean;
  signatureChecked: boolean;
  signatureMode: SignalSignatureMode;
  signerIdentityTrust: 'unresolved';
  core: VerificationResult;
  errors: string[];
  warnings: string[];
  authoritative: {
    signalReceiptId?: string;
    needDropId?: string;
    challengeId?: string;
    attestedScopes: SignalAttestedScope[];
    publicEvidenceRefs: string[];
    nonPublicEvidenceCount: number;
  };
  doesNotProve: string[];
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const ALLOWED_SCOPES = new Set<string>(SIGNAL_ATTESTED_SCOPES);
const ALLOWED_OBSERVER_KINDS = new Set<string>(['self', 'system', 'independent']);
const ALLOWED_PRIVACY = new Set<string>(['public', 'private', 'restricted']);
const ENVELOPE_FIELDS = new Set([
  'profile', 'profileVersion', 'signalReceiptId', 'needDropId', 'challengeId',
  'claimSnapshotDigest', 'disclosureSnapshotDigest', 'attestedScopes', 'observer',
  'evaluator', 'evidence', 'limitations',
]);
const OBSERVER_FIELDS = new Set(['kind', 'id', 'observedAt', 'method']);
const EVALUATOR_FIELDS = new Set(['id', 'version']);
const EVIDENCE_FIELDS = new Set(['ref', 'privacy', 'digest']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeArtifactPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (match === null) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (
    year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59
  ) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return false;
  }
  const offset = match[7];
  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return true;
}

function unknownFieldErrors(value: Record<string, unknown>, allowed: Set<string>, label: string): string[] {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `Unknown ${label} field: '${key}'`);
}

function cloneAndNormalizeEnvelope(envelope: SignalProofEnvelopeV1): SignalProofEnvelopeV1 {
  return {
    profile: envelope.profile,
    profileVersion: envelope.profileVersion,
    signalReceiptId: envelope.signalReceiptId.trim(),
    ...(envelope.needDropId ? { needDropId: envelope.needDropId.trim() } : {}),
    ...(envelope.challengeId ? { challengeId: envelope.challengeId.trim() } : {}),
    claimSnapshotDigest: envelope.claimSnapshotDigest.toLowerCase(),
    disclosureSnapshotDigest: envelope.disclosureSnapshotDigest.toLowerCase(),
    attestedScopes: [...new Set(envelope.attestedScopes)].sort(),
    observer: {
      kind: envelope.observer.kind,
      id: envelope.observer.id.trim(),
      observedAt: envelope.observer.observedAt,
      ...(envelope.observer.method ? { method: envelope.observer.method.trim() } : {}),
    },
    ...(envelope.evaluator
      ? {
          evaluator: {
            id: envelope.evaluator.id.trim(),
            version: envelope.evaluator.version.trim(),
          },
        }
      : {}),
    evidence: envelope.evidence
      .map((item) => ({
        ref: item.ref.trim(),
        privacy: item.privacy,
        ...(item.digest ? { digest: item.digest.toLowerCase() } : {}),
      }))
      .sort((a, b) => {
        const left = `${a.ref}\u0000${a.privacy}\u0000${a.digest ?? ''}`;
        const right = `${b.ref}\u0000${b.privacy}\u0000${b.digest ?? ''}`;
        return left < right ? -1 : left > right ? 1 : 0;
      }),
    ...(envelope.limitations
      ? {
          limitations: [...new Set(envelope.limitations.map((item) => item.trim()))]
            .filter(Boolean)
            .sort(),
        }
      : {}),
  };
}

/**
 * Returns validation errors without throwing. Unknown profile versions fail closed.
 */
export function validateSignalProofEnvelope(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['Signal proof envelope must be an object'];

  errors.push(...unknownFieldErrors(value, ENVELOPE_FIELDS, 'Signal envelope'));

  if (value.profile !== SIGNAL_PROOF_PROFILE) {
    errors.push(`Unsupported Signal profile: '${String(value.profile)}'`);
  }
  if (value.profileVersion !== SIGNAL_PROOF_PROFILE_VERSION) {
    errors.push(`Unsupported Signal profile version: '${String(value.profileVersion)}'`);
  }
  if (!isNonEmptyString(value.signalReceiptId)) {
    errors.push('signalReceiptId must be a non-empty string');
  }
  if (value.needDropId !== undefined && !isNonEmptyString(value.needDropId)) {
    errors.push('needDropId must be a non-empty string when present');
  }
  if (value.challengeId !== undefined && !isNonEmptyString(value.challengeId)) {
    errors.push('challengeId must be a non-empty string when present');
  }
  if (!isDigest(value.claimSnapshotDigest)) {
    errors.push('claimSnapshotDigest must use sha256:<64 lowercase hex> form');
  }
  if (!isDigest(value.disclosureSnapshotDigest)) {
    errors.push('disclosureSnapshotDigest must use sha256:<64 lowercase hex> form');
  }

  if (!Array.isArray(value.attestedScopes) || value.attestedScopes.length === 0) {
    errors.push('attestedScopes must contain at least one supported scope');
  } else {
    const seen = new Set<string>();
    for (const scope of value.attestedScopes) {
      if (typeof scope !== 'string' || !ALLOWED_SCOPES.has(scope)) {
        errors.push(`Unsupported attested scope: '${String(scope)}'`);
      } else if (seen.has(scope)) {
        errors.push(`Duplicate attested scope: '${scope}'`);
      }
      if (typeof scope === 'string') seen.add(scope);
    }
  }

  if (!isRecord(value.observer)) {
    errors.push('observer must be an object');
  } else {
    errors.push(...unknownFieldErrors(value.observer, OBSERVER_FIELDS, 'observer'));
    if (!ALLOWED_OBSERVER_KINDS.has(String(value.observer.kind))) {
      errors.push(`Unsupported observer kind: '${String(value.observer.kind)}'`);
    }
    if (!isNonEmptyString(value.observer.id)) {
      errors.push('observer.id must be a non-empty string');
    }
    if (!isIsoTimestamp(value.observer.observedAt)) {
      errors.push('observer.observedAt must be an ISO-8601 timestamp');
    }
    if (value.observer.method !== undefined && !isNonEmptyString(value.observer.method)) {
      errors.push('observer.method must be a non-empty string when present');
    }
  }

  if (value.evaluator !== undefined) {
    if (!isRecord(value.evaluator)) {
      errors.push('evaluator must be an object when present');
    } else {
      errors.push(...unknownFieldErrors(value.evaluator, EVALUATOR_FIELDS, 'evaluator'));
      if (!isNonEmptyString(value.evaluator.id)) errors.push('evaluator.id must be non-empty');
      if (!isNonEmptyString(value.evaluator.version)) {
        errors.push('evaluator.version must be non-empty');
      }
    }
  }

  if (!Array.isArray(value.evidence)) {
    errors.push('evidence must be an array');
  } else {
    value.evidence.forEach((item, index) => {
      if (!isRecord(item)) {
        errors.push(`evidence[${index}] must be an object`);
        return;
      }
      errors.push(...unknownFieldErrors(item, EVIDENCE_FIELDS, `evidence[${index}]`));
      if (!isNonEmptyString(item.ref)) errors.push(`evidence[${index}].ref must be non-empty`);
      if (!ALLOWED_PRIVACY.has(String(item.privacy))) {
        errors.push(`evidence[${index}].privacy is unsupported`);
      }
      if (item.digest !== undefined && !isDigest(item.digest)) {
        errors.push(`evidence[${index}].digest must use sha256:<64 lowercase hex> form`);
      }
    });
  }

  if (value.limitations !== undefined) {
    if (!Array.isArray(value.limitations)) {
      errors.push('limitations must be an array when present');
    } else {
      value.limitations.forEach((item, index) => {
        if (!isNonEmptyString(item)) errors.push(`limitations[${index}] must be non-empty`);
      });
    }
  }

  return errors;
}

/** Canonicalizes a valid Signal envelope for cryptographic binding. */
export function canonicalizeSignalProofEnvelope(envelope: SignalProofEnvelopeV1): string {
  const errors = validateSignalProofEnvelope(envelope);
  if (errors.length > 0) throw new TypeError(errors.join('; '));
  return canonicalize(cloneAndNormalizeEnvelope(envelope));
}

/** Computes the canonical envelope digest in `sha256:<hex>` form. */
export function digestSignalProofEnvelope(envelope: SignalProofEnvelopeV1): string {
  return `sha256:${createHash('sha256')
    .update(canonicalizeSignalProofEnvelope(envelope), 'utf8')
    .digest('hex')}`;
}

function mirrorFromEnvelope(envelope: SignalProofEnvelopeV1): Record<string, unknown> {
  const normalized = cloneAndNormalizeEnvelope(envelope);
  return {
    profile: normalized.profile,
    profileVersion: normalized.profileVersion,
    signalReceiptId: normalized.signalReceiptId,
    ...(normalized.needDropId ? { needDropId: normalized.needDropId } : {}),
    ...(normalized.challengeId ? { challengeId: normalized.challengeId } : {}),
    attestedScopes: normalized.attestedScopes,
  };
}

/**
 * Creates a portable Signal bundle. The canonical envelope is the authoritative
 * Signal artifact; `receipt.metadata.signalProfile` is a convenience mirror only.
 */
export async function createSignalProofBundle(
  options: CreateSignalProofBundleOptions
): Promise<SignalProofBundleV1> {
  const envelopeErrors = validateSignalProofEnvelope(options.envelope);
  if (envelopeErrors.length > 0) throw new TypeError(envelopeErrors.join('; '));

  for (const artifact of options.artifacts ?? []) {
    if (normalizeArtifactPath(artifact.path) === SIGNAL_PROOF_ENVELOPE_PATH) {
      throw new TypeError(`Artifact path '${SIGNAL_PROOF_ENVELOPE_PATH}' is reserved by the Signal profile`);
    }
  }

  const normalizedEnvelope = cloneAndNormalizeEnvelope(options.envelope);
  const envelopeData = canonicalize(normalizedEnvelope);
  const receipt = await createReceipt({
    ...options,
    artifacts: [
      {
        path: SIGNAL_PROOF_ENVELOPE_PATH,
        data: envelopeData,
        mimeType: 'application/json',
      },
      ...(options.artifacts ?? []),
    ],
    metadata: {
      ...(options.metadata ?? {}),
      signalProfile: mirrorFromEnvelope(normalizedEnvelope),
    },
  });

  return {
    profile: SIGNAL_PROOF_BUNDLE_PROFILE,
    bundleVersion: SIGNAL_PROOF_BUNDLE_VERSION,
    envelope: normalizedEnvelope,
    receipt,
  };
}

function compareMirror(receipt: ProofReceipt, envelope: SignalProofEnvelopeV1): string[] {
  const mirror = receipt.metadata?.signalProfile;
  if (mirror === undefined) return [];
  if (!isRecord(mirror)) return ['receipt.metadata.signalProfile must be an object when present'];

  try {
    const expected = canonicalize(mirrorFromEnvelope(envelope));
    const actual = canonicalize(mirror);
    return expected === actual
      ? []
      : ['Unbound receipt.metadata.signalProfile disagrees with the authoritative bound envelope'];
  } catch {
    return ['receipt.metadata.signalProfile could not be canonicalized'];
  }
}

function deriveDoesNotProve(scopes: SignalAttestedScope[]): string[] {
  const scopeSet = new Set(scopes);
  const boundaries = [
    'subjective product quality or universal customer fit',
    'testimonial neutrality or absence of bias',
    'signer identity or authority without an external trusted-key resolution policy',
  ];
  if (!scopeSet.has('identity_verified')) boundaries.push('customer or participant identity');
  if (!scopeSet.has('timing_observed')) boundaries.push('reported timing or duration');
  if (!scopeSet.has('price_source_checked')) boundaries.push('current price or commercial terms');
  if (!scopeSet.has('execution_observed')) boundaries.push('that the described execution occurred');
  if (!scopeSet.has('outcome_rubric_replayed')) boundaries.push('that a qualitative outcome was independently reproduced');
  return boundaries;
}

function failedCoreVerification(): VerificationResult {
  return {
    valid: false,
    trusted: false,
    merkleValid: false,
    signatureChecked: false,
    signatureValid: null,
    artifactsValid: false,
    errors: ['Verification could not be completed safely'],
    warnings: [],
    checkedArtifacts: 0,
    receipt: null,
  };
}

function failedSignalProofVerification(): SignalProofVerificationResult {
  return {
    valid: false,
    structurallyValid: false,
    profileValid: false,
    envelopeBound: false,
    signatureChecked: false,
    signatureMode: 'not_checked',
    signerIdentityTrust: 'unresolved',
    core: failedCoreVerification(),
    errors: ['Signal verification could not be completed safely'],
    warnings: [],
    authoritative: {
      signalReceiptId: undefined,
      needDropId: undefined,
      challengeId: undefined,
      attestedScopes: [],
      publicEvidenceRefs: [],
      nonPublicEvidenceCount: 0,
    },
    doesNotProve: deriveDoesNotProve([]),
  };
}

/**
 * Verifies the core Proof Ledger receipt and the Signal-specific binding.
 * `valid` requires a supplied verification key; structural integrity is exposed
 * separately so callers cannot mistake an unchecked signature for verification.
 */
async function verifySignalProofBundleInternal(
  bundle: unknown,
  options: VerifyReceiptOptions = {}
): Promise<SignalProofVerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bundleRecord = isRecord(bundle) ? bundle : undefined;

  if (bundleRecord === undefined) {
    errors.push('Signal proof bundle must be an object');
  }
  if (bundleRecord?.profile !== SIGNAL_PROOF_BUNDLE_PROFILE) {
    errors.push(`Unsupported Signal bundle profile: '${String(bundleRecord?.profile)}'`);
  }
  if (bundleRecord?.bundleVersion !== SIGNAL_PROOF_BUNDLE_VERSION) {
    errors.push(`Unsupported Signal bundle version: '${String(bundleRecord?.bundleVersion)}'`);
  }

  const envelopeErrors = validateSignalProofEnvelope(bundleRecord?.envelope);
  errors.push(...envelopeErrors);
  const profileValidBeforeBinding = errors.length === 0;

  let core: VerificationResult;
  try {
    core = await verifyReceipt(bundleRecord?.receipt, options);
  } catch {
    core = failedCoreVerification();
  }
  errors.push(...core.errors.map((item) => `Proof Ledger: ${item}`));
  warnings.push(...core.warnings.map((item) => `Proof Ledger: ${item}`));

  let envelopeBound = false;
  let normalizedEnvelope: SignalProofEnvelopeV1 | undefined;
  if (envelopeErrors.length === 0 && core.receipt !== null) {
    normalizedEnvelope = cloneAndNormalizeEnvelope(
      bundleRecord?.envelope as SignalProofEnvelopeV1
    );
    const canonicalEnvelope = canonicalize(normalizedEnvelope);
    const expectedHash = createHash('sha256').update(canonicalEnvelope, 'utf8').digest('hex');
    const expectedSize = Buffer.byteLength(canonicalEnvelope, 'utf8');
    const envelopeArtifacts = core.receipt.artifacts.filter(
      (item) => normalizeArtifactPath(item.path) === SIGNAL_PROOF_ENVELOPE_PATH
    );

    if (envelopeArtifacts.length !== 1) {
      errors.push(
        `Signal bundle must bind exactly one '${SIGNAL_PROOF_ENVELOPE_PATH}' artifact; found ${envelopeArtifacts.length}`
      );
    } else {
      const artifact = envelopeArtifacts[0];
      if (artifact.sha256.toLowerCase() !== expectedHash) {
        errors.push('Bound Signal envelope digest does not match the portable envelope payload');
      } else if (artifact.sizeBytes !== expectedSize) {
        errors.push('Bound Signal envelope size does not match the portable envelope payload');
      } else {
        envelopeBound = true;
      }
      if (artifact.mimeType && artifact.mimeType !== 'application/json') {
        errors.push(`Signal envelope artifact has unexpected mimeType '${artifact.mimeType}'`);
      }
    }

    errors.push(...compareMirror(core.receipt, normalizedEnvelope));
  }

  const signatureChecked = core.signatureChecked;
  if (!signatureChecked) {
    warnings.push('Signal validity is not established because no verification key was supplied');
  }

  let signatureMode: SignalSignatureMode = 'not_checked';
  if (signatureChecked && core.signatureValid && core.receipt !== null) {
    signatureMode =
      core.receipt.signature.algorithm === 'Ed25519'
        ? 'asymmetric_signature'
        : 'shared_secret_integrity';
  }

  const profileErrors = errors.filter((item) => !item.startsWith('Proof Ledger:'));
  const profileValid = profileValidBeforeBinding && profileErrors.length === 0;
  const structurallyValid =
    envelopeBound &&
    profileValid &&
    core.merkleValid &&
    core.artifactsValid &&
    core.errors.length === 0;
  const valid = Boolean(structurallyValid && core.trusted);
  const authoritativeEnvelope = valid ? normalizedEnvelope : undefined;

  return {
    valid,
    structurallyValid,
    profileValid,
    envelopeBound,
    signatureChecked,
    signatureMode,
    signerIdentityTrust: 'unresolved',
    core,
    errors,
    warnings,
    authoritative: {
      signalReceiptId: authoritativeEnvelope?.signalReceiptId,
      needDropId: authoritativeEnvelope?.needDropId,
      challengeId: authoritativeEnvelope?.challengeId,
      attestedScopes: authoritativeEnvelope?.attestedScopes ?? [],
      publicEvidenceRefs:
        authoritativeEnvelope?.evidence
          .filter((item) => item.privacy === 'public')
          .map((item) => item.ref) ?? [],
      nonPublicEvidenceCount:
        authoritativeEnvelope?.evidence.filter((item) => item.privacy !== 'public').length ?? 0,
    },
    doesNotProve: deriveDoesNotProve(authoritativeEnvelope?.attestedScopes ?? []),
  };
}

export async function verifySignalProofBundle(
  bundle: unknown,
  options: VerifyReceiptOptions = {}
): Promise<SignalProofVerificationResult> {
  try {
    return await verifySignalProofBundleInternal(bundle, options);
  } catch {
    return failedSignalProofVerification();
  }
}

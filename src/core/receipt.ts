/**
 * Cryptographic Proof-of-Execution Receipt Engine.
 *
 * Implements structured, machine-verifiable attestation records anchoring
 * execution artifacts, environment metadata, and git lineage into an immutable
 * Merkle Tree and signed receipt.
 *
 * @module @nymrel/proof-ledger/core/receipt
 */

import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { canonicalHash, canonicalize } from './canonical.js';
import { MerkleTree } from './merkle.js';
import { ProofSigner, type SignatureAlgorithm, type SignatureRecord } from './signer.js';

export interface ProofTask {
  name: string;
  description?: string;
  runner: string;
  status: 'SUCCESS' | 'FAILURE' | 'ATTESTED' | 'WARNING';
  exitCode: number;
  durationMs?: number;
  command?: string;
}

export interface ProofGitContext {
  commit: string;
  branch: string;
  dirty: boolean;
  remote?: string;
}

export interface ProofEnvironment {
  platform: string;
  arch: string;
  hostname?: string;
  runtime: string;
  git?: ProofGitContext;
}

export interface ProofArtifact {
  path: string;
  sha256: string;
  sizeBytes: number;
  mimeType?: string;
}

export interface ProofReceipt {
  version: '1.0.0';
  protocol: 'nymrel-proof-ledger';
  proofId: string;
  timestamp: string;
  parentOrganization: 'Nymrel -> JalenBuilds LLC';
  task: ProofTask;
  environment: ProofEnvironment;
  artifacts: ProofArtifact[];
  merkle: {
    algorithm: 'SHA-256';
    leaves: string[];
    root: string;
  };
  signature: SignatureRecord;
  metadata: Record<string, unknown>;
}

export interface CreateReceiptOptions {
  task: Partial<ProofTask> & { name: string };
  artifacts?: Array<{ path: string; data?: Buffer | string; mimeType?: string }>;
  signingKey: string;
  signerIdentity: string;
  keyId?: string;
  algorithm?: SignatureAlgorithm;
  metadata?: Record<string, unknown>;
  cwd?: string;
  includeHostname?: boolean;
}

export interface VerificationResult {
  valid: boolean;
  merkleValid: boolean;
  signatureValid: boolean;
  artifactsValid: boolean;
  errors: string[];
  warnings: string[];
  checkedArtifacts: number;
  receipt: ProofReceipt;
}

export interface VerifyReceiptOptions {
  publicKeyOrSecret?: string;
  checkFilesOnDisk?: boolean;
  cwd?: string;
}

/**
 * Gathers Git repository context safely without throwing on non-git directories.
 */
export function getGitContext(cwd: string = process.cwd()): ProofGitContext | undefined {
  try {
    const commit = execSync('git rev-parse HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const statusOut = execSync('git status --porcelain', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    let remote: string | undefined;
    try {
      remote = execSync('git config --get remote.origin.url', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      // Remote may not exist
    }

    return {
      commit,
      branch,
      dirty: statusOut.length > 0,
      ...(remote ? { remote } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Computes SHA-256 hash and size of a file or buffer.
 */
export async function hashArtifact(
  artifactPath: string,
  data?: Buffer | string,
  cwd: string = process.cwd()
): Promise<ProofArtifact> {
  let buffer: Buffer;
  const resolvedPath = path.isAbsolute(artifactPath) ? artifactPath : path.resolve(cwd, artifactPath);

  if (data !== undefined) {
    buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  } else {
    buffer = await fs.readFile(resolvedPath);
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const relPath = path.relative(cwd, resolvedPath).replace(/\\/g, '/');

  return {
    path: relPath || artifactPath,
    sha256,
    sizeBytes: buffer.length,
  };
}

/**
 * Generates an attestation proof receipt.
 */
export async function createReceipt(options: CreateReceiptOptions): Promise<ProofReceipt> {
  const cwd = options.cwd || process.cwd();
  const proofId = `prf_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
  const timestamp = new Date().toISOString();

  // 1. Process Artifacts
  const artifacts: ProofArtifact[] = [];
  if (options.artifacts && options.artifacts.length > 0) {
    for (const item of options.artifacts) {
      const art = await hashArtifact(item.path, item.data, cwd);
      if (item.mimeType) art.mimeType = item.mimeType;
      artifacts.push(art);
    }
  }

  // 2. Build Environment Record
  const environment: ProofEnvironment = {
    platform: os.platform(),
    arch: os.arch(),
    ...(options.includeHostname ? { hostname: os.hostname() } : {}),
    runtime: `node ${process.version}`,
    git: getGitContext(cwd),
  };

  // 3. Build Task Record
  const task: ProofTask = {
    name: options.task.name,
    description: options.task.description,
    runner: options.task.runner || 'nymrel-agent',
    status: options.task.status || 'SUCCESS',
    exitCode: options.task.exitCode ?? 0,
    durationMs: options.task.durationMs,
    command: options.task.command,
  };

  // 4. Construct Merkle Leaves
  // Leaf 1: Canonical Task Hash
  const taskHash = canonicalHash(task);
  // Leaf 2: Canonical Environment Hash
  const envHash = canonicalHash(environment);

  // Remaining leaves: Artifact hashes
  const artifactLeaves = artifacts.map((a) => a.sha256);

  const rawLeaves = [taskHash, envHash, ...artifactLeaves];
  const merkleTree = new MerkleTree(rawLeaves, { isPreHashed: true });
  const merkleRoot = merkleTree.getRoot();

  // 5. Sign the Proof Payload (proofId + timestamp + merkleRoot + parentOrganization)
  const signPayloadObj = {
    proofId,
    timestamp,
    parentOrganization: 'Nymrel -> JalenBuilds LLC',
    taskName: task.name,
    merkleRoot,
  };

  const algorithm = options.algorithm || 'HMAC-SHA256';
  const keyId = options.keyId || (algorithm === 'Ed25519' ? 'ed25519-primary' : 'hmac-default');

  const signature = ProofSigner.createSignatureRecord(
    signPayloadObj,
    options.signingKey,
    options.signerIdentity,
    keyId,
    algorithm
  );

  return {
    version: '1.0.0',
    protocol: 'nymrel-proof-ledger',
    proofId,
    timestamp,
    parentOrganization: 'Nymrel -> JalenBuilds LLC',
    task,
    environment,
    artifacts,
    merkle: {
      algorithm: 'SHA-256',
      leaves: merkleTree.getLeaves(),
      root: merkleRoot,
    },
    signature,
    metadata: options.metadata || {},
  };
}

/**
 * Verifies a proof receipt against mathematical, artifact, and cryptographic invariants.
 */
export async function verifyReceipt(
  receipt: ProofReceipt,
  options: VerifyReceiptOptions = {}
): Promise<VerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cwd = options.cwd || process.cwd();

  // 1. Basic Protocol & Schema checks
  if (receipt.protocol !== 'nymrel-proof-ledger') {
    errors.push(`Invalid protocol identifier: expected 'nymrel-proof-ledger', got '${receipt.protocol}'`);
  }
  if (receipt.version !== '1.0.0') {
    errors.push(`Unsupported proof version: '${receipt.version}'`);
  }
  if (!receipt.proofId || !receipt.merkle || !receipt.signature) {
    errors.push('Malformed receipt structure: missing required core fields');
  }

  // 2. Merkle Root Integrity
  const taskHash = canonicalHash(receipt.task);
  const envHash = canonicalHash(receipt.environment);
  const artifactLeaves = receipt.artifacts.map((a) => a.sha256);
  const expectedRawLeaves = [taskHash, envHash, ...artifactLeaves];

  const calculatedTree = new MerkleTree(expectedRawLeaves, { isPreHashed: true });
  const calculatedRoot = calculatedTree.getRoot();

  let merkleValid = true;
  if (calculatedRoot.toLowerCase() !== receipt.merkle.root.toLowerCase()) {
    merkleValid = false;
    errors.push(
      `Merkle root mismatch! Expected '${receipt.merkle.root}', recalculated '${calculatedRoot}'`
    );
  }

  // 3. Artifact verification on disk (if requested)
  let artifactsValid = true;
  let checkedArtifacts = 0;

  if (options.checkFilesOnDisk && receipt.artifacts.length > 0) {
    for (const art of receipt.artifacts) {
      const fullPath = path.isAbsolute(art.path) ? art.path : path.resolve(cwd, art.path);
      try {
        const fileData = await fs.readFile(fullPath);
        const actualHash = createHash('sha256').update(fileData).digest('hex');
        checkedArtifacts++;
        if (actualHash.toLowerCase() !== art.sha256.toLowerCase()) {
          artifactsValid = false;
          errors.push(`Artifact tampered: '${art.path}' (hash mismatch)`);
        }
      } catch (err: unknown) {
        artifactsValid = false;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Artifact missing on disk: '${art.path}' (${msg})`);
      }
    }
  }

  // 4. Signature Verification
  let signatureValid = true;
  if (options.publicKeyOrSecret) {
    const signPayloadObj = {
      proofId: receipt.proofId,
      timestamp: receipt.timestamp,
      parentOrganization: receipt.parentOrganization,
      taskName: receipt.task.name,
      merkleRoot: receipt.merkle.root,
    };

    const isVerified = ProofSigner.verifySignature(
      signPayloadObj,
      receipt.signature.value,
      options.publicKeyOrSecret,
      receipt.signature.algorithm
    );

    if (!isVerified) {
      signatureValid = false;
      errors.push(`Cryptographic signature verification failed with provided key`);
    }
  } else {
    warnings.push('Signature was not cryptographically verified (no public key / secret key provided)');
  }

  const valid = errors.length === 0;

  return {
    valid,
    merkleValid,
    signatureValid,
    artifactsValid,
    errors,
    warnings,
    checkedArtifacts,
    receipt,
  };
}

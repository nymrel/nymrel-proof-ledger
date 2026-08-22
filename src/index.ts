/**
 * @nymrel/proof-ledger
 *
 * Zero-dependency dual-language cryptographic attestation and proof-of-execution
 * protocol library and CLI.
 *
 * @packageDocumentation
 */

import {
  createReceipt,
  verifyReceipt,
  type CreateReceiptOptions,
  type ProofReceipt,
  type VerificationResult,
  type VerifyReceiptOptions,
} from './core/receipt.js';
import { generateSvgBadge, generateShieldSvg, generateHtmlCertificate, type BadgeOptions } from './visual/badge.js';
import { MerkleTree } from './core/merkle.js';
import { ProofSigner } from './core/signer.js';

// Core exports
export * from './core/canonical.js';
export * from './core/merkle.js';
export * from './core/signer.js';
export * from './core/receipt.js';
export * from './profiles/signal.js';
export * from './visual/qr.js';
export * from './visual/badge.js';

/**
 * Public high-level function: attest execution and generate a signed proof receipt.
 */
export async function attestExecution(options: CreateReceiptOptions): Promise<ProofReceipt> {
  return createReceipt(options);
}

/**
 * Public high-level function: verify a proof receipt against Merkle invariants and cryptographic signature.
 */
export async function verifyProof(
  receipt: ProofReceipt,
  options?: VerifyReceiptOptions
): Promise<VerificationResult> {
  return verifyReceipt(receipt, options);
}

/**
 * Public high-level function: generate a self-contained SVG proof badge.
 */
export function generateBadge(receipt: ProofReceipt, options?: BadgeOptions): string {
  return generateSvgBadge(receipt, options);
}

/**
 * High-level orchestration class for Proof Ledger workflows.
 */
export class ProofLedger {
  /**
   * Generates a new random cryptographic secret key (HMAC-SHA256).
   */
  public static generateSecretKey(): string {
    return ProofSigner.generateSecretKey();
  }

  /**
   * Generates an Ed25519 public/private keypair.
   */
  public static generateKeyPair() {
    return ProofSigner.generateKeyPair();
  }

  /**
   * Attests a task execution, hashes artifacts, calculates Merkle root, and signs the receipt.
   */
  public static async attest(options: CreateReceiptOptions): Promise<ProofReceipt> {
    return createReceipt(options);
  }

  /**
   * Verifies an existing attestation receipt.
   */
  public static async verify(receipt: ProofReceipt, options?: VerifyReceiptOptions): Promise<VerificationResult> {
    return verifyReceipt(receipt, options);
  }

  /**
   * Generates visual badges (SVG / HTML / Shield).
   */
  public static badge = {
    svg: generateSvgBadge,
    shield: generateShieldSvg,
    html: generateHtmlCertificate,
  };

  /**
   * Merkle tree utilities.
   */
  public static merkle = MerkleTree;
}

export default ProofLedger;

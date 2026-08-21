/**
 * Cryptographic Signing and Verification Engine.
 *
 * Implements:
 * - HMAC-SHA256 (Symmetric keyed-hash authentication)
 * - Ed25519 (Asymmetric EdDSA high-speed curve25519 signatures)
 *
 * All payloads are canonicalized per RFC 8785 before signing.
 *
 * @module @nymrel/proof-ledger/core/signer
 */

import {
  createHmac,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
  type KeyObject,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto';
import { canonicalize } from './canonical.js';

export type SignatureAlgorithm = 'HMAC-SHA256' | 'Ed25519';

export interface KeyPair {
  publicKey: string;
  privateKey: string;
  algorithm: 'Ed25519';
}

export interface SignatureRecord {
  algorithm: SignatureAlgorithm;
  keyId: string;
  signerIdentity: string;
  value: string;
  timestamp: string;
}

/**
 * Generates a cryptographic key or keypair.
 */
export class ProofSigner {
  /**
   * Generates a 256-bit random hex secret key for HMAC-SHA256.
   */
  public static generateSecretKey(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Generates an Ed25519 public/private keypair encoded in PEM format.
   */
  public static generateKeyPair(): KeyPair {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    return {
      publicKey: publicKey.toString(),
      privateKey: privateKey.toString(),
      algorithm: 'Ed25519',
    };
  }

  /**
   * Cryptographically signs an arbitrary object or string payload.
   *
   * @param payload - The payload to sign (canonicalized automatically).
   * @param privateKeyOrSecret - The private key (PEM for Ed25519) or secret key (hex/string for HMAC).
   * @param algorithm - 'HMAC-SHA256' or 'Ed25519'.
   * @returns Lowercase hex-encoded signature.
   */
  public static signPayload(
    payload: unknown,
    privateKeyOrSecret: string,
    algorithm: SignatureAlgorithm = 'HMAC-SHA256'
  ): string {
    const canonicalPayload = typeof payload === 'string' ? payload : canonicalize(payload);
    const payloadBuffer = Buffer.from(canonicalPayload, 'utf8');

    if (algorithm === 'HMAC-SHA256') {
      const hmac = createHmac('sha256', privateKeyOrSecret);
      hmac.update(payloadBuffer);
      return hmac.digest('hex');
    }

    if (algorithm === 'Ed25519') {
      let keyObj: KeyObject;
      try {
        keyObj = createPrivateKey(privateKeyOrSecret);
      } catch {
        // If raw hex/base64 was provided, format as PKCS8 or try DER
        throw new Error('Ed25519 private key must be a valid PEM formatted string');
      }

      const sigBuffer = cryptoSign(null, payloadBuffer, keyObj);
      return sigBuffer.toString('hex');
    }

    throw new Error(`Unsupported signature algorithm: ${algorithm}`);
  }

  /**
   * Verifies a signature against a payload.
   *
   * @param payload - The original unsigned payload.
   * @param signatureHex - The hex signature string to verify.
   * @param publicKeyOrSecret - The public key (PEM for Ed25519) or secret key (for HMAC).
   * @param algorithm - 'HMAC-SHA256' or 'Ed25519'.
   * @returns True if the signature is valid, false otherwise.
   */
  public static verifySignature(
    payload: unknown,
    signatureHex: string,
    publicKeyOrSecret: string,
    algorithm: SignatureAlgorithm = 'HMAC-SHA256'
  ): boolean {
    try {
      const canonicalPayload = typeof payload === 'string' ? payload : canonicalize(payload);
      const payloadBuffer = Buffer.from(canonicalPayload, 'utf8');
      const sigBuffer = Buffer.from(signatureHex, 'hex');

      if (algorithm === 'HMAC-SHA256') {
        const hmac = createHmac('sha256', publicKeyOrSecret);
        hmac.update(payloadBuffer);
        const expectedBuffer = hmac.digest();

        if (sigBuffer.length !== expectedBuffer.length) {
          return false;
        }
        return timingSafeEqual(sigBuffer, expectedBuffer);
      }

      if (algorithm === 'Ed25519') {
        const keyObj = createPublicKey(publicKeyOrSecret);
        return cryptoVerify(null, payloadBuffer, keyObj, sigBuffer);
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Creates a signed signature record for inclusion in a Proof Receipt.
   */
  public static createSignatureRecord(
    payload: unknown,
    privateKeyOrSecret: string,
    signerIdentity: string,
    keyId: string,
    algorithm: SignatureAlgorithm = 'HMAC-SHA256'
  ): SignatureRecord {
    const value = ProofSigner.signPayload(payload, privateKeyOrSecret, algorithm);
    return {
      algorithm,
      keyId,
      signerIdentity,
      value,
      timestamp: new Date().toISOString(),
    };
  }
}

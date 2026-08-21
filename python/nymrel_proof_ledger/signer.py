"""
Cryptographic Signing and Verification Engine in Python.

Implements:
- HMAC-SHA256 (Symmetric keyed-hash message authentication)
- Ed25519 (Asymmetric EdDSA signatures via standard cryptography / pure-python RFC 8032)

Zero external dependencies required.
"""

from datetime import datetime, timezone
import hashlib
import hmac
import os
import secrets
from typing import Dict, Any, Tuple, Optional
from .canonical import canonicalize

# Curve25519 / Ed25519 Field Constants (RFC 8032)
_Q = 2**255 - 19
_L = 2**252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _Q - 2, _Q) % _Q
_I = pow(2, (_Q - 1) // 4, _Q)


def _inv(z: int) -> int:
    return pow(z, _Q - 2, _Q)


def _xrecover(y: int) -> int:
    xx = (y * y - 1) * _inv(_D * y * y + 1)
    x = pow(xx, (_Q + 3) // 8, _Q)
    if (x * x - xx) % _Q != 0:
        x = (x * _I) % _Q
    if x % 2 != 0:
        x = _Q - x
    return x


_BY = 4 * _inv(5) % _Q
_BX = _xrecover(_BY)
_B = (_BX, _BY, 1, (_BX * _BY) % _Q)


def _ed_add(p: Tuple[int, int, int, int], q: Tuple[int, int, int, int]) -> Tuple[int, int, int, int]:
    x1, y1, z1, t1 = p
    x2, y2, z2, t2 = q
    a = (y1 - x1) * (y2 - x2) % _Q
    b = (y1 + x1) * (y2 + x2) % _Q
    c = t1 * 2 * _D * t2 % _Q
    d = z1 * 2 * z2 % _Q
    e = b - a
    f = d - c
    g = d + c
    h = b + a
    return (e * f % _Q, g * h % _Q, f * g % _Q, e * h % _Q)


def _scalarmult(p: Tuple[int, int, int, int], e: int) -> Tuple[int, int, int, int]:
    if e == 0:
        return (0, 1, 1, 0)
    q = _scalarmult(p, e // 2)
    q = _ed_add(q, q)
    if e & 1:
        q = _ed_add(q, p)
    return q


def _encodepoint(p: Tuple[int, int, int, int]) -> bytes:
    x, y, z, _ = p
    zi = _inv(z)
    x_aff = (x * zi) % _Q
    y_aff = (y * zi) % _Q
    out = bytearray(y_aff.to_bytes(32, "little"))
    if x_aff & 1:
        out[31] |= 0x80
    return bytes(out)


def _decodepoint(s: bytes) -> Optional[Tuple[int, int, int, int]]:
    if len(s) != 32:
        return None
    y = int.from_bytes(s[:31] + bytes([s[31] & 0x7F]), "little")
    if y >= _Q:
        return None
    x = _xrecover(y)
    if (s[31] & 0x80 != 0) != (x & 1 != 0):
        x = _Q - x
    return (x, y, 1, (x * y) % _Q)


def _ed25519_sign_pure(secret_seed: bytes, msg: bytes) -> bytes:
    h = hashlib.sha512(secret_seed).digest()
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    pub_point = _scalarmult(_B, a)
    pub_bytes = _encodepoint(pub_point)

    r_hash = hashlib.sha512(h[32:] + msg).digest()
    r = int.from_bytes(r_hash, "little") % _L
    r_point = _scalarmult(_B, r)
    r_bytes = _encodepoint(r_point)

    k_hash = hashlib.sha512(r_bytes + pub_bytes + msg).digest()
    k = int.from_bytes(k_hash, "little") % _L
    s = (r + k * a) % _L
    s_bytes = s.to_bytes(32, "little")

    return r_bytes + s_bytes


def _ed25519_verify_pure(pub_bytes: bytes, msg: bytes, sig: bytes) -> bool:
    if len(sig) != 64 or len(pub_bytes) != 32:
        return False
    r_bytes = sig[:32]
    s_bytes = sig[32:]
    s = int.from_bytes(s_bytes, "little")
    if s >= _L:
        return False

    a_point = _decodepoint(pub_bytes)
    r_point = _decodepoint(r_bytes)
    if a_point is None or r_point is None:
        return False

    k_hash = hashlib.sha512(r_bytes + pub_bytes + msg).digest()
    k = int.from_bytes(k_hash, "little") % _L

    sb_point = _scalarmult(_B, s)
    ra_point = _ed_add(r_point, _scalarmult(a_point, k))
    return _encodepoint(sb_point) == _encodepoint(ra_point)


class ProofSigner:
    """
    Cryptographic Signing and Verification Manager for Python.
    """

    @staticmethod
    def generate_secret_key() -> str:
        """Generates a 256-bit random hex secret key for HMAC-SHA256."""
        return secrets.token_hex(32)

    @staticmethod
    def generate_key_pair() -> Dict[str, str]:
        """Generates an Ed25519 seed/public key pair encoded in hex."""
        seed = os.urandom(32)
        h = hashlib.sha512(seed).digest()
        a = int.from_bytes(h[:32], "little")
        a &= (1 << 254) - 8
        a |= 1 << 254
        pub_point = _scalarmult(_B, a)
        pub_bytes = _encodepoint(pub_point)

        return {
            "algorithm": "Ed25519",
            "privateKey": seed.hex(),
            "publicKey": pub_bytes.hex(),
        }

    @staticmethod
    def sign_payload(payload: Any, private_key_or_secret: str, algorithm: str = "HMAC-SHA256") -> str:
        """
        Signs an arbitrary object or string with canonical JSON representation.
        """
        canonical_str = canonicalize(payload) if not isinstance(payload, str) else payload
        msg_bytes = canonical_str.encode("utf-8")

        if algorithm == "HMAC-SHA256":
            key_bytes = private_key_or_secret.encode("utf-8")
            return hmac.new(key_bytes, msg_bytes, hashlib.sha256).hexdigest()

        if algorithm == "Ed25519":
            # Handle hex private key / seed
            try:
                seed_bytes = bytes.fromhex(private_key_or_secret)
                if len(seed_bytes) != 32:
                    raise ValueError("Seed must be 32 bytes")
            except Exception:
                # Derive 32-byte seed via SHA256 if text string was provided
                seed_bytes = hashlib.sha256(private_key_or_secret.encode("utf-8")).digest()

            sig_bytes = _ed25519_sign_pure(seed_bytes, msg_bytes)
            return sig_bytes.hex()

        raise ValueError(f"Unsupported signature algorithm: {algorithm}")

    @staticmethod
    def verify_signature(payload: Any, signature_hex: str, public_key_or_secret: str, algorithm: str = "HMAC-SHA256") -> bool:
        """
        Verifies a signature against a payload.
        """
        try:
            canonical_str = canonicalize(payload) if not isinstance(payload, str) else payload
            msg_bytes = canonical_str.encode("utf-8")

            if algorithm == "HMAC-SHA256":
                key_bytes = public_key_or_secret.encode("utf-8")
                expected_sig = hmac.new(key_bytes, msg_bytes, hashlib.sha256).hexdigest()
                return hmac.compare_digest(signature_hex.lower(), expected_sig.lower())

            if algorithm == "Ed25519":
                sig_bytes = bytes.fromhex(signature_hex)
                try:
                    pub_bytes = bytes.fromhex(public_key_or_secret)
                except Exception:
                    pub_bytes = hashlib.sha256(public_key_or_secret.encode("utf-8")).digest()
                return _ed25519_verify_pure(pub_bytes, msg_bytes, sig_bytes)

            return False
        except Exception:
            return False

    @staticmethod
    def create_signature_record(
        payload: Any,
        private_key_or_secret: str,
        signer_identity: str,
        key_id: str,
        algorithm: str = "HMAC-SHA256",
    ) -> Dict[str, str]:
        """Creates a signed signature dictionary for inclusion in proof receipts."""
        sig_value = ProofSigner.sign_payload(payload, private_key_or_secret, algorithm)
        return {
            "algorithm": algorithm,
            "keyId": key_id,
            "signerIdentity": signer_identity,
            "value": sig_value,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

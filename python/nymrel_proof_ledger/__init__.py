"""
nymrel_proof_ledger
~~~~~~~~~~~~~~~~~~~

Dual-runtime cryptographic attestation and proof-of-execution protocol library.
Parent Organization: Nymrel
"""

__version__ = "2.0.0"
__author__ = "Nymrel <contact@nymrel.com>"

from .badge import generate_html_certificate, generate_shield_svg, generate_svg_badge
from .canonical import canonical_hash, canonicalize, canonicalize_legacy
from .envelope import (
    RECEIPT_PROTOCOL,
    SUPPORTED_RECEIPT_VERSION,
    SUPPORTED_RECEIPT_VERSIONS,
    EnvelopeErrorCode,
    validate_receipt_envelope,
)
from .merkle import MerkleProofStep, MerkleTree, hash_leaf, hash_nodes
from .qr import generate_qr_matrix, generate_qr_svg_path
from .receipt import create_receipt, get_git_context, hash_artifact, verify_receipt
from .signer import ProofSigner

attest_execution = create_receipt
verify_proof = verify_receipt
generate_badge = generate_svg_badge

__all__ = [
    "RECEIPT_PROTOCOL",
    "SUPPORTED_RECEIPT_VERSION",
    "SUPPORTED_RECEIPT_VERSIONS",
    "EnvelopeErrorCode",
    "MerkleProofStep",
    "MerkleTree",
    "ProofSigner",
    "attest_execution",
    "canonical_hash",
    "canonicalize",
    "canonicalize_legacy",
    "create_receipt",
    "generate_badge",
    "generate_html_certificate",
    "generate_qr_matrix",
    "generate_qr_svg_path",
    "generate_shield_svg",
    "generate_svg_badge",
    "get_git_context",
    "hash_artifact",
    "hash_leaf",
    "hash_nodes",
    "validate_receipt_envelope",
    "verify_proof",
    "verify_receipt",
]

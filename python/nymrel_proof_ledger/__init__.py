"""
nymrel_proof_ledger
~~~~~~~~~~~~~~~~~~~

Zero-dependency cryptographic attestation and proof-of-execution protocol library and CLI.
Parent Organization: Nymrel -> JalenBuilds LLC
"""

__version__ = "1.0.0"
__author__ = "Nymrel <contact@nymrel.com>"

from .canonical import canonicalize, canonical_hash
from .merkle import MerkleTree, hash_leaf, hash_nodes, MerkleProofStep
from .signer import ProofSigner
from .receipt import create_receipt, verify_receipt, hash_artifact, get_git_context
from .signal import (
    SIGNAL_PROOF_PROFILE,
    SIGNAL_PROOF_PROFILE_VERSION,
    SIGNAL_PROOF_BUNDLE_PROFILE,
    SIGNAL_PROOF_BUNDLE_VERSION,
    SIGNAL_PROOF_ENVELOPE_PATH,
    SIGNAL_ATTESTED_SCOPES,
    validate_signal_proof_envelope,
    canonicalize_signal_proof_envelope,
    digest_signal_proof_envelope,
    create_signal_proof_bundle,
    verify_signal_proof_bundle,
)
from .qr import generate_qr_matrix, generate_qr_svg_path
from .badge import generate_svg_badge, generate_shield_svg, generate_html_certificate

attest_execution = create_receipt
verify_proof = verify_receipt
generate_badge = generate_svg_badge

__all__ = [
    "canonicalize",
    "canonical_hash",
    "MerkleTree",
    "hash_leaf",
    "hash_nodes",
    "MerkleProofStep",
    "ProofSigner",
    "create_receipt",
    "verify_receipt",
    "attest_execution",
    "verify_proof",
    "generate_badge",
    "generate_svg_badge",
    "generate_shield_svg",
    "generate_html_certificate",
    "generate_qr_matrix",
    "generate_qr_svg_path",
    "hash_artifact",
    "get_git_context",
    "SIGNAL_PROOF_PROFILE",
    "SIGNAL_PROOF_PROFILE_VERSION",
    "SIGNAL_PROOF_BUNDLE_PROFILE",
    "SIGNAL_PROOF_BUNDLE_VERSION",
    "SIGNAL_PROOF_ENVELOPE_PATH",
    "SIGNAL_ATTESTED_SCOPES",
    "validate_signal_proof_envelope",
    "canonicalize_signal_proof_envelope",
    "digest_signal_proof_envelope",
    "create_signal_proof_bundle",
    "verify_signal_proof_bundle",
]

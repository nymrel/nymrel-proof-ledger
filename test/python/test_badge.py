import unittest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python")))

from nymrel_proof_ledger.receipt import create_receipt
from nymrel_proof_ledger.badge import generate_svg_badge, generate_shield_svg, generate_html_certificate
from nymrel_proof_ledger.signer import ProofSigner


class TestBadge(unittest.TestCase):
    def test_svg_badge_generation(self):
        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "Release Gate"},
            signing_key=secret,
            signer_identity="bot",
        )

        svg = generate_svg_badge(receipt)
        self.assertTrue(svg.startswith('<?xml version="1.0"'))
        self.assertIn("NYMREL PROOF LEDGER", svg)
        self.assertIn("#FAF8F2", svg)
        self.assertIn("#2A332E", svg)
        self.assertIn("PARENT: JALENBUILDS LLC", svg)

    def test_shield_generation(self):
        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "Fast Gate"},
            signing_key=secret,
            signer_identity="bot",
        )

        shield = generate_shield_svg(receipt)
        self.assertIn("nymrel proof", shield)
        self.assertIn("verified ✓", shield)

    def test_html_certificate_generation(self):
        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "Web Cert"},
            signing_key=secret,
            signer_identity="bot",
        )

        html_doc = generate_html_certificate(receipt)
        self.assertIn("<!DOCTYPE html>", html_doc)
        self.assertIn("Nymrel Proof Ledger", html_doc)


if __name__ == "__main__":
    unittest.main()

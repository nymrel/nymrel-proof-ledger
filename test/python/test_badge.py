import json
import os
import sys
import unittest

sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python"))
)

from nymrel_proof_ledger.badge import (
    generate_html_certificate,
    generate_shield_svg,
    generate_svg_badge,
)
from nymrel_proof_ledger.receipt import create_receipt, verify_receipt
from nymrel_proof_ledger.signer import ProofSigner


class TestBadge(unittest.TestCase):
    def test_svg_badge_defaults_to_unverified_offline_presentation(self):
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
        self.assertIn("PUBLISHER: NYMREL", svg)
        self.assertIn("UNVERIFIED RECEIPT", svg)
        self.assertIn("RECEIPT ID", svg)
        self.assertIn("urn:nymrel:proof:", svg)
        self.assertNotIn("proofs.nymrel.com", svg)
        self.assertNotIn("JalenBuilds", svg)

    def test_trusted_and_integrity_only_presentations_require_verification_results(
        self,
    ):
        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "Fast Gate"},
            signing_key=secret,
            signer_identity="bot",
        )
        trusted = verify_receipt(receipt, expected_algorithm='HMAC-SHA256', public_key_or_secret=secret)
        integrity_only = verify_receipt(receipt)

        shield = generate_shield_svg(receipt, trusted)
        self.assertIn("nymrel proof", shield)
        self.assertIn("trusted", shield)
        self.assertIn("integrity-only", generate_shield_svg(receipt, integrity_only))

        svg = generate_svg_badge(
            receipt,
            verification_base_url="https://verifier.example/v",
            verification_result=trusted,
        )
        self.assertIn("TRUSTED RECEIPT", svg)
        self.assertIn("OPEN VERIFIER", svg)
        self.assertIn(f"https://verifier.example/v/{receipt['proofId']}", svg)

    def test_task_outcome_is_not_used_as_receipt_trust(self):
        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "Expected Failure", "status": "FAILURE", "exitCode": 1},
            signing_key=secret,
            signer_identity="bot",
        )
        trusted = verify_receipt(receipt, expected_algorithm='HMAC-SHA256', public_key_or_secret=secret)

        svg = generate_svg_badge(receipt, verification_result=trusted)
        self.assertIn("TRUSTED RECEIPT", svg)
        self.assertIn("TASK: FAILURE", svg)
        self.assertNotIn("TAMPERED", svg)
        inconsistent = {
            "valid": True,
            "trusted": True,
            "signatureChecked": False,
            "signatureValid": None,
        }
        self.assertIn(
            "INVALID VERIFY RESULT",
            generate_svg_badge(receipt, verification_result=inconsistent),
        )

    def test_rejects_invalid_receipts_and_unsafe_verifier_urls(self):
        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "Render Guard"},
            signing_key=secret,
            signer_identity="bot",
        )

        with self.assertRaisesRegex(ValueError, "invalid proof receipt"):
            generate_svg_badge({**receipt, "proofId": ""})
        with self.assertRaisesRegex(ValueError, "absolute HTTPS URL"):
            generate_svg_badge(
                receipt,
                verification_base_url="http://user:pass@example.test/v",
            )

    def test_html_certificate_has_safe_honest_structured_metadata(self):
        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "</script><img src=x onerror=alert(1)>"},
            signing_key=secret,
            signer_identity="bot",
        )

        html_doc = generate_html_certificate(receipt)
        self.assertIn("<!DOCTYPE html>", html_doc)
        self.assertIn("Nymrel Proof Ledger", html_doc)
        self.assertIn("application/ld+json", html_doc)
        self.assertIn("Publisher: Nymrel", html_doc)
        self.assertIn("UNVERIFIED RECEIPT", html_doc)
        self.assertEqual(html_doc.count("</script>"), 1)
        self.assertNotIn("</script><img", html_doc)
        self.assertNotIn("JalenBuilds", html_doc)
        self.assertNotIn("proofs.nymrel.com", html_doc)

        json_ld_text = html_doc.split('<script type="application/ld+json">\n', 1)[
            1
        ].split("\n  </script>", 1)[0]
        json_ld = json.loads(json_ld_text)
        self.assertEqual(json_ld["identifier"], receipt["proofId"])
        self.assertEqual(
            json_ld["publisher"],
            {
                "@type": "Organization",
                "name": "Nymrel",
                "url": "https://nymrel.com",
            },
        )


if __name__ == "__main__":
    unittest.main()

import html
import json
import os
import re
import sys
import unittest
from html.parser import HTMLParser

sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python"))
)

from nymrel_proof_ledger.badge import generate_html_certificate
from nymrel_proof_ledger.receipt import create_receipt, verify_receipt
from nymrel_proof_ledger.signer import ProofSigner


class CertificateParser(HTMLParser):
    """Read certificate semantics without introducing a browser dependency."""

    def __init__(self, document):
        super().__init__(convert_charrefs=True)
        self.elements = []
        self.stack = []
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        element = {"tag": tag, "attrs": dict(attrs), "text": "", "children": []}
        self.elements.append(element)
        if self.stack:
            self.stack[-1]["children"].append(element)
        if tag not in {"meta", "link", "img", "input", "br", "hr", "source"}:
            self.stack.append(element)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        for element in self.stack:
            element["text"] += data

    def matching(self, tag=None, element_id=None):
        return [
            element
            for element in self.elements
            if (tag is None or element["tag"] == tag)
            and (element_id is None or element["attrs"].get("id") == element_id)
        ]


class TestCertificateExperience(unittest.TestCase):
    def make_receipt(self, artifacts=None):
        return create_receipt(
            task={"name": "Certificate release", "status": "FAILURE", "exitCode": 1},
            artifacts=artifacts,
            signing_key=ProofSigner.generate_secret_key(),
            signer_identity="release-gate",
        )

    def test_certificate_has_landmarks_selectable_root_and_accessible_artifact_table(self):
        receipt = self.make_receipt(
            [{"path": "release/bundle.tar.gz", "data": "release artifact"}]
        )
        document = generate_html_certificate(receipt)
        parsed = CertificateParser(document)
        self.assertEqual(len(parsed.matching("main")), 1)
        headings = parsed.matching("h1")
        self.assertEqual(len(headings), 1)
        self.assertEqual(headings[0]["text"], "NYMREL PROOF LEDGER")
        self.assertEqual(len(parsed.matching("h2")), 4)

        root = parsed.matching("textarea", "merkle-root")
        self.assertEqual(len(root), 1)
        self.assertIn("readonly", root[0]["attrs"])
        self.assertEqual(root[0]["text"], receipt["merkle"]["root"])
        labels = [
            label for label in parsed.matching("label")
            if label["attrs"].get("for") == "merkle-root"
        ]
        self.assertEqual(len(labels), 1)
        self.assertTrue(labels[0]["text"].strip())

        regions = [
            element for element in parsed.elements
            if "table-scroll" in element["attrs"].get("class", "").split()
        ]
        self.assertEqual(len(regions), 1)
        region = regions[0]
        self.assertEqual(region["attrs"].get("tabindex"), "0")
        labelled_by = region["attrs"].get("aria-labelledby", "")
        self.assertTrue(region["attrs"].get("aria-label") or labelled_by)
        for element_id in labelled_by.split():
            self.assertTrue(parsed.matching(element_id=element_id))
        self.assertIn("release/bundle.tar.gz", region["text"])
        self.assertTrue(any(child["tag"] == "table" for child in region["children"]))
        captions = parsed.matching("caption")
        self.assertEqual(len(captions), 1)
        self.assertTrue(captions[0]["text"].strip())
        columns = parsed.matching("th")
        self.assertEqual(len(columns), 3)
        self.assertTrue(all(column["attrs"].get("scope") == "col" for column in columns))

    def test_actions_are_progressively_enabled_and_copy_status_is_announced(self):
        parsed = CertificateParser(generate_html_certificate(self.make_receipt()))
        actions = parsed.matching(element_id="certificate-actions")
        self.assertEqual(len(actions), 1)
        self.assertIn("hidden", actions[0]["attrs"])
        for element_id in ("copy-root-button", "print-certificate-button"):
            buttons = parsed.matching("button", element_id)
            self.assertEqual(len(buttons), 1)
            self.assertEqual(buttons[0]["attrs"].get("type"), "button")
        status = parsed.matching(element_id="copy-status")
        self.assertEqual(len(status), 1)
        self.assertEqual(status[0]["attrs"].get("role"), "status")
        self.assertTrue(all("onclick" not in element["attrs"] for element in parsed.elements))

    def test_artifact_free_receipt_explains_empty_table_and_retains_root(self):
        receipt = self.make_receipt()
        parsed = CertificateParser(generate_html_certificate(receipt))
        cells = parsed.matching("td")
        self.assertEqual(len(cells), 1)
        self.assertEqual(cells[0]["attrs"].get("colspan"), "3")
        self.assertIn("no artifacts", cells[0]["text"].lower())
        self.assertEqual(
            parsed.matching("textarea", "merkle-root")[0]["text"],
            receipt["merkle"]["root"],
        )

    def test_optional_null_git_context_displays_standalone_lineage(self):
        receipt = self.make_receipt()
        receipt["environment"]["git"] = None
        document = generate_html_certificate(receipt)
        self.assertIn("Git Lineage", document)
        self.assertIn("standalone @ n/a", document)
        self.assertIn("release-gate (HMAC-SHA256)", document)

    def test_unsafe_receipt_strings_cannot_modify_scripts_or_create_executable_markup(self):
        attack = '</script><img src=x onerror="alert(1)">&\u2028\u2029'
        receipt = create_receipt(
            task={"name": attack},
            artifacts=[{"path": attack, "data": "release artifact"}],
            signing_key=ProofSigner.generate_secret_key(),
            signer_identity=attack,
        )
        document = generate_html_certificate(receipt)
        parsed = CertificateParser(document)
        self.assertEqual(document.count("</script>"), 2)
        self.assertFalse(parsed.matching("img"))
        self.assertTrue(all("onerror" not in element["attrs"] for element in parsed.elements))
        self.assertIn(html.escape(attack), document)
        scripts = [script for script in parsed.matching("script") if not script["attrs"]]
        self.assertEqual(len(scripts), 1)
        ordinary_document = generate_html_certificate(self.make_receipt())
        ordinary_scripts = re.findall(r"<script>\s*([\s\S]*?)\s*</script>", ordinary_document)
        self.assertEqual(len(ordinary_scripts), 1)
        self.assertEqual(scripts[0]["text"].strip(), ordinary_scripts[0].strip())
        self.assertNotIn(attack, scripts[0]["text"])
        self.assertNotIn(receipt["merkle"]["root"], scripts[0]["text"])
        metadata_scripts = [
            script for script in parsed.matching("script")
            if script["attrs"].get("type") == "application/ld+json"
        ]
        self.assertEqual(len(metadata_scripts), 1)
        metadata = json.loads(metadata_scripts[0]["text"])
        self.assertEqual(metadata["name"], f"{attack} Attestation")
        self.assertEqual(metadata["identifier"], receipt["proofId"])

    def test_trust_presentation_remains_independent_of_task_failure(self):
        secret = ProofSigner.generate_secret_key()
        receipt = create_receipt(
            task={"name": "Expected failure", "status": "FAILURE", "exitCode": 1},
            signing_key=secret,
            signer_identity="release-gate",
        )
        trusted = verify_receipt(
            receipt, expected_algorithm="HMAC-SHA256", public_key_or_secret=secret
        )
        integrity_only = verify_receipt(receipt)
        for verification, label in (
            (None, "UNVERIFIED RECEIPT"),
            (integrity_only, "INTEGRITY ONLY"),
            (trusted, "TRUSTED RECEIPT"),
        ):
            with self.subTest(label=label):
                document = generate_html_certificate(receipt, verification_result=verification)
                parsed = CertificateParser(document)
                state_heading = parsed.matching("h2", "receipt-state-title")
                self.assertEqual(len(state_heading), 1)
                self.assertEqual(state_heading[0]["text"], label)
                self.assertIn("FAILURE (Exit Code: 1)", document)
                self.assertIn(
                    "use the original JSON and a key from a trusted source "
                    "with an independently configured algorithm",
                    document,
                )
                self.assertIn(
                    "Task status is a reported outcome; copying or printing "
                    "does not verify it.",
                    document,
                )


if __name__ == "__main__":
    unittest.main()

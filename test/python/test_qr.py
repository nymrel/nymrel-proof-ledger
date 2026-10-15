import json
import os
import sys
import unittest

sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python"))
)

from nymrel_proof_ledger.qr import generate_qr_matrix, generate_qr_svg_path

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "..", "fixtures", "qr-vectors.json")
with open(FIXTURE_PATH, encoding="utf-8") as fixture_file:
    VECTORS = json.load(fixture_file)["vectors"]


class TestQR(unittest.TestCase):
    def test_matches_independent_qr_matrices(self):
        for vector in VECTORS:
            with self.subTest(vector=vector["name"]):
                matrix = generate_qr_matrix(vector["text"])
                self.assertEqual(len(vector["text"].encode("utf-8")), vector["utf8Bytes"])
                self.assertEqual(len(matrix), 17 + 4 * vector["version"])
                self.assertEqual(
                    ["".join("1" if cell else "0" for cell in row) for row in matrix],
                    vector["rows"],
                )

    def test_rejects_oversize_byte_payloads_without_truncating(self):
        for text in ["A" * 135, "A" * 500, "é" * 68]:
            with self.subTest(bytes=len(text.encode("utf-8"))):
                with self.assertRaisesRegex(ValueError, "134 UTF-8 bytes"):
                    generate_qr_matrix(text)

    def test_rejects_lone_surrogates(self):
        for text in ["\ud800", "\udfff", "x\ud800x"]:
            with self.subTest(text=repr(text)):
                with self.assertRaises(UnicodeEncodeError):
                    generate_qr_matrix(text)

    def test_svg_path_coordinates(self):
        self.assertEqual(
            generate_qr_svg_path([[True, False], [False, True]], 2, 5, 7),
            "M5,7h2v2h-2z M7,9h2v2h-2z",
        )


if __name__ == "__main__":
    unittest.main()

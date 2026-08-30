import json
import os
import sys
import tempfile
import unittest

sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python"))
)

from nymrel_proof_ledger.cli import _load_key_material
from nymrel_proof_ledger.signer import ProofSigner


class TestKeyFileMaterial(unittest.TestCase):
    """Regression guard: `--key-file` must unwrap the JSON envelopes written by keygen."""

    def _write(self, payload):
        fd, path = tempfile.mkstemp(suffix=".key")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(payload, indent=2))
        self.addCleanup(os.remove, path)
        return path

    def test_hmac_secret_envelope_is_unwrapped(self):
        secret = ProofSigner.generate_secret_key()
        path = self._write({"algorithm": "HMAC-SHA256", "secretKey": secret})
        self.assertEqual(_load_key_material(path, "sign"), secret)
        self.assertEqual(_load_key_material(path, "verify"), secret)

    def test_ed25519_envelope_role_aware_fields(self):
        kp = ProofSigner.generate_key_pair()
        path = self._write(kp)
        self.assertEqual(_load_key_material(path, "sign"), kp["privateKey"])
        self.assertEqual(_load_key_material(path, "verify"), kp["publicKey"])

    def test_plain_text_key_file_is_used_verbatim(self):
        fd, path = tempfile.mkstemp(suffix=".key")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("my-plain-text-secret\n")
        self.addCleanup(os.remove, path)
        self.assertEqual(_load_key_material(path, "sign"), "my-plain-text-secret")


if __name__ == "__main__":
    unittest.main()

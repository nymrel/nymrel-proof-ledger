import contextlib
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))

from nymrel_proof_ledger.cli import _load_key_material, main
from nymrel_proof_ledger.signer import ProofSigner

ROOT = Path(__file__).resolve().parents[2]


class TestKeygen(unittest.TestCase):
    def run_cli(self, arguments):
        output, errors = io.StringIO(), io.StringIO()
        with (
            contextlib.redirect_stdout(output),
            contextlib.redirect_stderr(errors),
            self.assertRaises(SystemExit) as exited,
        ):
            main(arguments)
        return exited.exception.code, output.getvalue(), errors.getvalue()

    def test_stdout_key_envelopes_and_default_algorithm(self):
        for arguments, algorithm in (
            ([], "HMAC-SHA256"),
            (["--algo", "HMAC-SHA256"], "HMAC-SHA256"),
            (["--algo", "Ed25519"], "Ed25519"),
        ):
            with self.subTest(algorithm=algorithm, arguments=arguments):
                code, output, errors = self.run_cli(["keygen", *arguments])
                self.assertEqual(code, 0)
                self.assertEqual(errors, "")
                envelope = json.loads(output)
                self.assertEqual(envelope["algorithm"], algorithm)
                expected_fields = (
                    {"algorithm", "secretKey"}
                    if algorithm == "HMAC-SHA256"
                    else {"algorithm", "encoding", "privateKey", "publicKey"}
                )
                self.assertEqual(set(envelope), expected_fields)

    def test_generated_files_work_with_key_loader_and_signer(self):
        with tempfile.TemporaryDirectory() as directory:
            for algorithm in ("HMAC-SHA256", "Ed25519"):
                with self.subTest(algorithm=algorithm):
                    path = Path(directory) / f"{algorithm}.key"
                    code, output, errors = self.run_cli(
                        ["keygen", "--algo", algorithm, "--out", str(path)]
                    )
                    self.assertEqual(code, 0)
                    self.assertEqual(errors, "")
                    signing_key = _load_key_material(path, "sign", algorithm)
                    verification_key = _load_key_material(path, "verify", algorithm)
                    signature = ProofSigner.sign_payload({"task": "keygen"}, signing_key, algorithm)
                    self.assertTrue(ProofSigner.verify_signature(
                        {"task": "keygen"}, signature, verification_key, algorithm
                    ))
                    self.assertNotIn(signing_key, output)
                    self.assertIn("Key saved to", output)

    @unittest.skipUnless(os.name == "posix", "POSIX file permissions required")
    def test_new_keys_are_private_under_permissive_umask(self):
        with tempfile.TemporaryDirectory() as directory:
            for algorithm in ("HMAC-SHA256", "Ed25519"):
                with self.subTest(algorithm=algorithm):
                    path = Path(directory) / f"{algorithm}.key"
                    result = subprocess.run(
                        [
                            sys.executable, "-c",
                            "import os; from nymrel_proof_ledger.cli import main; os.umask(0); main()",
                            "keygen", "--algo", algorithm, "--out", str(path),
                        ],
                        env={**os.environ, "PYTHONPATH": str(ROOT / "python")},
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_existing_keys_are_not_overwritten_or_disclosed(self):
        with tempfile.TemporaryDirectory() as directory:
            for algorithm in ("HMAC-SHA256", "Ed25519"):
                with self.subTest(algorithm=algorithm):
                    path = Path(directory) / f"{algorithm}.key"
                    args = ["keygen", "--algo", algorithm, "--out", str(path)]
                    self.assertEqual(self.run_cli(args)[0], 0)
                    original = path.read_bytes()
                    mode = stat.S_IMODE(path.stat().st_mode)
                    code, output, errors = self.run_cli(args)
                    self.assertEqual(code, 1)
                    self.assertEqual(output, "")
                    self.assertIn("Cannot create key file", errors)
                    self.assertNotIn("Traceback", errors)
                    self.assertEqual(path.read_bytes(), original)
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode), mode)
                    field = "secretKey" if algorithm == "HMAC-SHA256" else "privateKey"
                    self.assertNotIn(json.loads(original)[field], output + errors)

    def test_existing_and_dangling_symlinks_are_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            for algorithm in ("HMAC-SHA256", "Ed25519"):
                for target_exists in (True, False):
                    with self.subTest(algorithm=algorithm, target_exists=target_exists):
                        target = Path(directory) / f"{algorithm}-{target_exists}.target"
                        link = Path(directory) / f"{algorithm}-{target_exists}.key"
                        if target_exists:
                            target.write_bytes(b"existing target contents")
                        try:
                            link.symlink_to(target)
                        except (OSError, NotImplementedError) as error:
                            self.skipTest(f"Symlink creation unavailable: {error}")
                        code, output, errors = self.run_cli(
                            ["keygen", "--algo", algorithm, "--out", str(link)]
                        )
                        self.assertEqual(code, 1)
                        self.assertEqual(output, "")
                        self.assertIn("Cannot create key file", errors)
                        self.assertTrue(link.is_symlink())
                        self.assertEqual(os.readlink(link), str(target))
                        if target_exists:
                            self.assertEqual(target.read_bytes(), b"existing target contents")
                        else:
                            self.assertFalse(target.exists())

    def test_invalid_arguments_fail_before_generating_keys(self):
        cases = (
            ["--out", ""],
            ["--out"],
            ["--algo"],
            ["--algo", ""],
            ["--algo", "unknown"],
        )
        for arguments in cases:
            with self.subTest(arguments=arguments):
                with (
                    patch.object(ProofSigner, "generate_secret_key") as secret,
                    patch.object(ProofSigner, "generate_key_pair") as pair,
                ):
                    code, output, errors = self.run_cli(["keygen", *arguments])
                self.assertEqual(code, 2)
                self.assertEqual(output, "")
                self.assertIn("error:", errors)
                secret.assert_not_called()
                pair.assert_not_called()

    def test_output_errors_are_sanitized_and_do_not_print_new_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing" / "key\x1b[2J\nspoof.key"
            with patch.object(ProofSigner, "generate_secret_key", return_value="new-secret-sentinel"):
                code, output, errors = self.run_cli(["keygen", "--out", str(path)])
            self.assertEqual(code, 1)
            self.assertEqual(output, "")
            self.assertIn("Cannot create key file", errors)
            self.assertNotIn("Traceback", errors)
            self.assertNotIn("new-secret-sentinel", output + errors)
            self.assertNotIn("\x1b", output + errors)
            self.assertNotIn("\nspoof.key", output + errors)
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()

"""Exercise actual release preflight commands, including rejected sources."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "check_release.py"


class ReleasePreflightTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="proof-release-preflight-")
        self.addCleanup(self.directory.cleanup)
        self.repository = Path(self.directory.name)
        self.write_versions("2.0.0", "2.0.0")

    def write_versions(self, node_version, python_version):
        (self.repository / "package.json").write_text(
            json.dumps({"version": node_version}), encoding="utf-8",
        )
        (self.repository / "pyproject.toml").write_text(
            f"[project]\nversion = {json.dumps(python_version)}\n", encoding="utf-8",
        )

    def git(self, *arguments):
        return subprocess.run(
            ["git", *arguments], cwd=self.repository, capture_output=True,
            text=True, check=True, timeout=30,
        )

    def commit(self):
        self.git("add", ".")
        self.git(
            "-c", "user.name=Workflow Test", "-c", "user.email=workflow@example.invalid",
            "-c", "commit.gpgsign=false", "commit", "-m", "Release fixture",
        )

    def main_history(self):
        self.git("init", "--initial-branch=main")
        self.commit()
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")

    def run_preflight(self, ref_type="branch", ref_name="candidate", **environment):
        env = {
            **os.environ, "RELEASE_REF_TYPE": ref_type, "RELEASE_REF_NAME": ref_name,
            **environment,
        }
        return subprocess.run(
            [sys.executable, str(SCRIPT)], cwd=self.repository, env=env,
            capture_output=True, text=True, check=False, timeout=35,
        )

    def assert_rejected(self, result, diagnostic):
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn(diagnostic, result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_manual_branch_verification_needs_no_git_history(self):
        result = self.run_preflight()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("npm/Python 2.0.0", result.stdout)

    def test_mismatched_versions_are_actionable(self):
        self.write_versions("2.0.0", "2.0.1")
        self.assert_rejected(self.run_preflight(), "Align both versions")

    def test_invalid_metadata_has_no_traceback(self):
        (self.repository / "package.json").write_text("{", encoding="utf-8")
        self.assert_rejected(self.run_preflight(), "Fix package.json and pyproject.toml")

    def test_non_string_and_blank_versions_are_rejected(self):
        for version in (2, "", " ", " 2.0.0"):
            with self.subTest(version=version):
                self.write_versions(version, "2.0.0")
                self.assert_rejected(self.run_preflight(), "Both package versions")

    def test_missing_ref_context_is_rejected(self):
        for ref_type, ref_name in (("", ""), ("commit", "abc"), ("tag", "")):
            with self.subTest(ref_type=ref_type, ref_name=ref_name):
                self.assert_rejected(
                    self.run_preflight(ref_type, ref_name), "Set RELEASE_REF_TYPE",
                )

    def test_wrong_tag_fails_before_attempting_git(self):
        self.assert_rejected(
            self.run_preflight("tag", "v9.0.0", PATH=""), "Select the matching tag",
        )

    def test_matching_tag_in_main_history_passes(self):
        self.main_history()
        result = self.run_preflight("tag", "v2.0.0")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_source_outside_main_history_is_rejected(self):
        self.main_history()
        (self.repository / "unreviewed.txt").write_text("unreviewed", encoding="utf-8")
        self.commit()
        self.assert_rejected(
            self.run_preflight("tag", "v2.0.0"), "outside origin/main history",
        )

    def test_missing_main_ref_is_distinct_from_unmerged_source(self):
        self.git("init", "--initial-branch=main")
        self.commit()
        self.assert_rejected(
            self.run_preflight("tag", "v2.0.0"), "Fetch origin/main",
        )

    def test_unavailable_git_has_a_recovery_action(self):
        self.assert_rejected(
            self.run_preflight("tag", "v2.0.0", PATH=""), "Restore Git access",
        )


if __name__ == "__main__":
    unittest.main()

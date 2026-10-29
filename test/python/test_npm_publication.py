"""Exercise exact-byte npm recovery with mocked public registry responses."""

import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request


SCRIPT = Path(__file__).resolve().parents[2] / "tools/check_npm_publication.py"
SPEC = importlib.util.spec_from_file_location("npm_publication", SCRIPT)
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)
VERSION = "2.0.1"
METADATA_URL = f"{CHECK.REGISTRY}/@nymrel%2fproof-ledger/{VERSION}"
TARBALL_URL = f"{CHECK.REGISTRY}/{CHECK.PACKAGE}/-/proof-ledger-{VERSION}.tgz"


class Response(io.BytesIO):
    status = 200

    def __init__(self, value, url):
        super().__init__(value)
        self.url = url

    def geturl(self):
        return self.url


class NpmPublicationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="proof-npm-recovery-")
        self.addCleanup(self.directory.cleanup)
        self.archive = Path(self.directory.name) / "accepted.tgz"
        self.accepted = b"synthetic accepted archive bytes\n"
        self.archive.write_bytes(self.accepted)
        self.metadata = {
            "name": CHECK.PACKAGE, "version": VERSION,
            "dist": {
                "tarball": TARBALL_URL,
                "integrity": "sha512-" + base64.b64encode(hashlib.sha512(self.accepted).digest()).decode(),
            },
        }

    def responses(self, metadata=None, tarball=None):
        replies = {
            METADATA_URL: json.dumps(self.metadata).encode() if metadata is None else metadata,
            TARBALL_URL: self.accepted if tarball is None else tarball,
        }

        def opened(request, timeout):
            self.assertEqual(timeout, 30)
            value = replies[request.full_url]
            if isinstance(value, Exception):
                raise value
            return Response(value, request.full_url)

        opener = patch.object(CHECK.urllib.request, "build_opener")
        mock = opener.start()
        self.addCleanup(opener.stop)
        mock.return_value.open.side_effect = opened
        return mock.return_value.open

    def test_exact_version_404_allows_existing_publisher(self):
        opened = self.responses(metadata=urllib.error.HTTPError(METADATA_URL, 404, "Not found", None, None))
        self.assertFalse(CHECK.already_published(self.archive, VERSION))
        self.assertEqual(opened.call_count, 1)

    def test_identical_public_archive_satisfies_delivery(self):
        opened = self.responses()
        self.assertTrue(CHECK.already_published(self.archive, VERSION))
        self.assertEqual(opened.call_count, 2)

    def test_metadata_access_errors_do_not_permit_upload(self):
        for status in (401, 403, 429, 500):
            with self.subTest(status=status), patch.object(CHECK, "fetch", side_effect=urllib.error.HTTPError(
                METADATA_URL, status, "Unavailable", None, None,
            )), self.assertRaisesRegex(ValueError, "Cannot establish"):
                CHECK.already_published(self.archive, VERSION)

    def test_other_destination_404_does_not_mean_version_absent(self):
        self.responses(metadata=urllib.error.HTTPError("https://other.example/", 404, "Not found", None, None))
        with self.assertRaisesRegex(ValueError, "Cannot establish"):
            CHECK.already_published(self.archive, VERSION)

    def test_network_failure_does_not_permit_upload(self):
        with patch.object(CHECK, "fetch", side_effect=urllib.error.URLError("unavailable")):
            with self.assertRaises(urllib.error.URLError):
                CHECK.already_published(self.archive, VERSION)

    def test_wrong_identity_is_rejected_before_tarball_download(self):
        for field, value in (("name", "@other/proof-ledger"), ("version", "2.0.0")):
            with self.subTest(field=field):
                metadata = {**self.metadata, field: value}
                with patch.object(CHECK, "fetch", return_value=json.dumps(metadata).encode()) as fetched:
                    with self.assertRaisesRegex(ValueError, "identity"):
                        CHECK.already_published(self.archive, VERSION)
                    self.assertEqual(fetched.call_count, 1)

    def test_untrusted_and_wrong_version_tarball_urls_are_rejected(self):
        for url in (
            "http://registry.npmjs.org/@nymrel/proof-ledger/-/proof-ledger-2.0.1.tgz",
            "https://registry.npmjs.org.attacker.example/archive.tgz",
            "https://registry.npmjs.org/@other/proof-ledger/-/proof-ledger-2.0.1.tgz",
            TARBALL_URL + "?token=value", TARBALL_URL.replace("2.0.1", "2.0.0"),
        ):
            with self.subTest(url=url):
                metadata = {**self.metadata, "dist": {**self.metadata["dist"], "tarball": url}}
                with patch.object(CHECK, "fetch", return_value=json.dumps(metadata).encode()):
                    with self.assertRaisesRegex(ValueError, "exact official"):
                        CHECK.already_published(self.archive, VERSION)

    def test_malformed_and_duplicate_metadata_fail_closed(self):
        for encoded in (b"{", b"null", b"[]", b'{"name":"first","name":"second"}', b"\xff"):
            with self.subTest(encoded=encoded), patch.object(CHECK, "fetch", return_value=encoded):
                with self.assertRaises((ValueError, UnicodeError)):
                    CHECK.already_published(self.archive, VERSION)

    def test_different_recorded_integrity_stops_before_download(self):
        self.metadata["dist"]["integrity"] = "sha512-wrong"
        opened = self.responses()
        with self.assertRaisesRegex(ValueError, "different archive integrity"):
            CHECK.already_published(self.archive, VERSION)
        self.assertEqual(opened.call_count, 1)

    def test_matching_integrity_does_not_excuse_wrong_tarball_bytes(self):
        self.responses(tarball=b"different bytes")
        with self.assertRaisesRegex(ValueError, "tarball differs"):
            CHECK.already_published(self.archive, VERSION)

    def test_missing_tarball_is_a_failure(self):
        self.responses(tarball=urllib.error.HTTPError(TARBALL_URL, 404, "Not found", None, None))
        with self.assertRaises(urllib.error.HTTPError):
            CHECK.already_published(self.archive, VERSION)

    def test_all_redirects_are_refused_without_following(self):
        for destination in (TARBALL_URL, "http://registry.npmjs.org/file", "https://other.example/file"):
            with self.subTest(destination=destination), self.assertRaisesRegex(ValueError, "redirects"):
                CHECK.NoRedirects().redirect_request(
                    urllib.request.Request(TARBALL_URL), None, 302, "Found", {}, destination,
                )

    def test_download_size_is_bounded(self):
        self.responses(metadata=b"x" * (CHECK.MAX_METADATA + 1))
        with self.assertRaisesRegex(ValueError, "download limit"):
            CHECK.already_published(self.archive, VERSION)

    def test_unexpected_response_destination_and_status_fail(self):
        for destination, status in (("https://other.example/", 200), (METADATA_URL, 206)):
            with self.subTest(destination=destination, status=status):
                response = Response(b"{}", destination)
                response.status = status
                with patch.object(CHECK.urllib.request, "build_opener") as opener:
                    opener.return_value.open.return_value = response
                    with self.assertRaisesRegex(ValueError, "Unexpected"):
                        CHECK.already_published(self.archive, VERSION)

    def test_invalid_version_and_unsafe_local_archive_do_not_access_registry(self):
        with patch.object(CHECK, "fetch") as fetched:
            for version in ("2.0.1/other", "2.0.1\n", "02.0.1", "2.0.1-beta"):
                with self.subTest(version=version), self.assertRaises(ValueError):
                    CHECK.already_published(self.archive, version)
            self.archive.write_bytes(b"")
            with self.assertRaisesRegex(ValueError, "regular file"):
                CHECK.already_published(self.archive, VERSION)
            self.archive.unlink()
            self.archive.symlink_to("missing")
            with self.assertRaisesRegex(ValueError, "regular file"):
                CHECK.already_published(self.archive, VERSION)
            fetched.assert_not_called()

    def test_cli_outputs_only_fixed_state_on_success_and_none_on_failure(self):
        for present in (True, False):
            with self.subTest(present=present):
                stdout, stderr = io.StringIO(), io.StringIO()
                with patch.object(CHECK.sys, "argv", [str(SCRIPT), "--archive", str(self.archive), "--version", VERSION]), \
                        patch.object(CHECK, "already_published", return_value=present), \
                        contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    self.assertEqual(CHECK.main(), 0)
                self.assertEqual(stdout.getvalue(), f"already_published={str(present).lower()}\n")
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(CHECK.sys, "argv", [str(SCRIPT), "--archive", str(self.archive), "--version", VERSION]), \
                patch.object(CHECK, "already_published", side_effect=ValueError("collision")), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            self.assertEqual(CHECK.main(), 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("rejected: collision", stderr.getvalue())

    def test_workflow_preserves_guard_order_and_only_publishes_absent_version(self):
        workflow = (SCRIPT.parents[1] / ".github/workflows/release.yml").read_text()
        npm_job = workflow.split("\n  publish-npm:\n", 1)[1].split("\n  publish-pypi:\n", 1)[0]
        self.assertIn("    needs: [build, attest]\n", npm_job)
        self.assertIn("      name: npm\n", npm_job)
        self.assertIn("      id-token: write\n", npm_job)
        self.assertIn("          ref: ${{ github.sha }}\n", npm_job)
        self.assertIn("          persist-credentials: false\n", npm_job)
        checksum = npm_job.index("sha256sum --check --strict release/SHA256SUMS")
        registry = npm_job.index("python3 tools/check_npm_publication.py")
        publisher = npm_job.index("      - name: Publish the exact npm archive with provenance\n")
        self.assertLess(checksum, registry)
        self.assertLess(registry, publisher)
        self.assertIn("        if: steps.npm-state.outputs.already_published == 'false'\n", npm_job[publisher:])
        self.assertIn('--access public --provenance --ignore-scripts', npm_job[publisher:])


if __name__ == "__main__":
    unittest.main()

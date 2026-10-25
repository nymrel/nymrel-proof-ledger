"""Run the release workflow's actual checksum guards against unsafe downloads."""

import hashlib
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/release.yml"
CONSUMERS = ("attest", "publish-npm", "publish-pypi")
TOOLS = ("bash", "find", "mktemp", "sort", "uniq", "tr", "cmp", "sha256sum")


def workflow_guards():
    """Extract named literal Bash steps; fail if the supported YAML layout changes.

    This intentionally reads the checked-in commands instead of reimplementing
    archive validation in Python. It is not a general-purpose YAML parser.
    """
    source = WORKFLOW.read_text(encoding="utf-8")
    jobs = source.split("\njobs:\n", 1)[1]
    boundaries = list(re.finditer(r"(?m)^  ([a-z][a-z0-9-]*):\n", jobs))
    guards = {}
    for index, match in enumerate(boundaries):
        name = match.group(1)
        if name not in CONSUMERS:
            continue
        end = boundaries[index + 1].start() if index + 1 < len(boundaries) else len(jobs)
        body = jobs[match.end():end]
        marker = "      - name: Verify downloaded release distributions\n"
        if body.count(marker) != 1:
            raise ValueError(f"Expected one downloaded-archive guard in {name}")
        before, step = body.split(marker)
        if "      - name: Download release distributions\n" not in before:
            raise ValueError(f"Archive guard must follow the download in {name}")
        step = step.split("\n      - name:", 1)[0]
        prefix = "        shell: bash\n        run: |\n"
        if not step.startswith(prefix):
            raise ValueError(f"Expected a literal Bash archive guard in {name}")
        lines = step[len(prefix):].splitlines()
        if not lines or any(line and not line.startswith("          ") for line in lines):
            raise ValueError(f"Unsupported archive-guard indentation in {name}")
        guards[name] = "\n".join(line[10:] if line else "" for line in lines) + "\n"
    if set(guards) != set(CONSUMERS):
        raise ValueError("Every attestation/publication consumer must retain its archive guard")
    return guards


@unittest.skipUnless(
    all(shutil.which(tool) for tool in TOOLS),
    "Release archive guards require Bash and the Linux release jobs' checksum tools",
)
class ReleaseArchiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.guards = workflow_guards()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="proof-release-archives-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.archives = (
            "release/npm/nymrel-proof-ledger-2.0.0.tgz",
            "release/python/nymrel_proof_ledger-2.0.0-py3-none-any.whl",
            "release/python/nymrel_proof_ledger-2.0.0.tar.gz",
        )
        self.entries = []
        for index, name in enumerate(self.archives):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            data = f"synthetic immutable distribution {index}\n".encode()
            path.write_bytes(data)
            self.entries.append(f"{hashlib.sha256(data).hexdigest()}  {name}")
        self.manifest = self.root / "release/SHA256SUMS"
        self.write_manifest()

    def write_manifest(self, entries=None):
        self.manifest.write_text(
            "\n".join(self.entries if entries is None else entries) + "\n",
            encoding="utf-8",
        )

    def check_guards(self, diagnostic=None):
        for consumer, command in self.guards.items():
            with self.subTest(consumer=consumer):
                result = subprocess.run(
                    ["bash", "--noprofile", "--norc", "-c", command],
                    cwd=self.root, capture_output=True, text=True,
                    check=False, timeout=10,
                )
                output = result.stdout + result.stderr
                if diagnostic is None:
                    self.assertEqual(result.returncode, 0, output)
                    for archive in self.archives:
                        self.assertIn(f"{archive}: OK", result.stdout)
                else:
                    self.assertNotEqual(result.returncode, 0, output)
                    self.assertIn(diagnostic, output)

    def test_valid_complete_download(self):
        self.check_guards()

    def test_binary_checksum_marker(self):
        self.write_manifest([entry.replace("  release/", " *release/") for entry in self.entries])
        self.check_guards()

    def test_manifest_without_final_newline(self):
        self.manifest.write_text("\n".join(self.entries), encoding="utf-8")
        self.check_guards()

    def test_corrupt_archive(self):
        (self.root / self.archives[0]).write_bytes(b"changed after download")
        self.check_guards("FAILED")

    def test_missing_archive(self):
        (self.root / self.archives[1]).unlink()
        self.check_guards("Distribution files differ from checksum manifest")

    def test_unlisted_archive(self):
        (self.root / "release/npm/unlisted.tgz").write_bytes(b"unlisted")
        self.check_guards("Distribution files differ from checksum manifest")

    def test_duplicate_manifest_entry(self):
        self.write_manifest([*self.entries, self.entries[0]])
        self.check_guards("Duplicate checksum entry")

    def test_parent_traversal(self):
        self.write_manifest([self.entries[0].replace(self.archives[0], "release/npm/../outside")])
        self.check_guards("Invalid checksum entry or distribution path")

    def test_out_of_scope_path(self):
        self.write_manifest([self.entries[0].replace(self.archives[0], "release/evidence/log.json")])
        self.check_guards("Invalid checksum entry or distribution path")

    def test_symlink_archive(self):
        archive = self.root / self.archives[0]
        target = self.root / "original.tgz"
        archive.rename(target)
        archive.symlink_to(target)
        self.check_guards("Nonregular distribution entry")

    def test_symlink_distribution_directory(self):
        directory = self.root / "release/npm"
        target = self.root / "original-npm"
        directory.rename(target)
        directory.symlink_to(target, target_is_directory=True)
        self.check_guards("Missing or unsafe distribution directory")

    def test_symlink_manifest(self):
        target = self.root / "original-SHA256SUMS"
        self.manifest.rename(target)
        self.manifest.symlink_to(target)
        self.check_guards("Missing or unsafe checksum manifest")

    def test_malformed_checksum(self):
        self.write_manifest(["not-a-sha256  " + self.archives[0]])
        self.check_guards("Invalid checksum entry or distribution path")

    def test_empty_manifest(self):
        self.manifest.write_bytes(b"")
        self.check_guards("Empty checksum manifest")

    def test_missing_manifest(self):
        self.manifest.unlink()
        self.check_guards("Missing or unsafe checksum manifest")

    def test_missing_distribution_directory(self):
        shutil.rmtree(self.root / "release/npm")
        self.check_guards("Missing or unsafe distribution directory")


if __name__ == "__main__":
    unittest.main()

"""Validate release metadata before installing dependencies or building packages."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tomllib


def check_release(repository: Path, ref_type: str, ref_name: str) -> str:
    if ref_type not in ("branch", "tag") or not ref_name:
        raise ValueError(
            "Set RELEASE_REF_TYPE to branch or tag and RELEASE_REF_NAME to the "
            "selected ref, then retry release verification."
        )

    try:
        node_version = json.loads(
            (repository / "package.json").read_text(encoding="utf-8")
        )["version"]
        python_version = tomllib.loads(
            (repository / "pyproject.toml").read_text(encoding="utf-8")
        )["project"]["version"]
    except (OSError, UnicodeError, ValueError, KeyError, TypeError) as error:
        raise ValueError(
            "Cannot read package versions. Fix package.json and pyproject.toml "
            "in the selected checkout, then retry."
        ) from error

    for version in (node_version, python_version):
        if not isinstance(version, str) or not version.strip() or version != version.strip():
            raise ValueError("Both package versions must be nonempty strings without surrounding whitespace.")
    if node_version != python_version:
        raise ValueError(
            f"Package versions differ: npm {node_version!r}, Python {python_version!r}. "
            "Align both versions before building a release."
        )

    if ref_type == "tag":
        expected = f"v{node_version}"
        if ref_name != expected:
            raise ValueError(
                f"Tag {ref_name!r} does not match package version {expected!r}. "
                "Select the matching tag; do not move an existing published tag."
            )
        try:
            ancestry = subprocess.run(
                ["git", "merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/main"],
                cwd=repository, capture_output=True, text=True, check=False, timeout=30,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError("Cannot run the Git ancestry check. Restore Git access and retry.") from error
        if ancestry.returncode == 1:
            raise ValueError(
                "The selected source is outside origin/main history. "
                "Complete its normal review and integration before releasing."
            )
        if ancestry.returncode != 0:
            raise ValueError(
                "Cannot verify source ancestry. Fetch origin/main and complete "
                "Git history, then retry."
            )
    return f"Release preflight passed: npm/Python {node_version}; {ref_type} {ref_name!r}."


def main() -> int:
    try:
        message = check_release(
            Path.cwd(), os.environ.get("RELEASE_REF_TYPE", ""),
            os.environ.get("RELEASE_REF_NAME", ""),
        )
    except ValueError as error:
        print(f"Release preflight failed: {error}", file=sys.stderr)
        return 1
    print(message)
    return 0


if __name__ == "__main__":
    sys.exit(main())

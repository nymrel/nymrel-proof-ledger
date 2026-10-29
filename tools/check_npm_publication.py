"""Accept an existing npm version only when its public tarball matches our archive."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import stat
import sys
import urllib.error
import urllib.request


PACKAGE = "@nymrel/proof-ledger"
REGISTRY = "https://registry.npmjs.org"
MAX_METADATA = 1024 * 1024
MAX_ARCHIVE = 64 * 1024 * 1024


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        raise ValueError("Registry redirects are not accepted; inspect the release before retrying.")


def fetch(url: str, limit: int) -> bytes:
    request = urllib.request.Request(url, headers={"Accept": "application/json, application/octet-stream"})
    with urllib.request.build_opener(NoRedirects()).open(request, timeout=30) as response:
        if response.status != 200 or response.geturl() != url:
            raise ValueError("Unexpected registry response or destination.")
        content = response.read(limit + 1)
        if len(content) > limit:
            raise ValueError("Registry response exceeds the release download limit.")
        return content


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Registry metadata contains duplicate fields.")
        result[key] = value
    return result


def already_published(archive: Path, version: str) -> bool:
    if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
        raise ValueError("Expected a stable MAJOR.MINOR.PATCH release version.")
    details = archive.lstat()
    if not stat.S_ISREG(details.st_mode) or not 0 < details.st_size <= MAX_ARCHIVE:
        raise ValueError("The accepted npm archive must be a nonempty bounded regular file.")
    accepted = archive.read_bytes()
    metadata_url = f"{REGISTRY}/@nymrel%2fproof-ledger/{version}"
    try:
        encoded = fetch(metadata_url, MAX_METADATA)
    except urllib.error.HTTPError as error:
        if error.code == 404 and error.geturl() == metadata_url:
            return False
        raise ValueError("Cannot establish npm version state; restore registry access before retrying.") from error
    metadata = json.loads(encoded, object_pairs_hook=unique_object)
    if not isinstance(metadata, dict) or metadata.get("name") != PACKAGE or metadata.get("version") != version:
        raise ValueError("Registry package identity does not match the selected release.")
    distribution = metadata.get("dist")
    tarball_url = f"{REGISTRY}/{PACKAGE}/-/proof-ledger-{version}.tgz"
    if not isinstance(distribution, dict) or distribution.get("tarball") != tarball_url:
        raise ValueError("Registry tarball must use the exact official package/version URL.")
    expected_integrity = "sha512-" + base64.b64encode(hashlib.sha512(accepted).digest()).decode("ascii")
    if distribution.get("integrity") != expected_integrity:
        raise ValueError("The existing npm version has different archive integrity; do not overwrite or retag.")
    published = fetch(tarball_url, MAX_ARCHIVE)
    if published != accepted:
        raise ValueError("The existing npm tarball differs from the accepted archive; do not overwrite or retag.")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    try:
        present = already_published(args.archive, args.version)
    except (OSError, ValueError, urllib.error.URLError) as error:
        print(f"npm publication recovery rejected: {error}", file=sys.stderr)
        return 1
    print(f"already_published={'true' if present else 'false'}")
    if present:
        print("The public npm tarball matches the accepted archive; no duplicate upload is needed.", file=sys.stderr)
    else:
        print("The npm version is absent; the existing trusted publisher must upload it.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

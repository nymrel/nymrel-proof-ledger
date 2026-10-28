# Prepare and verify a release candidate

This procedure prepares exact npm and Python distributions without publishing
them. Use the existing release workflow and installed-consumer harness; do not
substitute an editable install or rebuild archives between acceptance and use.
Local results, hosted provenance, registry publication, and independent human
trials are separate evidence.

## Freeze and check the source

Finish the normal source review and relevant hosted checks. Record the full Git
revision and any uncommitted changes before building. Use a stable checkout for
the entire build; the installed-consumer harness rejects source drift.

From that checkout, with the supported runtimes in
[CONTRIBUTING.md](../CONTRIBUTING.md):

```sh
RELEASE_REF_TYPE=branch RELEASE_REF_NAME="$(git branch --show-current)" python3 tools/check_release.py
npm ci --ignore-scripts --no-audit --no-fund
npm run test:release
npm audit --audit-level=high
uvx pip-audit@2.10.1 .
uvx ruff@0.16.5 check --select E4,E7,E9,F python test tools
npm pack --dry-run --ignore-scripts
```

The branch preflight checks matching package versions. It does not establish
tag identity or integration into main. Tag preflight additionally requires the
matching package-version tag and source ancestry in `origin/main`.

## Build once and test the exact archives

Choose a new absolute output directory outside the source checkout:

```sh
npm run test:installed -- --output /absolute/path/to/new-candidate-acceptance
```

Retain `artifacts/`, `SHA256SUMS`, and `acceptance.json` together. The report
identifies the source snapshot, matching archive versions, command outcomes,
installed module locations, public-only cross-runtime authentication, tamper
rejection, CLI policies, and packaged documentation links. Review its final
verdict and recorded source before sharing the candidate.

If archives already exist, test those bytes without rebuilding:

```sh
npm run test:installed -- --artifacts /absolute/path/to/built-archives --output /absolute/path/to/new-acceptance
```

For pre-existing archives, the acceptance report identifies their hashes but
does not prove their build source. Retain the original build provenance too.
See the [installed-consumer guide](INSTALLED_CONSUMERS.md) for the complete
acceptance contract and the [human trial protocol](HUMAN_TRIAL.md) before
counting independent adoption.

## Hosted verification and publication boundaries

The existing `.github/workflows/release.yml` supports manual branch execution.
For a branch, its verify and build jobs run, including exact-archive acceptance;
the tag-only attestation and registry-publishing jobs are skipped. A successful
branch run supplies hosted build evidence, not a published release or hosted
build-provenance attestation.

Publication follows the existing tag, source-review, ancestry, provenance,
checksum, and protected-environment controls. Inspect the selected ref and all
job conditions before dispatching any run. Never move an existing release tag
to substitute a newer candidate. Recover retained immutable archives and their
original provenance when retrying a failed registry job; if those bytes are
unavailable, establish a new reviewed release rather than claiming a rebuild
is the original artifact.

## Observed historical release outcome

On October 28, 2026, all 124 returned workflow runs were inspected. The sole
release-workflow run was [the October 11 v2.0.0 run](https://github.com/nymrel/nymrel-proof-ledger/actions/runs/38175893610),
bound to source `392c6ee071230f98b08aec4c6e0c8b380f54fd28`. Verification,
distribution building, and provenance succeeded for that historical source.
The npm publisher failed with `ENEEDAUTH`; PyPI rejected its exchange with
`invalid-publisher` because no corresponding publisher matched the claims.
The GitHub releases collection was empty at this observation. These results
do not establish current registry configuration or publication availability,
and that old provenance does not apply to a newly built candidate.

Before any future publication, resolve the exact provider configuration through
the owning account, preserve existing tag identities, and verify the selected
release and archives. This candidate-preparation procedure changes no account
configuration and performs no registry publication.

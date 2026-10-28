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

## Restore publication prerequisites

Official documentation was read on October 28, 2026. The values below come from
this repository's existing release workflow; they are configuration inputs, not
evidence that either registry account has a matching publisher already saved.

| Publisher field | npm | PyPI |
| --- | --- | --- |
| Package/project | `@nymrel/proof-ledger` | `nymrel-proof-ledger` |
| GitHub organization/owner | `nymrel` | `nymrel` |
| GitHub repository | `nymrel-proof-ledger` | `nymrel-proof-ledger` |
| Workflow filename | `release.yml` | `release.yml` |
| GitHub environment | `npm` | `pypi` |
| Required operation | Allow direct `npm publish` | Publish through GitHub Actions |

Enter the workflow filename alone, including `.yml`, rather than the workflow's
display name or full `.github/workflows/` path. Preserve the exact environment
names. Both publishing jobs already request `id-token: write` and use
GitHub-hosted runners. The npm metadata already identifies the matching GitHub
repository. Trusted npm publication requires npm 11.5.1+ and Node 22.14.0+.

### PyPI: a pending publisher can create the first project

An account owner can open [account publishing](https://pypi.org/manage/account/publishing/)
and inspect existing pending entries. If no matching entry exists and setup is
authorized, add a GitHub pending publisher with the PyPI project name and the
four GitHub values above. For an existing project, use that project's
**Manage → Publishing** page instead. A pending publisher creates the project
on its first successful publication and then becomes a normal publisher; it
does not reserve the project name. See [creating a project through OIDC](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/)
and [adding a publisher](https://docs.pypi.org/trusted-publishers/adding-a-publisher/).

The historical `invalid-publisher` error means the signed OIDC claims did not
match a known publisher. Compare owner, repository, filename, environment, and
project name rather than adding a long-lived token. The [official error guide](https://docs.pypi.org/trusted-publishers/troubleshooting/)
explains this distinction. No authenticated PyPI account or pending-publisher
list was available during this preparation, so current saved entries remain
unknown.

### npm: establish the package before trusted-publisher setup

The [documented npm trust setup](https://docs.npmjs.com/cli/v12/commands/npm-trust)
requires an existing package. It does not provide PyPI's account-level pending
publisher bootstrap. An npm account with publish access to the `@nymrel` scope
must authorize first publication separately.

Current npm supports [staging a new package](https://docs.npmjs.com/staged-publishing/):
it creates a **public `0.0.0-stage` placeholder**, while the staged release bytes
remain unavailable until a maintainer approves them with 2FA. The owner can
review and approve through **Staged Packages** on npmjs.com, including from a
phone browser. Staging requires npm 11.15.0+ and Node 22.14.0+; the account must
have publish access and 2FA enabled. Staging the first package is itself a
registry change and was not performed by this preparation. An owner-authorized
authenticated bootstrap must use the accepted archive, rather than repacking
the source merely to publish it.

After the package exists, open its npm **Settings → Trusted publishing** and
inspect the current connections before adding one with the table's values.
Explicitly allow direct **`npm publish`** for the existing workflow: current
new configurations default to allowing staged publishing, which does not
authorize its direct publish command. A new connection must complete its
first successful publication within two days or it expires. See [npm trusted
publishing](https://docs.npmjs.com/trusted-publishers/). No authenticated npm
package settings were available here; current connections and scope ownership
remain unknown. No npm connection, staging, or account setting was changed.

### Run hosted branch verification before a new release

An authorized maintainer can open [the release workflow](https://github.com/nymrel/nymrel-proof-ledger/actions/workflows/release.yml),
choose **Run workflow**, select the **`main` branch**, and run it. This branch
run verifies and builds the selected source while the tag-only attestation and
publishers stay skipped. Check the run's source SHA and accepted archive hashes
before using its result. In the current cloud runtime the GitHub CLI read probe
returned `Forbidden`, the connected GitHub tool has no dispatch operation, and
no browser profile had a recorded GitHub sign-in. Supported authenticated access
is needed for the agent to perform this step; no token should be pasted into
chat and no desktop engineering relay is required.

For the next new patch release, review a version change to **`2.0.1`** in npm
and Python metadata and the npm lockfile, then use a new matching **`v2.0.1`**
tag after normal integration and checks. First confirm that this version/tag
remains unused. The existing annotated `v2.0.0` tag was observed pointing to
`392c6ee071230f98b08aec4c6e0c8b380f54fd28`; preserve it. Branch-built archives
must not be described as tag-bound release artifacts. These instructions do
not bump a version, create a tag, configure an account, or authorize publishing.

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

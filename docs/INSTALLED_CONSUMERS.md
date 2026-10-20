# Verify the exact local distributions

The repository remains the distribution channel. These checks build local npm
and Python archives and install those files; they do not publish to npm or PyPI.
Automated integration timings measure this host and its package caches. Two
independent human integration trials remain outstanding.

## Repeat the clean-environment acceptance check

Install Node.js 22.12 through 26.x, npm 11, Python 3.11 through 3.14, and uv. From
the source checkout, install development dependencies without lifecycle scripts:

```sh
npm ci --ignore-scripts
python3 test/installed_consumers.py --output /tmp/proof-ledger-acceptance
```

Choose a new output directory outside the checkout for each run. The harness
builds the npm archive, Python wheel, and Python source distribution. It installs
the exact npm archive in a new project, and the wheel and source distribution in
two separate virtual environments. Consumers run outside the checkout, without
`PYTHONPATH` or `NODE_PATH`; Python also uses isolated mode. No editable install
or source-tree API import is used.

Each Python installation creates an Ed25519 receipt that the installed Node
consumer verifies. Each also verifies the Node receipt. The scripts require
authenticated v2 success, rejection with a different public key, rejection of
changed signed metadata, and the untrusted status of integrity-only results.
Only public keys, receipts, and artifact bytes cross the signing/verifying
boundary. The private keys stay in the creating process's memory.

Python acceptance conditions use explicit checks that remain active with `-O`,
`-OO`, or `PYTHONOPTIMIZE`. Each installed Python consumer also runs with `-I -O`:
the original Node receipt succeeds, while changed signed metadata must fail
without emitting a `PASS` report. The regression suite injects failed subprocesses,
broken package links, and an incorrectly authenticated wrong-key verdict.

The installed `proof-ledger` and `proof-ledger-py` entry points are also exercised
against all three generated receipts. With `--require-trusted-v2 --check-files`,
they accept the authentic original and reject integrity-only verification, a
different key, the wrong configured algorithm, changed metadata, changed artifact
bytes, and missing artifacts. The check also confirms that default integrity-only
verification still exits zero. The harness verifies that relative Markdown links
in the npm archive's README and guides resolve to shipped files.

The retained output contains:

- `artifacts/`: the exact npm `.tgz`, Python `.whl`, and Python `.tar.gz` installed.
- `SHA256SUMS`: SHA-256 checksums for those archives.
- `acceptance.json`: source commit, dirty status, SHA-256 manifest of source
  files, runtime versions, every command's stdout/stderr and elapsed seconds,
  installation and verification results, and the overall verdict.

Consumer environments and ephemeral public fixtures are removed after the run.
The source manifest records uncommitted changes explicitly; the commit alone
does not identify a dirty build. If the source changes while archives are being
built, the harness fails and must be rerun against a stable checkout. The harness
uses package managers to obtain build/runtime dependencies and needs access to
their configured indexes or caches.

To check archives already built by release automation, pass their containing
directory. It may contain nested npm/Python output directories, with exactly one
`.tgz`, one `.whl`, and one `.tar.gz` in total:

```sh
python3 test/installed_consumers.py --artifacts /absolute/path/to/release --output /tmp/proof-ledger-release-acceptance
```

This mode skips every build and tests byte-for-byte copies of those files. It
checks names and matching versions from all three archives' metadata. The
checksums identify the supplied archives; the recorded checkout snapshot does
not establish where pre-existing archives were built. Release automation should
retain its own source provenance and compare these checksums with the archives
it uploads or publishes.

## Run the reference consumers yourself

The [Node consumer](../examples/installed-consumer.mjs) imports
`@nymrel/proof-ledger`; the [Python consumer](../examples/installed_consumer.py)
imports `nymrel_proof_ledger`. Copy them into separate consuming projects after
building and installing the local archives. Neither script imports from `dist`
or inserts this checkout into Python's import path.

For example, build the archives in the checkout:

```sh
npm run build
npm pack --ignore-scripts
uv build --out-dir /tmp/proof-ledger-python-artifacts
```

Create a new Node project outside the checkout. Replace `/absolute/source` with
the actual source path and use the archive filenames emitted by the build:

```sh
mkdir /tmp/ledger-node-consumer
cd /tmp/ledger-node-consumer
npm init -y
npm install /absolute/source/nymrel-proof-ledger-2.0.0.tgz --ignore-scripts
cp /absolute/source/examples/installed-consumer.mjs .
node installed-consumer.mjs create /tmp/ledger-node-public
```

Create the Python project outside the checkout and install the wheel:

```sh
mkdir /tmp/ledger-python-consumer
cd /tmp/ledger-python-consumer
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python /tmp/proof-ledger-python-artifacts/nymrel_proof_ledger-2.0.0-py3-none-any.whl
cp /absolute/source/examples/installed_consumer.py .
.venv/bin/python -I installed_consumer.py create /tmp/ledger-python-public
.venv/bin/python -I installed_consumer.py verify /tmp/ledger-node-public
```

Back in the Node consuming project:

```sh
node installed-consumer.mjs verify /tmp/ledger-python-public
```

Both scripts print a JSON `PASS` only after all acceptance checks succeed. The `create`
action requires new output files and refuses to overwrite existing receipts,
artifacts, or public configurations. The example shell commands use POSIX paths;
on Windows use the virtual environment's `Scripts/python.exe` and equivalent
copy commands.

For production, provision each verifier's public key and expected algorithm
through an authenticated channel controlled independently of the receipt. The
reference examples use disposable keys and public files as a local experiment.
`trusted: true` authenticates the documented signed fields under a configured key;
it does not establish that execution occurred or that an identity was authorized.
Read [verification boundaries](VERIFICATION_SECURITY.md) and
[security guidance](../SECURITY.md) before using receipts as an automation gate.

## Evidence status

The harness produces fresh, exact-archive evidence on each invocation. A passing
local run demonstrates installability and compatibility on the recorded host. It
does not establish the complete supported runtime matrix, independently repeated
human adoption, registry publication, or production identity/key-custody review.

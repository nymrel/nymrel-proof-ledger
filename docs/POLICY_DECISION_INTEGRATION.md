# Authenticate a policy decision artifact

An orchestrator can preserve a native policy engine result as an ordinary Ledger
artifact, then hand it to an offline verifier. The
[PermitMesh producer](../examples/permitmesh_decision.py) calls the installed
PermitMesh `authorize()` API and writes its native `Decision.to_dict()` projection
to `decision.json`. Ledger signs the artifact digest. A separate installed Node
CLI verifies the Python-created receipt and the exact decision bytes using only
public configuration. Neither core library acquires a new runtime dependency.

This source example is not in the historical `v2.0.0` Ledger archive. Build current
source distributions following the [installed-consumer guide](INSTALLED_CONSUMERS.md).
The integration profile exercises PermitMesh 0.2.0 from a separately built wheel;
it does not assume either package is available from a registry.

## Run a real producer and verifier

Install the built Ledger wheel and a reviewed PermitMesh wheel in a consumer
virtual environment outside both checkouts. Copy `permitmesh_decision.py` from
the Ledger source distribution into that consuming project. For example, with
absolute archive paths emitted by your builds:

```sh
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python /archives/nymrel_proof_ledger-2.0.1-py3-none-any.whl /archives/permitmesh-0.2.0-py3-none-any.whl
.venv/bin/python -I permitmesh_decision.py /permitmesh/examples/contract.valid.json /permitmesh/examples/request.allowed.json /tmp/policy-decision --public-config /tmp/policy-public-config.json --evaluation-time 2026-07-23T12:00:00Z
```

Those PermitMesh example files are fixed historical fixtures; the explicit clock
replays them. A production host must supply its own trusted clock, authenticated
contract, caller context and authoritative replay state. The example output is
`RECORDED` and includes `policyAllowed`; recording a denial also succeeds.

In another Node consuming project, install the exact built Ledger npm archive:

```sh
npm install /archives/nymrel-proof-ledger-2.0.1.tgz --ignore-scripts
cd /tmp/policy-decision
/absolute/node-consumer/node_modules/.bin/proof-ledger verify proof.json --key-file /tmp/policy-public-config.json --algo Ed25519 --check-files --require-trusted-v2 --json
```

The public configuration is deliberately outside the artifact directory. In this
local experiment the producer creates a disposable keypair; it never saves or
prints the private key. Real verifiers must obtain and authenticate their public
key and expected algorithm independently. Copying an arbitrary key supplied by an
untrusted producer does not establish an authorized signer.

CLI success authenticates the signed fields and requested artifact bytes. Only
after that check may a consumer inspect `decision.json`. An authenticated
`allowed: false` decision remains a denial: the verifier's successful exit does
not permit an action. Contract/decision digests in metadata identify the claimed
policy evaluation; the verifier does not replay the policy, authenticate the
contract issuer, or establish freshness/completeness of the caller context.
Native decision violations and checks can include input details. Use rights-cleared
fixtures and review artifact contents before sharing them.

## Repeat the installed acceptance check

Reuse the [existing archive harness](INSTALLED_CONSUMERS.md) with an explicit wheel
and a SHA-256 checked against its source/build evidence:

```sh
python3 test/installed_consumers.py --output /tmp/policy-acceptance --permitmesh-wheel /archives/permitmesh-0.2.0-py3-none-any.whl --permitmesh-sha256 YOUR_CHECKED_SHA256
```

The optional profile installs that exact wheel without dependencies beside the
installed Ledger wheel and runs the packaged producer with Python isolated mode.
It evaluates self-contained synthetic read fixtures: a permitted README path and
a denied `.env` path. Each Python-produced decision is authenticated by the
separately installed Node CLI, then checked against changed decision bytes,
missing artifacts and the wrong public key. Restoration must recover trusted
verification. Both decisions retain their own allow/deny meaning.

The harness records producer module origins, native reason codes, contract and
artifact identities, the copied example hash, wheel hash and every command. It
retains the PermitMesh wheel under `producer-artifacts/`. Existing archive inputs
can also be supplied with `--artifacts`; ordinary historical archive checks still
work without the optional profile. This opt-in integration is locally executable;
the default hosted matrix does not build or download PermitMesh.

These checks are synthetic installed-package integration evidence. They do not
dispatch tools, consume/reserve nonces, provide an enforcement boundary, prove
execution occurred, or establish external adoption. Keep those responsibilities
with the host and [preserve Ledger's trust boundaries](VERIFICATION_SECURITY.md).

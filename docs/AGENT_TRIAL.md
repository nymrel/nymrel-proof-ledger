# Independent provider-agent integration trials

Use this protocol when the operator requests agents to integrate the accepted
packages. It measures agent installation, verification, and recovery. Keep the
historical [human trial protocol](HUMAN_TRIAL.md) and its unobserved results intact.

For a comparison across providers, each participant must actually run through a
different model provider's supported agent runtime. Separate OpenAI agents can
test Node and Python independently, but establish OpenAI-only coverage. A prompt
claiming another provider, a model label, a synthetic response, or another hosting
company's shell does not establish a second model provider.

## Prepare the exact candidate

Reuse the [installed-consumer acceptance](INSTALLED_CONSUMERS.md) and existing
packet-preparation tool. Supply each agent only its participant packet and these
coordinator inputs:

- Exact accepted archive names, SHA-256 hashes, version, and source identity.
  Preserve dirty-source manifests and the builder's provenance when applicable.
  Local archives do not establish registry publication.
- The matching public Ed25519 configuration and its expected hash, delivered
  independently of the receipt through the authorized coordinator channel.
  Record the channel actually used; a separate directory alone is insufficient.
  Never distribute private keys or HMAC secrets as verification material.
- A new consuming-project directory outside the checkout and an evidence
  directory separate from the human results forms.

The existing Node and Python packets can be used with this protocol even when
their README describes a human participant. Label the resulting evidence as an
agent run; leave the packet's human `results.txt` blank. Refresh packets from
passing exact-archive acceptance when the candidate changes. A trial against an
older immutable candidate retains that candidate's identity.

## Establish provider access and independence

Discover the current supported tool or installed agent CLI. Record the actual
provider, runtime/CLI version, model identifier when exposed, session identity,
and the non-secret evidence supporting those identities. A successful provider
invocation establishes more than a tool listing or configured endpoint. Keep
unexposed model identifiers unknown.

Use existing authorization. Do not create accounts or credentials, inspect secret
files, change permissions, or select a paid route merely to make the comparison
appear complete. If a second provider cannot execute the trial through an
available authorized route, record that provider as unavailable with the failed
or missing capability. Continue any independent supported trial. Two trials on
one provider do not close the cross-provider criterion.

Start each agent with a fresh context containing only the assigned packet,
coordinator inputs, and this contract. Do not supply implementation history,
previous trial answers, or another participant's troubleshooting. Reuse the
packaged reference consumers rather than replacing them with a custom verifier.

## Run, time, and retain the result

1. Record prerequisite setup separately: runtime/tool versions, provider access,
   package-index availability, cache conditions, and material/hash checks.
2. Persist **T0**, in UTC and a suitable elapsed-time clock, before reading
   integration instructions or installing the package. Retain the exact task
   prompt. Include agent reasoning, tool latency, installation, retries, waiting,
   and assistance in the continuous elapsed time; do not reset after an error.
3. Follow the participant guide in a fresh consuming project. Record every
   command, exit status, sanitized stdout/stderr, and assistance. Require the
   installed module path to be outside the source checkout.
4. Record **Ttrusted** at the first JSON `PASS` containing all four reference
   checks: trusted-v2-public-only, wrong-key rejection, signed-metadata tamper
   rejection, and integrity-only untrusted verification. Report **Ttrusted - T0**
   as agent time. An under-15-minute result is an agent measurement; it does not
   establish the human onboarding target.
5. Move the original artifact out of its fixture directory and repeat
   verification. Require a nonzero exit and no `PASS`. Restore the exact original
   bytes, rerun, and require a new `PASS`. Record failure interpretation,
   assistance, and recovery time separately from the first trusted result.

Stop and preserve minimal sanitized evidence if altered data is accepted as
trusted, signing secrets are requested or exposed, or the receipt is allowed to
select its own trust configuration. Follow [security guidance](../SECURITY.md).

The result must identify `kind: agent-run`, provider/runtime evidence, exact
candidate and archive hashes, prerequisites, T0/Ttrusted, complete command logs,
errors/retries, assistance, installed module path, and recovery outcome. State
`human_trials_completed: 0`. Keep unavailable, failed, incomplete, and passed
provider runs distinct. A signed receipt still authenticates documented fields
under the configured key; it does not independently prove execution or authority.

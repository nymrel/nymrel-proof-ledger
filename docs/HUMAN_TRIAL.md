# Two independent integration trials

This is a protocol, not completed adoption evidence. Leave results blank until
observed. Automated checks and agent reviews do not count as human trials.

**Operator preference — October 28, 2026:** The active request uses independent
agents from different providers rather than recruiting people. Follow the
[provider-agent trial protocol](https://github.com/nymrel/nymrel-proof-ledger/blob/main/docs/AGENT_TRIAL.md)
for that work. Preserve this
human protocol and leave its unobserved results blank; agent trials supply their
own provider, timing, and recovery evidence.

Use two distinct people who did not implement these changes. Trial A uses Node;
trial B uses Python. Each person works alone in a fresh consuming project outside
the checkout, without seeing the other person's troubleshooting. Use the same
candidate and documentation. An observer may time the work; record every live
hint or intervention and distinguish assisted from unassisted results.

## Prepare before the trials

From a source checkout, prepare a reusable packet after the exact candidate
archives have passed the existing installed-consumer check:

```sh
python3 tools/prepare_human_trials.py \
  --acceptance /absolute/path/to/passing-installed-acceptance \
  --output /absolute/path/outside/checkout/human-trial-packet
```

The output directory must be new. Preparation reuses the accepted archives and
packaged reference consumers, checks archive hashes, creates disposable public
fixtures, and automatically checks opposite-runtime verification. It does not
rebuild archives. `packet.json` records preparation/source evidence; its automated
`PASS` is not a human-trial result. The two participant directories contain the
matching archive, reference script, opposite-runtime receipt/artifact, directions,
checksums, and blank results. The coordinator retains all three accepted archives
and the original acceptance report.

Give each person only their `trial-a-node` or `trial-b-python` directory. The
`public-configs` directory is kept separately for coordinator-controlled,
authenticated delivery of each public configuration and its checksum. This
directory separation does not itself authenticate delivery; record the actual
channel before a trial. Both trials remain unrun until independently observed.

The coordinator supplies the exact local npm archive and Python wheel, their
SHA-256 checksums, source revision and dirty-source manifest when applicable,
matching reference scripts, and the [installed-consumer guide](INSTALLED_CONSUMERS.md).
Record the candidate identifier; do not substitute a registry or editable install.
Archive-building time belongs to candidate preparation, separately from the
participant's setup and integration times.

Prepare disposable public fixtures with the matching installed reference
consumers: a Python-created receipt for trial A, and a Node-created receipt for
trial B. Give each participant `proof.json` and its matching `artifact.txt`.
Provision `verifier-config.json` separately through an authenticated channel
controlled by the coordinator, with the expected algorithm `Ed25519` and only
the public key. Record that channel and compare the configuration's checksum
with the authenticated expected value before verification; the receipt must not
select the verification key or algorithm. Place the independently
obtained configuration alongside the fixture for the reference script.

Measure prerequisite setup separately. Trial A needs Node.js 22.12 through 26.x
and npm 11. Trial B needs Python 3.11 through 3.14 and uv. Record OS, tool versions,
network/index availability, and cache conditions. Prerequisite setup includes
installing these tools and obtaining access to the trial materials. It ends
before the participant first opens the integration instructions or installs the
Proof Ledger package.

Use synthetic artifact bytes and disposable keys. Collect participant aliases,
timings, sanitized outputs, and observations; never collect private keys, HMAC
secrets, credentials, personal artifacts, or terminal history containing them.
Keep signing keys with the creating process; give the verifier public material
only. Review any saved output with the participant before retaining or sharing it.

## Run and time each trial

1. Record **T0** when prerequisites work, trial materials are locally available,
   and the participant starts reading the integration guide. Start before
   installing the candidate package. Record package-install start/end separately.
2. Have the participant follow the guide's consuming-project steps for their
   runtime, checking the supplied archive's checksum, installing it, and copying
   the matching reference script. They receive the opposite runtime's public
   fixture prepared above; they do not need to install the other runtime or
   recreate its signing key.
3. From the Node consuming project, trial A runs:

   ```sh
   node installed-consumer.mjs verify /absolute/trial/python-public
   ```

   From the Python consuming project, trial B runs:

   ```sh
   .venv/bin/python -I installed_consumer.py verify /absolute/trial/node-public
   ```

   Use the virtual environment's `Scripts/python.exe` on Windows. Each fixture
   directory contains the independently provisioned `verifier-config.json`.
4. Record **Ttrusted** on the first observed JSON `PASS` with
   `trusted-v2-public-only` in `checks`. Confirm the reported module is installed
   in the consuming project/environment, outside this checkout. The script
   asserts v2, `valid: true`, `trusted: true`, a checked signature, and a matched
   disk artifact; it also asserts wrong-key and signed-metadata tamper rejection
   and integrity-only `trusted: false`. Save the output and exit status.
5. Report wall time **Ttrusted − T0** against the **under-15-minute target**.
   Include reading, installation, retries, waiting, and help in that elapsed
   time; record their durations separately without subtracting them. Document
   the first error, retries, exact assistance, and any unclear instruction.
   A later successful retry must not reset T0 or erase a target miss.

The first observed `PASS` comes after the script's automatic rejection checks;
this conservative observation point is used consistently for both trials.

## Observe a recoverable error

After the timed trusted result, use a disposable copy of that fixture with
`artifact.txt` temporarily absent. Run the same verification command. Record
the nonzero exit, the participant's interpretation of the error, whether they
can identify the missing artifact, and any assistance. Restore the original
matching artifact and record elapsed time to a new `PASS`. Keep recovery time
separate from the first-trusted-result metric. Record whether automatic tamper
and integrity-only results were understandable, rather than treating a script
exit as evidence the participant understood them.

## Finish or stop

- Finish a trial only with recorded trusted verification, the automatic rejection
  checks, and the observed failure/recovery exercise. Report actual elapsed time
  and assistance even if all checks eventually pass.
- At 15 minutes, record a target miss. Continue only if the participant wants to;
  stop by 30 minutes or at their request and retain the incomplete result.
- Stop if altered data is accepted as trusted, private signing material is
  requested or exposed, or proceeding would require a receipt-supplied trust key.
  Preserve minimal sanitized evidence and open an issue before another attempt.
- If prerequisites, archives, or authenticated public configuration are unavailable,
  mark the trial blocked and identify the missing input. Do not replace the person
  with automation or mark an unrun, blocked, or assisted trial as unassisted success.

`trusted: true` authenticates the documented fields under the configured key;
it does not establish execution or signer authorization. Two completed human
trials support an adoption claim; they do not establish registry publication.

## Blank results template — copy once per person

```text
Trial ID / participant alias / date and timezone:
Runtime (A: Node / B: Python) / OS / tool versions:
Independence from implementation and other participant's run:
Candidate ID / source revision / dirty-source manifest SHA-256:
Archive filename and SHA-256 / reference-script and guide version:
Public-config authenticated channel and SHA-256 (no private material):
Network/index and cache conditions:
Candidate preparation duration (coordinator):
Prerequisite setup start / end / duration:
T0 (before guide reading and package installation):
Package installation start / end / duration:
Ttrusted / wall seconds since T0 / under 15 minutes? (yes/no):
First error / retry count / waiting time / unclear instructions:
Assistance (none, or timestamp, person/tool and exact intervention):
Installed module path / sanitized output and exit-status evidence:
Automatic checks: trusted v2 / wrong key / metadata tamper / integrity-only:
Missing-artifact error / participant interpretation / assistance:
Recovery start / restored PASS / elapsed seconds:
Outcome (unrun / complete / target miss / blocked / stopped) and reason:
Participant observations / follow-up issue / retained-evidence location:
```

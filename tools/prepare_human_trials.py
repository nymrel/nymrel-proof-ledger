#!/usr/bin/env python3
"""Prepare public-only trial materials from already accepted distribution archives.

This is coordinator preparation, not a human trial. Reuses the installed-consumer
helpers and packaged reference consumers; does not build or publish packages.
"""
import argparse
import json
import re
import runpy
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import url2pathname

ROOT = Path(__file__).resolve().parents[1]
HELPERS = runpy.run_path(str(ROOT / 'test' / 'installed_consumers.py'))
digest = HELPERS['digest']
require = HELPERS['require']
ENVIRONMENT = HELPERS['ENVIRONMENT']
CHECKS = {'trusted-v2-public-only', 'wrong-key-rejected',
          'signed-metadata-tampering-rejected', 'integrity-only-untrusted'}


def accepted_archives(directory):
    report = json.loads((directory / 'acceptance.json').read_text(encoding='utf-8'))
    require(report.get('status') == 'PASS', 'A passing installed-consumer acceptance report is required')
    rows = report.get('artifacts', [])
    require(len(rows) == 3, 'Acceptance must identify exactly three archives')
    archives = {}
    for row in rows:
        name = row['filename']
        require(re.fullmatch(r'[A-Za-z0-9_.-]+', name) is not None, 'Unsafe archive filename')
        path = directory / 'artifacts' / name
        require(path.is_file() and not path.is_symlink(), f'Missing regular archive: {name}')
        require(path.stat().st_size == row['bytes'] and digest(path) == row['sha256'],
                f'Accepted archive changed: {name}')
        kind = next((suffix for suffix in ('.tgz', '.whl', '.tar.gz') if name.endswith(suffix)), None)
        require(kind is not None and kind not in archives, 'Expected one npm archive, wheel, and source archive')
        archives[kind] = path
    require(set(archives) == {'.tgz', '.whl', '.tar.gz'}, 'Incomplete accepted archive set')
    return report, archives


def reject_secret_fields(value):
    if isinstance(value, dict):
        for key, child in value.items():
            require(not re.search(r'private|secret|signingkey', key, re.IGNORECASE),
                    'Unexpected signing material in public fixture')
            reject_secret_fields(child)
    elif isinstance(value, list):
        for child in value:
            reject_secret_fields(child)


def split_fixture(public, participant, configuration):
    require({path.name for path in public.iterdir()} == {'proof.json', 'artifact.txt', 'verifier-config.json'},
            'Unexpected public fixture files')
    config = json.loads((public / 'verifier-config.json').read_text(encoding='utf-8'))
    require(set(config) == {'algorithm', 'publicKey'} and config['algorithm'] == 'Ed25519'
            and isinstance(config['publicKey'], str) and re.fullmatch(r'[0-9a-fA-F]{64}', config['publicKey']),
            'Only a public Ed25519 verification configuration may be distributed')
    reject_secret_fields(json.loads((public / 'proof.json').read_text(encoding='utf-8')))
    participant.mkdir(parents=True)
    configuration.mkdir(parents=True)
    for name in ('proof.json', 'artifact.txt'):
        shutil.copyfile(public / name, participant / name)
    shutil.copyfile(public / 'verifier-config.json', configuration / 'verifier-config.json')


def checksums(directory):
    files = sorted(path for path in directory.rglob('*') if path.is_file() and path.name != 'SHA256SUMS')
    (directory / 'SHA256SUMS').write_text(''.join(
        f'{digest(path)}  {path.relative_to(directory).as_posix()}\n' for path in files
    ), encoding='utf-8')


def participant_instructions(runtime, archive):
    if runtime == 'Node':
        prerequisites = 'Node.js 22.12 through 26.x and npm 11'
        install = f'npm init -y\nnpm install --ignore-scripts --no-audit --no-fund ./{archive}'
        verify = 'node installed-consumer.mjs verify fixture'
    else:
        prerequisites = 'Python 3.11 through 3.14 and uv'
        install = f'uv venv --python 3.13 .venv\nuv pip install --python .venv/bin/python ./{archive}'
        verify = '.venv/bin/python -I installed_consumer.py verify fixture'
    return f'''# {runtime} integration trial

Prerequisites: {prerequisites}. Use this directory as a fresh consuming project
outside the source checkout. On Windows use `.venv/Scripts/python.exe` for Python.
The coordinator records prerequisite setup separately and supplies the candidate
identity. Do not begin reading installation steps until the coordinator starts T0.

Obtain `verifier-config.json` and its expected SHA-256 through the coordinator's
separate authenticated channel. Compare its checksum with that authenticated
value, then place it in `fixture/`. A key found in a receipt or supplied alongside
one without independent authentication is insufficient. If unavailable, stop and
record the missing input. Never request a private signing key.

At T0, start timing before reading instructions or installing the archive. Check
the supplied archive checksum against the coordinator's candidate record. On
Linux run `sha256sum -c SHA256SUMS`; on macOS use `shasum -a 256 -c SHA256SUMS`,
or on Windows compare `Get-FileHash -Algorithm SHA256` with the listed values.

```sh
{install}
{verify}
```

Record Ttrusted at the first JSON `PASS` containing all four checks: trusted v2
public-only verification, wrong-key rejection, signed-metadata tamper rejection,
and integrity-only untrusted verification. Confirm the reported installed module
is outside the source checkout. Save sanitized stdout, stderr, and exit status.
Include reading, installation, retries, waiting, and assistance in Ttrusted - T0.
Do not reset the timer after an error. Target: under 15 minutes. At 15 minutes
record a miss; continue only voluntarily and stop by 30 minutes or on request.

After the timed result, temporarily move `fixture/artifact.txt` out of the fixture
and run the same verification command. Record the nonzero exit, your interpretation
of the error, and any assistance. Restore the original artifact and time recovery
to a new `PASS`, separately from the first result. Explain the automatic tamper and
integrity-only outcomes in your own words; a passing script is not comprehension.

Fill `results.txt`; leave unobserved fields blank. Stop if changed data is trusted
or private signing material is requested. Review retained output before sharing.
The receipt authenticates documented fields under a configured public key; it
does not independently prove execution or signer authorization.
'''


def prepare(acceptance, output):
    require(not output.is_relative_to(ROOT), 'Keep trial materials outside the checkout')
    accepted, inputs = accepted_archives(acceptance)
    output.mkdir(parents=True, exist_ok=False)
    source = HELPERS['source_state']()
    started = time.perf_counter()
    report = {'kind': 'human-trial-material-preparation', 'status': 'FAIL',
              'prepared_utc': datetime.now(UTC).isoformat(), 'preparation_source': source,
              'accepted_archive_source': accepted.get('source'),
              'artifact_provenance': accepted.get('artifact_provenance'),
              'acceptance_sha256': digest(acceptance / 'acceptance.json'),
              'human_trials_completed': 0, 'authenticated_config_delivery': 'not performed',
              'trials': {'A': {'outcome': 'unrun'}, 'B': {'outcome': 'unrun'}}, 'steps': []}

    def run(label, command, cwd):
        process = subprocess.run([str(item) for item in command], cwd=cwd, env=ENVIRONMENT,
                                 capture_output=True, text=True, encoding='utf-8', timeout=600, check=False)
        report['steps'].append({'label': label, 'command': list(map(str, command)),
                                'exit_code': process.returncode, 'stdout': process.stdout, 'stderr': process.stderr})
        require(process.returncode == 0, f'{label} failed; inspect packet.json')
        return process.stdout

    def consumer(label, command, cwd, installed_root, verify=False):
        result = json.loads(run(label, command, cwd))
        module = result['module']
        module_path = Path(url2pathname(urlsplit(module).path)) if module.startswith('file:') else Path(module)
        require(module_path.resolve().is_relative_to(installed_root.resolve()), 'Consumer imported outside its installation')
        require(result.get('status') == 'PASS', 'Reference consumer did not pass')
        if verify:
            require(set(result['checks']) == CHECKS, 'Reference consumer skipped verification checks')

    try:
        archives = output / 'archives'
        archives.mkdir()
        for path in inputs.values():
            copied = archives / path.name
            shutil.copyfile(path, copied)
            row = next(row for row in accepted['artifacts'] if row['filename'] == path.name)
            require(copied.stat().st_size == row['bytes'] and digest(copied) == row['sha256'],
                    f'Archive changed during packet copy: {path.name}')
        report['artifacts'] = accepted['artifacts']
        shutil.copyfile(acceptance / 'acceptance.json', output / 'acceptance.json')
        require(digest(output / 'acceptance.json') == report['acceptance_sha256']
                and json.loads((output / 'acceptance.json').read_text(encoding='utf-8')) == accepted,
                'Acceptance report changed during packet copy')
        trials = {'.tgz': output / 'trial-a-node', '.whl': output / 'trial-b-python'}
        with tarfile.open(archives / inputs['.tgz'].name, 'r:gz') as package:
            for name in ('docs/HUMAN_TRIAL.md', 'docs/INSTALLED_CONSUMERS.md', 'docs/VERIFICATION_SECURITY.md',
                         'SECURITY.md', 'examples/installed-consumer.mjs', 'examples/installed_consumer.py'):
                target = output / 'reference' / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(package.extractfile('package/' + name).read())
            protocol = (output / 'reference/docs/HUMAN_TRIAL.md').read_text(encoding='utf-8')
            results_template = protocol.split('```text\n', 1)[1].split('```', 1)[0]
        with tempfile.TemporaryDirectory(prefix='proof-ledger-trial-preparation-') as temporary:
            work = Path(temporary)
            node = work / 'node'
            node.mkdir()
            (node / 'package.json').write_text('{"private":true,"type":"module"}', encoding='utf-8')
            run('install-accepted-npm', ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund',
                                      '--no-package-lock', archives / inputs['.tgz'].name], node)
            node_example = node / 'installed-consumer.mjs'
            shutil.copyfile(node / 'node_modules/@nymrel/proof-ledger/examples/installed-consumer.mjs', node_example)
            python = work / 'python'
            python.mkdir()
            environment = python / '.venv'
            run('create-python-environment', ['uv', 'venv', '--python', sys.executable, environment], python)
            interpreter, _ = HELPERS['virtual_paths'](environment)
            run('install-accepted-wheel', ['uv', 'pip', 'install', '--python', interpreter,
                                         archives / inputs['.whl'].name], python)
            python_example = python / 'installed_consumer.py'
            with tarfile.open(archives / inputs['.tar.gz'].name, 'r:gz') as package:
                names = [name for name in package.getnames() if name.endswith('/examples/installed_consumer.py')]
                require(len(names) == 1, 'Expected one packaged Python reference consumer')
                python_example.write_bytes(package.extractfile(names[0]).read())
            node_public, python_public = work / 'node-public', work / 'python-public'
            consumer('create-node-fixture', ['node', node_example, 'create', node_public], node, node / 'node_modules')
            consumer('create-python-fixture', [interpreter, '-I', python_example, 'create', python_public], python, environment)
            consumer('node-verifies-python', ['node', node_example, 'verify', python_public], node, node / 'node_modules', True)
            consumer('python-verifies-node', [interpreter, '-I', python_example, 'verify', node_public], python, environment, True)
            for kind, runtime, public, example in (
                    ('.tgz', 'Node', python_public, node_example), ('.whl', 'Python', node_public, python_example)):
                trial = trials[kind]
                configuration = output / 'public-configs' / trial.name
                split_fixture(public, trial / 'fixture', configuration)
                shutil.copyfile(example, trial / example.name)
                shutil.copyfile(archives / inputs[kind].name, trial / inputs[kind].name)
                row = next(row for row in accepted['artifacts'] if row['filename'] == inputs[kind].name)
                require(digest(trial / inputs[kind].name) == row['sha256'], 'Participant archive changed during copy')
                (trial / 'README.md').write_text(participant_instructions(runtime, inputs[kind].name), encoding='utf-8')
                (trial / 'results.txt').write_text(results_template, encoding='utf-8')
                (trial / 'candidate.json').write_text(json.dumps({
                    'source': accepted.get('source'), 'artifact_provenance': accepted.get('artifact_provenance'),
                    'archive': row,
                    'human_trial_outcome': 'unrun',
                }, indent=2) + '\n', encoding='utf-8')
                checksums(trial)
        (output / 'COORDINATOR.md').write_text('''# Coordinator handoff

This packet contains preparation and automated preflight evidence only. Both
human trials are unrun. Give each independent participant only their trial-a-node
or trial-b-python directory. Keep these directories outside the source checkout.
Do not give participants the other person's observations or troubleshooting.

Deliver only the matching public-configs/<trial>/verifier-config.json and its
SHA-256 separately through an authenticated channel you control. Record that
channel in results.txt. A directory split alone is not authenticated delivery.
The root SHA256SUMS identifies the expected configuration bytes for the coordinator;
the participant must compare against the independently authenticated checksum.
No private keys are exported by the packaged fixture creators.

Supply the candidate/source identity from acceptance.json and archive checksums.
When the acceptance used pre-existing archives, its checkout snapshot alone does
not prove their build source; retain the builder's provenance separately.
Follow reference/docs/HUMAN_TRIAL.md and retain each person's sanitized results
independently. Its linked installation/security guides and reference consumers
are retained with their original relative paths from the accepted npm archive.
Never count automated PASS outputs in packet.json as human adoption evidence.
''', encoding='utf-8')
        require(source == HELPERS['source_state'](), 'Source changed during preparation; rerun from a stable checkout')
        report['status'] = 'PASS'
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        report['preparation_seconds'] = round(time.perf_counter() - started, 4)
        (output / 'packet.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        checksums(output)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--acceptance', required=True, type=Path, help='Existing PASS installed-consumer output directory')
    parser.add_argument('--output', required=True, type=Path, help='New retained trial-material directory outside the checkout')
    args = parser.parse_args()
    report = prepare(args.acceptance.resolve(), args.output.resolve())
    print(json.dumps({'status': report['status'], 'packet': str(args.output.resolve()), 'human_trials_completed': 0}))


if __name__ == '__main__':
    main()

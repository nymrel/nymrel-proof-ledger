#!/usr/bin/env python3
"""Build local archives, then exercise actual installed consumers outside the checkout.

Requires Node/npm, uv, and Python 3.11–3.14. No registry publication occurs.
The output directory retains artifacts, hashes, command results, and elapsed times.
"""
import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
ENVIRONMENT = {
    key: value for key, value in os.environ.items()
    if key not in ('PYTHONPATH', 'PYTHONHOME', 'NODE_PATH', 'NODE_OPTIONS', 'VIRTUAL_ENV')
}
ENVIRONMENT['PYTHONNOUSERSITE'] = '1'


def require(condition, message):
    """Keep acceptance checks active under Python -O/-OO and PYTHONOPTIMIZE."""
    if not condition:
        raise AssertionError(message)


def digest(path):
    hasher = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def source_state():
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=ROOT, env=ENVIRONMENT)

    names = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').decode().split('\0')
    files = {name: digest(ROOT / name) for name in sorted(set(names)) if name and (ROOT / name).is_file()}
    return {
        'revision': git('rev-parse', 'HEAD').decode().strip(),
        'status': git('status', '--short').decode(),
        'files_sha256': files,
        'manifest_sha256': hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(),
    }


def virtual_paths(environment):
    scripts = environment / ('Scripts' if os.name == 'nt' else 'bin')
    return scripts / ('python.exe' if os.name == 'nt' else 'python'), scripts


def check_npm_documentation(archive):
    """Every relative Markdown link in the shipped README and guides must resolve."""
    with tarfile.open(archive, 'r:gz') as package:
        members = {member.name: member for member in package.getmembers() if member.isfile()}
        checked = 0
        for name, member in members.items():
            if not (name == 'package/README.md' or name.startswith('package/docs/')) or not name.endswith('.md'):
                continue
            stream = package.extractfile(member)
            require(stream is not None, 'Installed-consumer acceptance condition failed')
            markdown = stream.read().decode('utf-8')
            for target in re.findall(r'\[[^\]]*\]\(([^\s)]+)\)', markdown):
                link = urlsplit(target.strip('<>'))
                if link.scheme or link.netloc or not link.path:
                    continue
                candidate = os.path.normpath(str(Path(name).parent / unquote(link.path))).replace('\\', '/')
                require(candidate in members, f'Broken packaged documentation link: {name}: {target}')
                checked += 1
        for required in ('package/examples/installed-consumer.mjs', 'package/examples/installed_consumer.py',
                         'package/SECURITY.md', 'package/CONTRIBUTING.md', 'package/docs/INSTALLED_CONSUMERS.md'):
            require(required in members, f'Missing npm archive member: {required}')
        return checked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='New output directory outside the source checkout; retained after the run')
    parser.add_argument('--artifacts', type=Path, help='Reuse exactly one npm tgz, wheel, and Python tar.gz found recursively here; skip rebuilding')
    args = parser.parse_args()
    output = args.output.resolve() if args.output else Path(tempfile.mkdtemp(prefix='proof-ledger-acceptance-'))
    require(not output.is_relative_to(ROOT), 'Keep build artifacts and consumer environments outside the checkout')
    if args.output:
        output.mkdir(parents=True, exist_ok=False)
    artifacts = output / 'artifacts'
    artifacts.mkdir()
    steps = []
    started = time.perf_counter()
    report = {
        'started_utc': datetime.now(UTC).isoformat(),
        'kind': 'automated-clean-environment-acceptance',
        'human_adoption_trials': 0, 'registry_publication_performed': False,
        'artifact_mode': 'existing-archives' if args.artifacts else 'build-local',
        'artifact_provenance': (
            'Supplied archives are identified by hashes; the checkout snapshot does not establish their build source.'
            if args.artifacts else 'Archives built from the recorded stable checkout snapshot.'
        ),
        'host': {'platform': platform.platform(), 'python': platform.python_version()},
        'steps': steps,
    }

    def run(label, command, cwd, expected=(0,)):
        begin = time.perf_counter()
        process = subprocess.run(
            [str(item) for item in command], cwd=cwd, env=ENVIRONMENT,
            capture_output=True, text=True, encoding='utf-8', timeout=600, check=False,
        )
        row = {
            'label': label, 'command': [str(item) for item in command], 'cwd': str(cwd),
            'seconds': round(time.perf_counter() - begin, 4), 'exit_code': process.returncode,
            'stdout': process.stdout, 'stderr': process.stderr,
        }
        steps.append(row)
        require(process.returncode in expected, f'{label} failed: {row}')
        return process

    def json_run(label, command, cwd, expected=(0,)):
        return json.loads(run(label, command, cwd, expected).stdout)

    try:
        report['source'] = source_state()
        report['host']['node'] = run('node-version', ['node', '--version'], ROOT).stdout.strip()
        report['host']['npm'] = run('npm-version', ['npm', '--version'], ROOT).stdout.strip()
        report['host']['uv'] = run('uv-version', ['uv', '--version'], ROOT).stdout.strip()
        if args.artifacts:
            supplied = args.artifacts.resolve()
            require(supplied.is_dir(), f'Artifact input directory does not exist: {supplied}')
            for pattern in ('*.tgz', '*.whl', '*.tar.gz'):
                matches = [path for path in supplied.rglob(pattern) if path.is_file()]
                require(len(matches) == 1, f'Expected exactly one {pattern} recursively under {supplied}')
                shutil.copyfile(matches[0], artifacts / matches[0].name)
        else:
            run('npm-build', ['npm', 'run', 'build'], ROOT)
            json_run('npm-pack', [
                'npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', artifacts,
            ], ROOT)
            run('python-build-sdist-and-wheel', ['uv', 'build', '--python', sys.executable, '--out-dir', artifacts], ROOT)
            require(report['source'] == source_state(), 'Source changed during artifact construction; rerun against a stable checkout')
        npm_archives = list(artifacts.glob('*.tgz'))
        require(len(npm_archives) == 1, 'Expected exactly one npm archive')
        npm_archive = npm_archives[0]
        with tarfile.open(npm_archive, 'r:gz') as distribution:
            manifest_stream = distribution.extractfile('package/package.json')
            require(manifest_stream is not None, 'Installed-consumer acceptance condition failed')
            npm_metadata = json.load(manifest_stream)
            require(npm_metadata['name'] == '@nymrel/proof-ledger', 'Installed-consumer acceptance condition failed')
        report['packaged_markdown_links_checked'] = check_npm_documentation(npm_archive)
        wheels = list(artifacts.glob('*.whl'))
        sdists = list(artifacts.glob('*.tar.gz'))
        require(len(wheels) == len(sdists) == 1, 'Expected exactly one wheel and sdist')
        wheel, sdist = wheels[0], sdists[0]
        with zipfile.ZipFile(wheel) as distribution:
            metadata_names = [name for name in distribution.namelist() if name.endswith('.dist-info/METADATA')]
            require(len(metadata_names) == 1, 'Installed-consumer acceptance condition failed')
            metadata = distribution.read(metadata_names[0]).decode()
            version = re.search(r'^Version: (.+)$', metadata, flags=re.MULTILINE).group(1)
            wheel_name = re.search(r'^Name: (.+)$', metadata, flags=re.MULTILINE).group(1)
            require(re.sub(r'[-_.]+', '-', wheel_name).lower() == 'nymrel-proof-ledger', 'Installed-consumer acceptance condition failed')
        require(npm_metadata['version'] == version, 'Node and Python distribution versions differ')
        with tarfile.open(sdist, 'r:gz') as distribution:
            names = distribution.getnames()
            metadata_member = next(name for name in names if name.count('/') == 1 and name.endswith('/PKG-INFO'))
            metadata_stream = distribution.extractfile(metadata_member)
            require(metadata_stream is not None, 'Installed-consumer acceptance condition failed')
            sdist_metadata = metadata_stream.read().decode('utf-8')
            require(re.search(r'^Version: (.+)$', sdist_metadata, flags=re.MULTILINE).group(1) == version, 'Installed-consumer acceptance condition failed')
            sdist_name = re.search(r'^Name: (.+)$', sdist_metadata, flags=re.MULTILINE).group(1)
            require(re.sub(r'[-_.]+', '-', sdist_name).lower() == 'nymrel-proof-ledger', 'Installed-consumer acceptance condition failed')
            example_member = next(name for name in names if name.endswith('/examples/installed_consumer.py'))
            example_stream = distribution.extractfile(example_member)
            require(example_stream is not None, 'Installed-consumer acceptance condition failed')
            python_example_bytes = example_stream.read()
            require(any(name.endswith('/docs/INSTALLED_CONSUMERS.md') for name in names), 'Installed-consumer acceptance condition failed')
        report['version'] = version
        report['artifacts'] = [
            {'filename': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path)}
            for path in (npm_archive, wheel, sdist)
        ]
        (output / 'SHA256SUMS').write_text(''.join(
            f"{row['sha256']}  artifacts/{row['filename']}\n" for row in report['artifacts']
        ), encoding='utf-8')

        with tempfile.TemporaryDirectory(prefix='proof-ledger-consumers-') as temporary:
            consumer_root = Path(temporary).resolve()
            require(not consumer_root.is_relative_to(ROOT), 'Installed-consumer acceptance condition failed')
            node_project = consumer_root / 'node'
            node_project.mkdir()
            (node_project / 'package.json').write_text(json.dumps({'private': True, 'type': 'module'}), encoding='utf-8')
            node_example = node_project / 'installed-consumer.mjs'
            run('node-install-exact-tarball', [
                'npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', npm_archive,
            ], node_project)
            shutil.copy2(node_project / 'node_modules/@nymrel/proof-ledger/examples/installed-consumer.mjs', node_example)
            node_cli = node_project / 'node_modules/.bin' / ('proof-ledger.cmd' if os.name == 'nt' else 'proof-ledger')
            run('node-installed-cli-help', [node_cli, '--help'], node_project)
            node_public = consumer_root / 'node-public'
            created = json_run('node-create', ['node', node_example, 'create', node_public], node_project)
            require(str(ROOT) not in created['module'], 'Installed-consumer acceptance condition failed')
            require(str(node_project / 'node_modules') in unquote(created['module']), 'Installed-consumer acceptance condition failed')
            consumers = [('node', node_project, [node_cli])]
            receipts = [('node', node_public)]

            for kind, archive in (('wheel', wheel), ('sdist', sdist)):
                project = consumer_root / kind
                project.mkdir()
                environment = project / '.venv'
                run(f'{kind}-environment', ['uv', 'venv', '--python', sys.executable, environment], project)
                python, scripts = virtual_paths(environment)
                run(f'{kind}-install-exact-archive', ['uv', 'pip', 'install', '--python', python, archive], project)
                run(f'{kind}-installed-dependencies', ['uv', 'pip', 'freeze', '--python', python], project)
                python_example = project / 'installed_consumer.py'
                python_example.write_bytes(python_example_bytes)
                python_cli = scripts / ('proof-ledger-py.exe' if os.name == 'nt' else 'proof-ledger-py')
                run(f'{kind}-installed-cli-help', [python_cli, '--help'], project)
                public = consumer_root / f'{kind}-public'
                created = json_run(f'{kind}-create', [python, '-I', python_example, 'create', public], project)
                require(Path(created['module']).resolve().is_relative_to(environment), 'Installed-consumer acceptance condition failed')
                require(created['version'] == version, 'Installed-consumer acceptance condition failed')
                receipts.append((kind, public))
                consumers.append((kind, project, [python_cli]))
                result = json_run(f'{kind}-verify-node-public-only', [python, '-I', python_example, 'verify', node_public], project)
                require(len(result['checks']) == 4, 'Installed-consumer acceptance condition failed')
                optimized = json_run(f'{kind}-verify-node-optimized', [python, '-I', '-O', python_example, 'verify', node_public], project)
                require(len(optimized['checks']) == 4, 'Optimized consumer must execute every verdict check')
                original_receipt = (node_public / 'proof.json').read_bytes()
                corrupted = json.loads(original_receipt)
                corrupted['metadata']['purpose'] = 'changed-after-signing'
                (node_public / 'proof.json').write_text(json.dumps(corrupted), encoding='utf-8')
                try:
                    rejected = run(f'{kind}-verify-node-optimized-tampering', [
                        python, '-I', '-O', python_example, 'verify', node_public,
                    ], project, expected=(1,))
                    require(not rejected.stdout.strip(), 'Rejected optimized consumer must not emit PASS evidence')
                finally:
                    (node_public / 'proof.json').write_bytes(original_receipt)
                result = json_run(f'node-verify-{kind}-public-only', ['node', node_example, 'verify', public], node_project)
                require(len(result['checks']) == 4, 'Installed-consumer acceptance condition failed')

            cli_checks = []
            for source, public in receipts:
                config = json.loads((public / 'verifier-config.json').read_text(encoding='utf-8'))
                require(sorted(config) == ['algorithm', 'publicKey'], 'Installed-consumer acceptance condition failed')
                require(not any('private' in name.lower() or 'secret' in name.lower() for name in config), 'Installed-consumer acceptance condition failed')
                receipt = json.loads((public / 'proof.json').read_text(encoding='utf-8'))
                tampered = deepcopy(receipt)
                tampered['metadata']['purpose'] = 'changed-after-signing'
                (public / 'tampered.json').write_text(json.dumps(tampered), encoding='utf-8')
                other = next(directory for name, directory in receipts if name != source)
                for consumer, project, cli in consumers:
                    common = ['--algo', 'Ed25519', '--check-files', '--require-trusted-v2', '--json']
                    normal = ['--key-file', public / 'verifier-config.json']

                    def gate(case, proof='proof.json', key_args=None, options=None, accepted=False,
                             context=(normal, consumer, source, cli, common, public)):
                        normal, consumer, source, cli, common, public = context
                        args_for_key = normal if key_args is None else key_args
                        result = json_run(f'{consumer}-gate-{source}-{case}', [
                            *cli, 'verify', proof, *args_for_key, *(common if options is None else options),
                        ], public, (0,) if accepted else (1,))
                        require(result['trusted'] is accepted, (consumer, source, case, result))
                        require(result['policy']['name'] == 'authenticated-v2', 'Installed-consumer acceptance condition failed')
                        require(result['policy']['passed'] is accepted, 'Installed-consumer acceptance condition failed')
                        require(bool(result['policy']['errors']) is not accepted, 'Installed-consumer acceptance condition failed')
                        if accepted:
                            require(result['valid'] and result['signatureChecked'] and result['checkedArtifacts'] == 1, 'Installed-consumer acceptance condition failed')
                        cli_checks.append({'consumer': consumer, 'signer': source, 'case': case, 'accepted': accepted})
                        return result

                    gate('trusted-v2-public-only', accepted=True)
                    integrity = gate('integrity-only-rejected', key_args=[], options=[
                        '--check-files', '--require-trusted-v2', '--json',
                    ])
                    require(integrity['valid'] and not integrity['signatureChecked'], 'Installed-consumer acceptance condition failed')
                    # The default retains integrity-only success; the gate is opt-in.
                    default = json_run(f'{consumer}-default-integrity-only-{source}', [
                        *cli, 'verify', 'proof.json', '--check-files', '--json',
                    ], public)
                    require(default['valid'] and not default['trusted'], 'Installed-consumer acceptance condition failed')
                    require('policy' not in default, 'Installed-consumer acceptance condition failed')
                    gate('wrong-key-rejected', key_args=['--key-file', other / 'verifier-config.json'])
                    gate('wrong-algorithm-rejected', options=[
                        '--algo', 'HMAC-SHA256', '--check-files', '--require-trusted-v2', '--json',
                    ])
                    gate('signed-metadata-tampering-rejected', proof='tampered.json')
                    artifact = public / 'artifact.txt'
                    original = artifact.read_bytes()
                    artifact.write_bytes(b'changed artifact bytes\n')
                    try:
                        gate('artifact-tampering-rejected')
                    finally:
                        artifact.write_bytes(original)
                    missing = public / 'artifact.offline'
                    artifact.rename(missing)
                    try:
                        gate('missing-artifact-rejected')
                    finally:
                        missing.rename(artifact)
            report['cli_gate_checks'] = cli_checks
            report['consumer_environments_removed'] = True
        report['status'] = 'PASS'
    except Exception as error:
        report['status'] = 'FAIL'
        report['error'] = str(error)
        raise
    finally:
        report['elapsed_seconds'] = round(time.perf_counter() - started, 4)
        report['timing_categories_seconds'] = {
            'build': round(sum(row['seconds'] for row in steps if row['label'] in (
                'npm-build', 'npm-pack', 'python-build-sdist-and-wheel',
            )), 4),
            'environment_setup': round(sum(row['seconds'] for row in steps if row['label'].endswith('-environment')), 4),
            'installation': round(sum(row['seconds'] for row in steps if '-install-exact-' in row['label']), 4),
            'reference_consumer_runs': round(sum(row['seconds'] for row in steps if row['label'].endswith('-create')
                                                or '-verify-' in row['label']), 4),
            'installed_cli_checks': round(sum(row['seconds'] for row in steps if '-gate-' in row['label']
                                             or '-default-integrity-only-' in row['label']
                                             or '-installed-cli-help' in row['label']), 4),
        }
        (output / 'acceptance.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            'status': report.get('status', 'FAIL'), 'report': str(output / 'acceptance.json'),
            'elapsed_seconds': report['elapsed_seconds'],
        }))


if __name__ == '__main__':
    main()

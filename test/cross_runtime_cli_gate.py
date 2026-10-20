"""Compare actual Node/Python CLI JSON and exits on the same shared receipt."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'test/python'))
from test_cli_gate import CASES, prepare_case  # noqa: E402 - source test helpers

env = {**os.environ, 'PYTHONPATH': str(ROOT / 'python')}
for row in CASES:
    with tempfile.TemporaryDirectory() as directory:
        flags = [*prepare_case(row, Path(directory)), '--json']
        outputs = []
        for command in ([os.environ.get('NODE', 'node'), str(ROOT / 'bin/proof-ledger.js')],
                        [sys.executable, '-m', 'nymrel_proof_ledger.cli']):
            run = subprocess.run([*command, *flags], cwd=directory, env=env,
                                 capture_output=True, text=True, timeout=30, check=False)
            assert run.returncode == row['exit'], (row['name'], command, run.stderr)
            result = json.loads(run.stdout)
            if row.get('disk') == 'missing':
                # The stable failure category and policy match; errno wording is
                # deliberately supplied by each runtime's native filesystem API.
                assert len(result['errors']) == 1, result
                prefix = "Artifact missing on disk: 'artifact.txt' ("
                assert result['errors'][0].startswith(prefix), result['errors']
                result['errors'] = [prefix[:-2]]
            outputs.append(result)
        assert outputs[0] == outputs[1], (row['name'], outputs)
print(json.dumps({'shared_cli_policy_cases': len(CASES), 'status': 'PASS'}))

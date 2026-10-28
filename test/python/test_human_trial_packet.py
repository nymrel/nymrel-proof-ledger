"""Trial preparation must preserve exact archives and public-configuration separation."""
import json
from pathlib import Path
import runpy
import shutil
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
TOOLS = runpy.run_path(str(ROOT / 'tools' / 'prepare_human_trials.py'))


class TestHumanTrialPacket(unittest.TestCase):
    def accepted_fixture(self, directory):
        artifacts = directory / 'artifacts'
        artifacts.mkdir()
        rows = []
        for filename in ('nymrel-proof-ledger-2.0.0.tgz', 'nymrel_proof_ledger-2.0.0.whl',
                         'nymrel_proof_ledger-2.0.0.tar.gz'):
            path = artifacts / filename
            path.write_bytes(b'accepted distribution bytes')
            rows.append({'filename': filename, 'bytes': path.stat().st_size, 'sha256': TOOLS['digest'](path)})
        (directory / 'acceptance.json').write_text(json.dumps({'status': 'PASS', 'artifacts': rows}))
        return rows

    def test_rejects_changed_archive_before_installation(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            rows = self.accepted_fixture(directory)
            (directory / 'artifacts' / rows[0]['filename']).write_bytes(b'changed distribution bytes')
            with self.assertRaisesRegex(AssertionError, 'Accepted archive changed'):
                TOOLS['accepted_archives'](directory)

    def test_refuses_failed_acceptance_and_unsafe_filenames(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            rows = self.accepted_fixture(directory)
            for report, message in (
                    ({'status': 'FAIL', 'artifacts': rows}, 'passing installed-consumer'),
                    ({'status': 'PASS', 'artifacts': [{**rows[0], 'filename': '../outside.tgz'}, *rows[1:]]},
                     'Unsafe archive filename'),
                    ({'status': 'PASS', 'artifacts': [rows[0], rows[0], rows[2]]}, 'Expected one npm archive')):
                with self.subTest(message=message):
                    (directory / 'acceptance.json').write_text(json.dumps(report))
                    with self.assertRaisesRegex(AssertionError, message):
                        TOOLS['accepted_archives'](directory)

    def test_refuses_archive_changed_during_packet_copy_before_install(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            acceptance = root / 'accepted'
            acceptance.mkdir()
            self.accepted_fixture(acceptance)
            original_copy = shutil.copyfile

            def changed_copy(source, destination):
                result = original_copy(source, destination)
                if Path(destination).name.endswith('.tgz'):
                    Path(destination).write_bytes(b'archive changed after initial validation')
                return result

            with patch.dict(TOOLS['HELPERS'], {'source_state': lambda: {}}), \
                    patch('shutil.copyfile', side_effect=changed_copy), patch('subprocess.run') as installation:
                with self.assertRaisesRegex(AssertionError, 'Archive changed during packet copy'):
                    TOOLS['prepare'](acceptance, root / 'packet')
                installation.assert_not_called()
            report = json.loads((root / 'packet' / 'packet.json').read_text())
            self.assertEqual(report['status'], 'FAIL')
            self.assertEqual(report['human_trials_completed'], 0)

    def fixture(self, directory, config=None, receipt=None):
        directory.mkdir()
        (directory / 'verifier-config.json').write_text(json.dumps(config or {
            'algorithm': 'Ed25519', 'publicKey': 'ab' * 32,
        }))
        (directory / 'proof.json').write_text(json.dumps(receipt or {'version': '2.0.0'}))
        (directory / 'artifact.txt').write_text('synthetic public artifact')

    def test_participant_fixture_excludes_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root / 'public')
            TOOLS['split_fixture'](root / 'public', root / 'participant' / 'fixture', root / 'coordinator')
            self.assertEqual({path.name for path in (root / 'participant' / 'fixture').iterdir()},
                             {'proof.json', 'artifact.txt'})
            self.assertEqual({path.name for path in (root / 'coordinator').iterdir()}, {'verifier-config.json'})
            self.assertEqual((root / 'participant' / 'fixture' / 'proof.json').read_bytes(),
                             (root / 'public' / 'proof.json').read_bytes())

    def test_refuses_signing_material_before_copying_public_fixture(self):
        for config, receipt in (
                ({'algorithm': 'HMAC-SHA256', 'publicKey': 'ab' * 32}, None),
                ({'algorithm': 'Ed25519', 'publicKey': 'ab' * 32, 'privateKey': 'cd' * 32}, None),
                (None, {'version': '2.0.0', 'metadata': {'signingKey': 'must not be copied'}})):
            with self.subTest(config=config, receipt=receipt), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                self.fixture(root / 'public', config, receipt)
                with self.assertRaises(AssertionError):
                    TOOLS['split_fixture'](root / 'public', root / 'participant', root / 'coordinator')
                self.assertFalse((root / 'participant').exists())


if __name__ == '__main__':
    unittest.main()

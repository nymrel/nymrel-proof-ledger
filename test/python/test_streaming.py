import hashlib
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'python'))
from nymrel_proof_ledger.receipt import create_receipt, hash_artifact, verify_receipt

AUTH = {'public_key_or_secret': 'streaming-fixture-secret', 'expected_algorithm': 'HMAC-SHA256'}
CHUNK_LIMIT = 1024 * 1024
LARGE_DATA = (bytes(range(251)) * ((5 * CHUNK_LIMIT + 17) // 251 + 1))[:5 * CHUNK_LIMIT + 17]
SAMPLES = (
    ('empty', b''),
    ('binary', bytes([0, 255, 128, 13, 10, 0, 1, 254])),
    ('Unicode', 'Proof \u2014 \u00e9 \u6f22\u5b57 \U0001f331\n'),
    ('multiple chunks and a partial tail', LARGE_DATA),
)


class TrackedFile:
    def __init__(self, file, reads, closes, fail_after_first_read=False):
        self.file = file
        self.reads = reads
        self.closes = closes
        self.fail_after_first_read = fail_after_first_read
        self.read_count = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closes.append(self.file.name)
        return self.file.__exit__(*args)

    def read(self, size=-1):
        if not isinstance(size, int) or not 0 < size <= CHUNK_LIMIT:
            raise AssertionError('Artifact reads must specify a finite bound of at most 1 MiB')
        self.reads.append(size)
        self.read_count += 1
        if self.fail_after_first_read and self.read_count == 2:
            raise OSError('Injected artifact read failure')
        return self.file.read(size)

    def readinto(self, buffer):
        if not 0 < len(buffer) <= CHUNK_LIMIT:
            raise AssertionError('Artifact read buffers must be bounded to at most 1 MiB')
        self.reads.append(len(buffer))
        self.read_count += 1
        if self.fail_after_first_read and self.read_count == 2:
            raise OSError('Injected artifact read failure')
        return self.file.readinto(buffer)


class TestStreaming(unittest.TestCase):
    def test_short_reads_continue_until_eof_in_creation_and_verification(self):
        content = bytes(range(251)) * 3
        with tempfile.TemporaryDirectory() as cwd:
            (Path(cwd) / 'artifact.bin').write_bytes(content)
            original_open = open
            reads, closes = [], []

            class ShortReadFile(TrackedFile):
                def readinto(self, buffer):
                    return super().readinto(memoryview(buffer)[:17])

            def short_read_open(*args, **kwargs):
                return ShortReadFile(original_open(*args, **kwargs), reads, closes)

            with patch('builtins.open', side_effect=short_read_open):
                receipt = create_receipt(
                    task={'name': 'Short artifact reads'}, signing_key=AUTH['public_key_or_secret'],
                    signer_identity='fixture', cwd=cwd, artifacts=[{'path': 'artifact.bin'}],
                )
                self.assertEqual(receipt['artifacts'][0]['sha256'], hashlib.sha256(content).hexdigest())
                self.assertEqual(receipt['artifacts'][0]['sizeBytes'], len(content))
                result = verify_receipt(receipt, **AUTH, check_files_on_disk=True, cwd=cwd)
                self.assertTrue(result['valid'], result['errors'])
                self.assertTrue(result['trusted'])
                self.assertEqual(result['checkedArtifacts'], 1)
                self.assertGreater(len(reads), 2)
                self.assertEqual(len(closes), 2)

    def test_file_hashes_match_in_memory_bytes(self):
        for name, data in SAMPLES:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as cwd:
                content = data.encode('utf-8') if isinstance(data, str) else data
                (Path(cwd) / 'artifact.bin').write_bytes(content)
                expected = {
                    'path': 'artifact.bin', 'sha256': hashlib.sha256(content).hexdigest(),
                    'sizeBytes': len(content),
                }
                self.assertEqual(hash_artifact('artifact.bin', cwd=cwd), expected)
                self.assertEqual(hash_artifact('artifact.bin', data=data, cwd=cwd), expected)

    def test_creation_and_trusted_disk_verification_use_bounded_reads(self):
        with tempfile.TemporaryDirectory() as cwd:
            (Path(cwd) / 'artifact.bin').write_bytes(LARGE_DATA)
            original_open = open
            reads, closes = [], []

            def tracked_open(*args, **kwargs):
                return TrackedFile(original_open(*args, **kwargs), reads, closes)

            with patch('builtins.open', side_effect=tracked_open):
                receipt = create_receipt(
                    task={'name': 'Stream large artifact'}, signing_key=AUTH['public_key_or_secret'],
                    signer_identity='fixture', cwd=cwd, artifacts=[{'path': 'artifact.bin'}],
                )
                self.assertEqual(receipt['artifacts'][0]['sha256'], hashlib.sha256(LARGE_DATA).hexdigest())
                self.assertEqual(receipt['artifacts'][0]['sizeBytes'], len(LARGE_DATA))
                creation_reads = len(reads)
                self.assertGreater(creation_reads, 1)
                self.assertEqual(len(closes), 1)
                result = verify_receipt(receipt, **AUTH, check_files_on_disk=True, cwd=cwd)
                self.assertTrue(result['valid'], result['errors'])
                self.assertTrue(result['trusted'])
                self.assertTrue(result['artifactsValid'])
                self.assertEqual(result['checkedArtifacts'], 1)
                self.assertGreater(len(reads) - creation_reads, 1)
                self.assertEqual(len(closes), 2)

    def test_missing_artifacts_fail_closed(self):
        with tempfile.TemporaryDirectory() as cwd:
            with self.assertRaises(FileNotFoundError):
                hash_artifact('missing.bin', cwd=cwd)
            receipt = create_receipt(
                task={'name': 'Missing artifact'}, signing_key=AUTH['public_key_or_secret'],
                signer_identity='fixture', cwd=cwd, artifacts=[{'path': 'missing.bin', 'data': 'expected'}],
            )
            result = verify_receipt(receipt, **AUTH, check_files_on_disk=True, cwd=cwd)
            self.assertTrue(result['signatureValid'])
            self.assertFalse(result['valid'])
            self.assertFalse(result['trusted'])
            self.assertFalse(result['artifactsValid'])
            self.assertEqual(result['checkedArtifacts'], 0)
            self.assertIn('Artifact missing on disk', '; '.join(result['errors']))

    def test_disk_verification_detects_a_changed_final_partial_chunk(self):
        with tempfile.TemporaryDirectory() as cwd:
            artifact_path = Path(cwd) / 'artifact.bin'
            artifact_path.write_bytes(LARGE_DATA)
            receipt = create_receipt(
                task={'name': 'Tail integrity'}, signing_key=AUTH['public_key_or_secret'],
                signer_identity='fixture', cwd=cwd, artifacts=[{'path': 'artifact.bin'}],
            )
            changed = bytearray(LARGE_DATA)
            changed[-1] ^= 255
            artifact_path.write_bytes(changed)
            result = verify_receipt(receipt, **AUTH, check_files_on_disk=True, cwd=cwd)
            self.assertTrue(result['signatureValid'])
            self.assertFalse(result['valid'])
            self.assertFalse(result['trusted'])
            self.assertFalse(result['artifactsValid'])
            self.assertEqual(result['checkedArtifacts'], 1)
            self.assertIn('hash mismatch', '; '.join(result['errors']))

    def test_read_failure_closes_handle_and_fails_closed(self):
        with tempfile.TemporaryDirectory() as cwd:
            (Path(cwd) / 'artifact.bin').write_bytes(LARGE_DATA)
            receipt = create_receipt(
                task={'name': 'Interrupted artifact read'}, signing_key=AUTH['public_key_or_secret'],
                signer_identity='fixture', cwd=cwd, artifacts=[{'path': 'artifact.bin', 'data': LARGE_DATA}],
            )
            original_open = open
            reads, closes, handles = [], [], []

            def tracked_open(*args, **kwargs):
                file = original_open(*args, **kwargs)
                handles.append(file)
                return TrackedFile(file, reads, closes, fail_after_first_read=True)

            with patch('builtins.open', side_effect=tracked_open):
                with self.assertRaisesRegex(OSError, 'Injected artifact read failure'):
                    hash_artifact('artifact.bin', cwd=cwd)
                self.assertEqual(len(closes), 1)
                self.assertTrue(handles[0].closed)
                result = verify_receipt(receipt, **AUTH, check_files_on_disk=True, cwd=cwd)
                self.assertTrue(result['signatureValid'])
                self.assertFalse(result['valid'])
                self.assertFalse(result['trusted'])
                self.assertFalse(result['artifactsValid'])
                self.assertEqual(result['checkedArtifacts'], 0)
                self.assertIn('Injected artifact read failure', '; '.join(result['errors']))
                self.assertEqual(len(closes), 2)
                self.assertTrue(handles[1].closed)

    def test_bad_signature_triggers_no_artifact_io(self):
        receipt = create_receipt(
            task={'name': 'Reject before disk'}, signing_key=AUTH['public_key_or_secret'],
            signer_identity='fixture', artifacts=[{'path': 'artifact.bin', 'data': LARGE_DATA}],
        )
        with patch('nymrel_proof_ledger.receipt.os.path.realpath', side_effect=AssertionError('Unexpected artifact resolution')) as resolve, patch('builtins.open', side_effect=AssertionError('Unexpected artifact read')) as read:
            result = verify_receipt(
                receipt, public_key_or_secret='wrong-key', expected_algorithm='HMAC-SHA256',
                check_files_on_disk=True,
            )
            self.assertFalse(result['signatureValid'])
            self.assertFalse(result['valid'])
            self.assertFalse(result['trusted'])
            self.assertFalse(result['artifactsValid'])
            self.assertEqual(result['checkedArtifacts'], 0)
            resolve.assert_not_called()
            read.assert_not_called()

    def test_traversal_and_escaping_symlinks_refuse_artifact_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            cwd = Path(directory) / 'root'
            outside = Path(directory) / 'outside'
            cwd.mkdir()
            outside.mkdir()
            (outside / 'artifact.bin').write_bytes(LARGE_DATA)
            alias = cwd / 'alias'
            if os.name == 'nt':
                subprocess.run(
                    [os.environ.get('ComSpec', r'C:\Windows\System32\cmd.exe'), '/c', 'mklink', '/J', str(alias), str(outside)],
                    check=True, capture_output=True,
                )
            else:
                alias.symlink_to(outside, target_is_directory=True)
            for artifact_path in ('../outside/artifact.bin', 'alias/artifact.bin'):
                with self.subTest(path=artifact_path):
                    receipt = create_receipt(
                        task={'name': 'Filesystem fence'}, signing_key=AUTH['public_key_or_secret'],
                        signer_identity='fixture', cwd=str(cwd),
                        artifacts=[{'path': artifact_path, 'data': LARGE_DATA}],
                    )
                    with patch('builtins.open', side_effect=AssertionError('Unexpected artifact read')) as read:
                        result = verify_receipt(receipt, **AUTH, check_files_on_disk=True, cwd=str(cwd))
                        self.assertTrue(result['signatureValid'])
                        self.assertFalse(result['valid'])
                        self.assertFalse(result['trusted'])
                        self.assertFalse(result['artifactsValid'])
                        self.assertEqual(result['checkedArtifacts'], 0)
                        self.assertIn('escapes verification root', '; '.join(result['errors']))
                        read.assert_not_called()

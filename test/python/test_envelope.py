import unittest
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python")))

from nymrel_proof_ledger import (
    EnvelopeErrorCode,
    validate_receipt_envelope,
)
from nymrel_proof_ledger.receipt import create_receipt


HASH_A = "a" * 64
HASH_B = "b" * 64
HASH_C = "c" * 64
HASH_D = "d" * 64
HASH_E = "e" * 64
SIG_HEX = "f" * 128


def build_valid_envelope():
    """Portable valid envelope vector, mirrored in test/ts/envelope.test.ts."""
    return {
        "version": "1.0.0",
        "protocol": "nymrel-proof-ledger",
        "proofId": "prf_interop_vector_0001",
        "timestamp": "2026-08-21T12:00:00.000Z",
        "parentOrganization": "Nymrel -> JalenBuilds LLC",
        "task": {
            "name": "interop-envelope-vector",
            "runner": "test-runner",
            "status": "SUCCESS",
            "exitCode": 0,
        },
        "environment": {"platform": "test", "arch": "test", "runtime": "vector"},
        "artifacts": [
            {
                "path": "artifacts/proof.txt",
                "sha256": HASH_A,
                "sizeBytes": 11,
                "mimeType": "text/plain",
            }
        ],
        "merkle": {
            "algorithm": "SHA-256",
            "leaves": [HASH_B, HASH_C, HASH_D],
            "root": HASH_E,
        },
        "signature": {
            "algorithm": "HMAC-SHA256",
            "keyId": "hmac-default",
            "signerIdentity": "interop-tester",
            "value": SIG_HEX,
            "timestamp": "2026-08-21T12:00:00.000Z",
        },
        "metadata": {},
    }


def codes_of(result):
    return [error["code"] for error in result["errors"]]


class TestReceiptEnvelopeInterop(unittest.TestCase):
    def test_accepts_portable_valid_envelope_vector(self):
        result = validate_receipt_envelope(build_valid_envelope())
        self.assertEqual(result, {"valid": True, "errors": []})

    def test_accepts_receipt_produced_by_create_receipt_unchanged(self):
        receipt = create_receipt(
            task={"name": "Interop Acceptance", "runner": "test-runner"},
            signing_key="interop-test-secret",
            signer_identity="interop-tester",
            artifacts=[{"path": "interop.txt", "data": "portable payload"}],
            algorithm="HMAC-SHA256",
        )
        result = validate_receipt_envelope(receipt)
        self.assertTrue(result["valid"])
        self.assertEqual(result["errors"], [])

    def test_accepts_envelope_round_tripped_through_json(self):
        serialized = json.loads(json.dumps(build_valid_envelope()))
        result = validate_receipt_envelope(serialized)
        self.assertTrue(result["valid"])

    def test_rejects_non_object_envelope(self):
        for bad_input in (None, "receipt", 42, [], True):
            with self.subTest(input=bad_input):
                result = validate_receipt_envelope(bad_input)
                self.assertFalse(result["valid"])
                self.assertEqual(codes_of(result), [EnvelopeErrorCode.ENVELOPE_NOT_OBJECT])
                self.assertIsNone(result["errors"][0]["path"])

    def test_rejects_unsupported_protocol_identifier(self):
        envelope = build_valid_envelope()
        envelope["protocol"] = "acme-ledger"
        result = validate_receipt_envelope(envelope)
        self.assertFalse(result["valid"])
        self.assertEqual(codes_of(result), [EnvelopeErrorCode.PROTOCOL_UNSUPPORTED])
        self.assertEqual(result["errors"][0]["path"], "protocol")

    def test_renders_unicode_protocol_values_without_ascii_escapes(self):
        envelope = build_valid_envelope()
        envelope["protocol"] = "é"
        result = validate_receipt_envelope(envelope)
        self.assertEqual(
            result["errors"][0]["message"],
            "Unsupported protocol identifier: expected "
            "'nymrel-proof-ledger', got \"é\".",
        )

    def test_rejects_missing_protocol_identifier(self):
        envelope = build_valid_envelope()
        del envelope["protocol"]
        result = validate_receipt_envelope(envelope)
        self.assertEqual(codes_of(result), [EnvelopeErrorCode.PROTOCOL_MISSING])

    def test_rejects_unsupported_version(self):
        envelope = build_valid_envelope()
        envelope["version"] = "2.0.0"
        result = validate_receipt_envelope(envelope)
        self.assertEqual(codes_of(result), [EnvelopeErrorCode.VERSION_UNSUPPORTED])
        self.assertEqual(result["errors"][0]["path"], "version")

    def test_rejects_missing_proof_id(self):
        envelope = build_valid_envelope()
        del envelope["proofId"]
        result = validate_receipt_envelope(envelope)
        self.assertEqual(codes_of(result), [EnvelopeErrorCode.FIELD_MISSING])
        self.assertEqual(result["errors"][0]["path"], "proofId")

    def test_rejects_malformed_timestamp_shape(self):
        envelope = build_valid_envelope()
        envelope["timestamp"] = "2026-08-21 12:00:00"
        result = validate_receipt_envelope(envelope)
        self.assertEqual(codes_of(result), [EnvelopeErrorCode.TIMESTAMP_MALFORMED])
        self.assertEqual(result["errors"][0]["path"], "timestamp")

    def test_rejects_tampered_merkle_root_not_hex_digest(self):
        envelope = build_valid_envelope()
        envelope["merkle"]["root"] = "not-a-hash"
        result = validate_receipt_envelope(envelope)
        self.assertEqual(codes_of(result), [EnvelopeErrorCode.HASH_MALFORMED])
        self.assertEqual(result["errors"][0]["path"], "merkle.root")

    def test_rejects_tampered_artifact_digest(self):
        envelope = build_valid_envelope()
        envelope["artifacts"][0]["sha256"] = "zzzz"
        result = validate_receipt_envelope(envelope)
        self.assertEqual(codes_of(result), [EnvelopeErrorCode.HASH_MALFORMED])
        self.assertEqual(result["errors"][0]["path"], "artifacts[0].sha256")

    def test_rejects_artifacts_that_are_not_an_array(self):
        envelope = build_valid_envelope()
        envelope["artifacts"] = {}
        result = validate_receipt_envelope(envelope)
        self.assertEqual(codes_of(result), [EnvelopeErrorCode.FIELD_TYPE_INVALID])
        self.assertEqual(result["errors"][0]["path"], "artifacts")

    def test_rejects_empty_task_name(self):
        envelope = build_valid_envelope()
        envelope["task"]["name"] = ""
        result = validate_receipt_envelope(envelope)
        self.assertEqual(codes_of(result), [EnvelopeErrorCode.FIELD_TYPE_INVALID])
        self.assertEqual(result["errors"][0]["path"], "task.name")

    def test_rejects_non_object_metadata(self):
        envelope = build_valid_envelope()
        envelope["metadata"] = []
        result = validate_receipt_envelope(envelope)
        self.assertEqual(codes_of(result), [EnvelopeErrorCode.FIELD_TYPE_INVALID])
        self.assertEqual(result["errors"][0]["path"], "metadata")

    def test_reports_multiple_errors_in_stable_field_order(self):
        envelope = build_valid_envelope()
        del envelope["version"]
        envelope["timestamp"] = "yesterday"
        envelope["merkle"]["root"] = "deadbeef"

        result = validate_receipt_envelope(envelope)
        self.assertFalse(result["valid"])
        self.assertEqual(
            [{"code": error["code"], "path": error["path"]} for error in result["errors"]],
            [
                {"code": EnvelopeErrorCode.VERSION_MISSING, "path": "version"},
                {"code": EnvelopeErrorCode.TIMESTAMP_MALFORMED, "path": "timestamp"},
                {"code": EnvelopeErrorCode.HASH_MALFORMED, "path": "merkle.root"},
            ],
        )


if __name__ == "__main__":
    unittest.main()

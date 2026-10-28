import copy
import json
import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))
from nymrel_proof_ledger.checkpoint import verify_checkpoint
from nymrel_proof_ledger.canonical import canonical_hash
from nymrel_proof_ledger.receipt import verify_receipt

F = json.loads((Path(__file__).resolve().parents[1] / 'fixtures/checkpoint-v0.1-vectors.json').read_text())
EXTRA = json.loads((Path(__file__).resolve().parents[1] / 'fixtures/checkpoint-core-v0.1-vectors.json').read_text())

class CheckpointCoreTests(unittest.TestCase):
    def run_case(self, name='active', change=None, observation=None, bundle_text=None, pin=None):
        c = copy.deepcopy(F['checkpoint'])
        b = {'checkpoint': c, 'receipt': copy.deepcopy(F['receipt'])}
        t = next(x for x in F['trustBundles'] if x['name'] == name)
        if change:
            change(b)
        calls = []
        source = {k: c[k] for k in ('sourceProtocol', 'sourceVersion', 'sourceId', 'sourceEpochDigest')}
        def adapter(checkpoint):
            calls.append(checkpoint)
            return observation if observation is not None else {'status': 'VALID', **source, 'eventCount': c['eventCount'], 'prefixHash': c['chainHeadOrStateHash']}
        result = verify_checkpoint(bundle_text or json.dumps(b), json.dumps(t['bundle']),
            bundle_pin={'bundleId': t['bundle']['bundleId'], 'revision': t['bundle']['revision'], 'sha256': t['digest']},
            checkpoint_pin=pin or F['checkpointDigest'], source=source, adapter=adapter)
        return result, calls

    def test_lifecycle_and_pins_fail_before_adapter(self):
        for name, expected in [('superseded-admitted','HISTORICAL_SUPERSEDED_ALLOWED'), ('superseded-unadmitted','SUPERSEDED_NOT_ADMITTED'), ('revoked-retroactive','REVOKED_KEY'), ('unknown-key','UNKNOWN_KEY')]:
            result, calls = self.run_case(name)
            self.assertEqual(result['keyPolicy'], expected)
            self.assertEqual(bool(calls), name == 'superseded-admitted')
        result, calls = self.run_case(pin='sha256:' + '0'*64)
        self.assertEqual(result['admission'], 'CHECKPOINT_PIN_MISMATCH')
        self.assertFalse(calls)
        result, calls = self.run_case(bundle_text='{"checkpoint":{},"checkpoint":{},"receipt":{}}')
        self.assertEqual(result['admission'], 'MALFORMED_PROFILE')
        self.assertFalse(calls)

    def test_hostile_json_stops_before_source(self):
        for text in ('{"checkpoint":{},"check\\u0070oint":{},"receipt":{}}',
                     '[' * 33 + '0' + ']' * 33, ' ' * (2 * 1024 * 1024 + 1)):
            result, calls = self.run_case(bundle_text=text)
            self.assertEqual(result['admission'], 'MALFORMED_PROFILE')
            self.assertFalse(calls)

    def test_shared_admission_and_source_vectors(self):
        for case in F['proposedAdmissionCases']:
            if case['name'] in ('boolean-count', 'count-sequence-mismatch', 'negative-count', 'unsupported-checkpoint-version', 'old-signed-checkpoint-substitution'):
                result, calls = self.run_case(change=lambda b: b['checkpoint'].update(case['change']))
                self.assertEqual(result['admission'], case['expected'], case['name'])
                self.assertFalse(calls)
        for case in F['proposedSourceCases']:
            obs = case.get('observation')
            if obs is None:
                continue
            obs = dict(obs)
            obs['status'] = 'VALID'
            obs['eventCount'] = obs.pop('validEventCount')
            obs['prefixHash'] = obs.pop('checkpointPrefixHash')
            result, _ = self.run_case(observation=obs)
            self.assertEqual(result['sourceComparison'], case['expectedSourceComparison'], case['name'])

    def test_detached_binding_and_new_content_under_superseded_key(self):
        changed = {**F['checkpoint'], 'checkpointId': 'new-checkpoint'}
        pin = 'sha256:' + canonical_hash(changed)
        def mutate(bundle):
            bundle['checkpoint'] = changed
        result, calls = self.run_case(change=mutate, pin=pin)
        self.assertEqual(result['binding'], 'CHECKPOINT_BINDING_MISMATCH')
        self.assertFalse(calls)
        result, calls = self.run_case('superseded-admitted', change=mutate, pin=pin)
        self.assertEqual(result['keyPolicy'], 'SUPERSEDED_NOT_ADMITTED')
        self.assertFalse(calls)

    def test_signed_empty_and_superseded_new_content(self):
        for case in EXTRA['cases']:
            c = case['checkpoint']
            self.assertTrue(verify_receipt(case['receipt'], F['publicKey'], expected_algorithm='Ed25519')['trusted'])
            source = {k: c[k] for k in ('sourceProtocol', 'sourceVersion', 'sourceId', 'sourceEpochDigest')}
            def mutate(bundle):
                bundle.update({'checkpoint': c, 'receipt': case['receipt']})
            obs = {'status': 'VALID', **source, 'eventCount': c['eventCount'], 'prefixHash': c['chainHeadOrStateHash']}
            if case['name'] == 'empty':
                result, _ = self.run_case(change=mutate, observation=obs, pin=case['checkpointDigest'])
                self.assertTrue(result['accepted'])
                self.assertEqual(result['sourceComparison'], 'CHECKPOINT_MATCH')
            else:
                result, calls = self.run_case('superseded-admitted', change=mutate, pin=case['checkpointDigest'])
                self.assertEqual(result['keyPolicy'], 'SUPERSEDED_NOT_ADMITTED')
                self.assertFalse(calls)

    def test_adapter_cannot_change_expected_source(self):
        c = F['checkpoint']
        t = next(x for x in F['trustBundles'] if x['name'] == 'active')
        source = {k: c[k] for k in ('sourceProtocol', 'sourceVersion', 'sourceId', 'sourceEpochDigest')}
        def adapter(checkpoint):
            source['sourceId'] = 'different-source'
            checkpoint['sourceId'] = 'different-source'
            return {'status': 'VALID', **source, 'eventCount': c['eventCount'], 'prefixHash': c['chainHeadOrStateHash']}
        result = verify_checkpoint(json.dumps({'checkpoint': c, 'receipt': F['receipt']}), json.dumps(t['bundle']),
            bundle_pin={'bundleId': t['bundle']['bundleId'], 'revision': t['bundle']['revision'], 'sha256': t['digest']},
            checkpoint_pin=F['checkpointDigest'], source=source, adapter=adapter)
        self.assertFalse(result['accepted'])
        self.assertEqual(result['sourceComparison'], 'SOURCE_IDENTITY_MISMATCH')

    def test_authentication_binding_and_source(self):
        result, calls = self.run_case()
        self.assertTrue(result['accepted'])
        self.assertEqual(len(calls), 1)
        result, calls = self.run_case(change=lambda b: b['receipt']['metadata'].update({'x': 1}))
        self.assertEqual(result['admission'], 'RECEIPT_PROFILE_MISMATCH')
        self.assertFalse(calls)
        result, calls = self.run_case(change=lambda b: b['receipt']['artifacts'][0].update({'sha256': '0'*64}))
        self.assertEqual(result['authentication'], 'RECEIPT_INTEGRITY_FAILURE')
        self.assertFalse(calls)
        c = F['checkpoint']
        source = {k: c[k] for k in ('sourceProtocol', 'sourceVersion', 'sourceId', 'sourceEpochDigest')}
        for obs, expected in [({'status':'UNAVAILABLE'}, 'SOURCE_UNAVAILABLE'),
          ({'status':'VALID', **source, 'eventCount':2}, 'TRUNCATED_RELATIVE_TO_CHECKPOINT'),
          ({'status':'VALID', **source, 'eventCount':3, 'prefixHash':'sha256:'+'0'*64}, 'STATE_MISMATCH'),
          ({'status':'VALID', **source, 'eventCount':4, 'prefixHash':c['chainHeadOrStateHash']}, 'CHECKPOINT_PREFIX_MATCH')]:
            result, _ = self.run_case(observation=obs)
            self.assertEqual(result['sourceComparison'], expected)
            self.assertEqual(result['accepted'], expected == 'CHECKPOINT_PREFIX_MATCH')

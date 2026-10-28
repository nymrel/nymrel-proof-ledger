"""Experimental offline checkpoint verification. No source adapter or pin store is provided."""
import json
import math
import re
from .canonical import canonical_hash, canonicalize
from .receipt import verify_receipt

_ID = re.compile(r'^[A-Za-z0-9._:@/-]{1,128}$')
_DIGEST = re.compile(r'^sha256:[0-9a-f]{64}$')
_HEX = re.compile(r'^[0-9a-f]{64}$')
_MAX = 9007199254740991


def _parse(text):
    if not isinstance(text, str) or len(text.encode('utf-8')) > 2 * 1024 * 1024:
        raise ValueError('invalid size')
    def pairs(items):
        obj = {}
        for k, v in items:
            if k in obj:
                raise ValueError('duplicate property')
            obj[k] = v
        return obj
    value = json.loads(text, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    def visit(x, depth):
        if depth > 32:
            raise ValueError('depth')
        if isinstance(x, dict):
            for k, v in x.items():
                k.encode('utf-8')
                visit(v, depth + 1)
        elif isinstance(x, list):
            for v in x:
                visit(v, depth + 1)
        elif isinstance(x, str):
            x.encode('utf-8')
        elif type(x) in (int, float) and (not math.isfinite(x) or (x.is_integer() if isinstance(x, float) else True) and abs(x) > _MAX):
            raise ValueError('integer')
    visit(value, 1)
    canonicalize(value)
    return value


def _exact(obj, fields):
    return type(obj) is dict and set(obj) == set(fields.split())


def _identifier(v):
    return type(v) is str and _ID.fullmatch(v) is not None


def _digest(v):
    return type(v) is str and _DIGEST.fullmatch(v) is not None


def _integer(v, low=0):
    return type(v) in (int, float) and math.isfinite(v) and v == int(v) and low <= v <= _MAX


def _checkpoint(c):
    return (_exact(c, 'schema version sourceProtocol sourceVersion sourceId highestSequence eventCount chainHeadOrStateHash sourceEpochDigest checkpointId signerIdentity keyId')
            and c['schema'] == 'nymrel.checkpoint' and c['version'] == '0.1.0'
            and all(_identifier(c[k]) for k in ('sourceProtocol', 'sourceVersion', 'sourceId', 'checkpointId', 'signerIdentity', 'keyId'))
            and _integer(c['eventCount']) and c['highestSequence'] == (c['eventCount'] - 1 if c['eventCount'] else None)
            and (c['highestSequence'] is None or _integer(c['highestSequence']))
            and _digest(c['chainHeadOrStateHash']) and _digest(c['sourceEpochDigest']))


def _trust(t):
    if not (_exact(t, 'schema version bundleId revision keys') and t['schema'] == 'nymrel.checkpoint-trust-bundle'
            and t['version'] == '0.1.0' and _identifier(t['bundleId']) and _integer(t['revision'], 1)
            and isinstance(t['keys'], list) and 1 <= len(t['keys']) <= 256):
        return False
    ids, public_keys = set(), set()
    for k in t['keys']:
        if not (_exact(k, 'signerIdentity keyId algorithm publicKey state historicalCheckpointDigests')
                and _identifier(k['signerIdentity']) and _identifier(k['keyId']) and k['algorithm'] == 'Ed25519'
                and isinstance(k['publicKey'], str) and _HEX.fullmatch(k['publicKey'])
                and k['state'] in ('ACTIVE', 'SUPERSEDED', 'REVOKED')
                and isinstance(k['historicalCheckpointDigests'], list) and len(k['historicalCheckpointDigests']) <= 1024
                and all(_digest(d) for d in k['historicalCheckpointDigests'])
                and len(set(k['historicalCheckpointDigests'])) == len(k['historicalCheckpointDigests'])
                and (k['state'] == 'SUPERSEDED' or not k['historicalCheckpointDigests'])):
            return False
        pair = (k['signerIdentity'], k['keyId'])
        if pair in ids or k['publicKey'] in public_keys:
            return False
        ids.add(pair)
        public_keys.add(k['publicKey'])
    return True


def verify_checkpoint(bundle_json, trust_json, *, bundle_pin, checkpoint_pin, source, adapter):
    """Verify text and invoke adapter only after authentication. Pins and adapter are trusted caller inputs.

    Adapter(checkpoint) returns {status: VALID|INVALID|UNAVAILABLE, sourceProtocol,
    sourceVersion, sourceId, sourceEpochDigest, eventCount, prefixHash}; prefixHash
    is recomputed at the requested checkpoint count. This core cannot validate adapter honesty.
    """
    result = {'accepted': False, 'admission': 'NOT_CHECKED', 'keyPolicy': 'NOT_CHECKED',
              'authentication': 'NOT_CHECKED', 'binding': 'NOT_CHECKED', 'sourceComparison': 'NOT_CHECKED'}
    def fail(stage, code):
        result[stage] = code
        return result
    try:
        # Snapshot trusted caller configuration before invoking external code.
        if type(bundle_pin) is not dict or type(source) is not dict:
            return fail('admission', 'MALFORMED_PROFILE')
        bundle_pin, source = dict(bundle_pin), dict(source)
        b, t = _parse(bundle_json), _parse(trust_json)
        if (isinstance(b, dict) and isinstance(b.get('checkpoint'), dict) and b['checkpoint'].get('schema') == 'nymrel.checkpoint' and b['checkpoint'].get('version') != '0.1.0') or (isinstance(t, dict) and t.get('schema') == 'nymrel.checkpoint-trust-bundle' and t.get('version') != '0.1.0'):
            return fail('admission', 'UNSUPPORTED_VERSION')
        if not (_exact(b, 'checkpoint receipt') and _checkpoint(b['checkpoint']) and _trust(t)):
            return fail('admission', 'MALFORMED_PROFILE')
        c, r = b['checkpoint'], b['receipt']
        if not (_exact(bundle_pin, 'bundleId revision sha256') and _identifier(bundle_pin['bundleId'])
                and _integer(bundle_pin['revision'], 1) and _digest(bundle_pin['sha256']) and _digest(checkpoint_pin)
                and _exact(source, 'sourceProtocol sourceVersion sourceId sourceEpochDigest')
                and all(_identifier(source[k]) for k in ('sourceProtocol', 'sourceVersion', 'sourceId'))
                and _digest(source['sourceEpochDigest']) and callable(adapter)):
            return fail('admission', 'MALFORMED_PROFILE')
        if (t['bundleId'], t['revision'], 'sha256:' + canonical_hash(t)) != (bundle_pin['bundleId'], bundle_pin['revision'], bundle_pin['sha256']):
            return fail('admission', 'TRUST_BUNDLE_PIN_MISMATCH')
        if 'sha256:' + canonical_hash(c) != checkpoint_pin:
            return fail('admission', 'CHECKPOINT_PIN_MISMATCH')
        if not isinstance(r, dict) or r.get('version') != '2.0.0':
            return fail('admission', 'MALFORMED_PROFILE')
        task, sig = r.get('task'), r.get('signature')
        if not isinstance(task, dict) or task.get('name') != 'Retain external checkpoint' or task.get('status') != 'ATTESTED' or not _integer(task.get('exitCode')) or task['exitCode'] != 0 or r.get('metadata') != {}:
            return fail('admission', 'RECEIPT_PROFILE_MISMATCH')
        if not isinstance(sig, dict) or sig.get('algorithm') != 'Ed25519' or sig.get('signerIdentity') != c['signerIdentity'] or sig.get('keyId') != c['keyId']:
            return fail('admission', 'MALFORMED_PROFILE')
        result['admission'] = 'PASS'
        key = next((k for k in t['keys'] if (k['signerIdentity'], k['keyId']) == (c['signerIdentity'], c['keyId'])), None)
        if key is None:
            return fail('keyPolicy', 'UNKNOWN_KEY')
        if key['state'] == 'REVOKED':
            return fail('keyPolicy', 'REVOKED_KEY')
        if key['state'] == 'SUPERSEDED' and checkpoint_pin not in key['historicalCheckpointDigests']:
            return fail('keyPolicy', 'SUPERSEDED_NOT_ADMITTED')
        result['keyPolicy'] = 'ACTIVE' if key['state'] == 'ACTIVE' else 'HISTORICAL_SUPERSEDED_ALLOWED'
        verified = verify_receipt(r, key['publicKey'], expected_algorithm='Ed25519')
        if verified['signatureValid'] is False:
            return fail('authentication', 'INVALID_SIGNATURE')
        if not (verified['valid'] and verified['trusted'] and verified['signatureChecked'] and verified['signatureValid']):
            return fail('authentication', 'RECEIPT_INTEGRITY_FAILURE')
        result['authentication'] = 'PASS'
        expected = {'path': 'checkpoint.json', 'sha256': checkpoint_pin[7:], 'sizeBytes': len(canonicalize(c).encode('utf-8')), 'mimeType': 'application/json'}
        if r['artifacts'] != [expected]:
            return fail('binding', 'CHECKPOINT_BINDING_MISMATCH')
        result['binding'] = 'PASS'
        if any(c[k] != source[k] for k in ('sourceProtocol', 'sourceVersion', 'sourceId')):
            return fail('sourceComparison', 'SOURCE_IDENTITY_MISMATCH')
        if c['sourceEpochDigest'] != source['sourceEpochDigest']:
            return fail('sourceComparison', 'SOURCE_EPOCH_MISMATCH')
        try:
            obs = adapter(dict(c))
        except Exception:
            return fail('sourceComparison', 'SOURCE_UNAVAILABLE')
        if not isinstance(obs, dict) or obs.get('status') == 'UNAVAILABLE':
            return fail('sourceComparison', 'SOURCE_UNAVAILABLE')
        if obs.get('status') != 'VALID' or not _integer(obs.get('eventCount')):
            return fail('sourceComparison', 'SOURCE_INVALID')
        if any(obs.get(k) != source[k] for k in ('sourceProtocol', 'sourceVersion', 'sourceId')):
            return fail('sourceComparison', 'SOURCE_IDENTITY_MISMATCH')
        if obs.get('sourceEpochDigest') != source['sourceEpochDigest']:
            return fail('sourceComparison', 'SOURCE_EPOCH_MISMATCH')
        if obs['eventCount'] < c['eventCount']:
            return fail('sourceComparison', 'TRUNCATED_RELATIVE_TO_CHECKPOINT')
        if not _digest(obs.get('prefixHash')):
            return fail('sourceComparison', 'SOURCE_UNAVAILABLE')
        if obs['prefixHash'] != c['chainHeadOrStateHash']:
            return fail('sourceComparison', 'STATE_MISMATCH')
        result['suffixCount'] = obs['eventCount'] - c['eventCount']
        result['sourceComparison'] = 'CHECKPOINT_PREFIX_MATCH' if result['suffixCount'] else 'CHECKPOINT_MATCH'
        result['accepted'] = True
        return result
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError, UnicodeError):
        return fail('admission', 'MALFORMED_PROFILE')

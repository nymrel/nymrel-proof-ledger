"""One fresh-process artifact operation; orchestrated by artifact-benchmark.py."""
from __future__ import annotations

import gc
import json
import resource
import sys
import time
from importlib import import_module

module_root, operation, data_root, manifest_path = sys.argv[1:]
sys.path.insert(0, module_root)
receipt_module = import_module("nymrel_proof_ledger.receipt")
create_receipt = receipt_module.create_receipt
verify_receipt = receipt_module.verify_receipt

with open(manifest_path, encoding="utf-8") as file:
    manifest = json.load(file)
receipt = None
if operation == "verify":
    with open(manifest["receiptPath"], encoding="utf-8") as file:
        receipt = json.load(file)
secret = "11" * 32  # Public synthetic benchmark fixture, never a production key.
gc.collect()
# Linux /proc reports current resident memory independently of the high water mark.
with open("/proc/self/status", encoding="utf-8") as file:
    idle_rss_bytes = next(int(line.split()[1]) * 1024 for line in file if line.startswith("VmRSS:"))
start = time.perf_counter()
if operation == "create":
    output = create_receipt(
        task={"name": "Artifact benchmark"}, signing_key=secret,
        signer_identity="synthetic-benchmark", cwd=data_root,
        artifacts=[{"path": path} for path in manifest["paths"]],
    )
elif operation == "verify":
    output = verify_receipt(
        receipt, public_key_or_secret=secret, expected_algorithm="HMAC-SHA256",
        check_files_on_disk=True, cwd=data_root,
    )
    if not output["trusted"] or output["checkedArtifacts"] != len(manifest["paths"]):
        raise RuntimeError(output["errors"])
else:
    raise ValueError("Expected create or verify")
elapsed_seconds = time.perf_counter() - start
peak_rss_bytes = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
print(json.dumps({
    "elapsedSeconds": elapsed_seconds, "idleRssBytes": idle_rss_bytes,
    "peakRssBytes": peak_rss_bytes,
    "peakIncrementBytes": max(0, peak_rss_bytes - idle_rss_bytes),
    **({"receipt": output} if operation == "create" else {}),
}))

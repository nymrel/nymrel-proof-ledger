#!/usr/bin/env python3
"""Reproduce same-host five-run, warm-cache receipt creation and disk verification.

Linux only: workers measure peak RSS with getrusage and idle RSS before the
operation. Run baseline and candidate using saved module directories. Raw files
include runtime, host, cache procedure, individual runs, and medians.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import statistics
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--node-module", type=Path, required=True)
parser.add_argument("--python-root", type=Path, required=True)
parser.add_argument("--baseline-node-module", type=Path)
parser.add_argument("--baseline-python-root", type=Path)
parser.add_argument("--python", default=sys.executable)
parser.add_argument("--node", default="node")
parser.add_argument("--work-dir", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--runs", type=int, default=5)
parser.add_argument("--case", action="append", choices=("1MiB", "100MiB", "1024MiB", "1-files", "100-files", "1000-files"))
parser.add_argument("--runtime", action="append", choices=("node", "python"))
args = parser.parse_args()
if sys.platform != "linux":
    parser.error("RSS units and /proc idle measurement currently require Linux")
if args.runs < 1:
    parser.error("--runs must be positive")
if bool(args.baseline_node_module) != bool(args.baseline_python_root):
    parser.error("Supply both baseline module locations together")
script_root = Path(__file__).resolve().parent
args.work_dir.mkdir(parents=True, exist_ok=True)
# Non-sparse, deterministic bytes; data generation is excluded from timed runs.
block = bytes(range(256)) * 4096
cases = []
for mib in (1, 100, 1024):
    artifact = args.work_dir / f"artifact-{mib}MiB.bin"
    if not artifact.exists() or artifact.stat().st_size != mib * 1024 * 1024:
        with artifact.open("wb") as file:
            for _ in range(mib):
                file.write(block)
    cases.append((f"{mib}MiB", [artifact.name], mib * 1024 * 1024))
small_root = args.work_dir / "small"
small_root.mkdir(exist_ok=True)
for index in range(1000):
    artifact = small_root / f"{index:04d}.bin"
    if not artifact.exists():
        artifact.write_bytes(block[:4096])
for count in (1, 100, 1000):
    cases.append((f"{count}-files", [f"small/{index:04d}.bin" for index in range(count)], count * 4096))


def version(command):
    return subprocess.check_output(command, text=True).strip()


def warm(paths):
    # Warm all bytes immediately before each worker, without dropping host caches.
    for name in paths:
        with (args.work_dir / name).open("rb") as file:
            while file.read(1024 * 1024):
                pass


def code_info(node_module, python_root):
    return {"nodeModule": str(node_module.resolve()), "pythonRoot": str(python_root.resolve()),
            "nodeModuleSha256": hashlib.sha256(node_module.read_bytes()).hexdigest(),
            "pythonModuleSha256": hashlib.sha256((python_root / "nymrel_proof_ledger/receipt.py").read_bytes()).hexdigest()}


variants = [("candidate", args.node_module, args.python_root)]
if args.baseline_node_module:
    variants.insert(0, ("baseline", args.baseline_node_module, args.baseline_python_root))
report = {
    "schemaVersion": 1, "measuredAt": datetime.now(UTC).isoformat(),
    "sourceRevision": version(["git", "rev-parse", "HEAD"]),
    "host": {"platform": platform.platform(), "machine": platform.machine(),
             "cpuCount": os.cpu_count(), "cpuModel": next((line.partition(":")[2].strip() for line in Path("/proc/cpuinfo").read_text().splitlines() if line.startswith("model name")), "unknown"),
             "memoryTotal": next(line for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith("MemTotal:"))},
    "runtimes": {"node": version([args.node, "--version"]), "python": version([args.python, "--version"])},
    "code": {name: code_info(node_module, python_root) for name, node_module, python_root in variants},
    "cacheConditions": "Warm page cache: sequentially read all artifact bytes immediately before every fresh-process worker; no cache drop. Generation and warming excluded from timings. Host may have concurrent activity.",
    "measurement": "Fresh process per run and operation. Timed createReceipt/create_receipt or trusted verifyReceipt/verify_receipt with disk checks; import, fixture loading and GC excluded. Peak incremental RSS=max(0, process lifetime peak RSS minus current RSS after imports, receipt fixture loading and GC). Linux getrusage maxRSS; current RSS from Node memoryUsage or Python /proc. Manifests contain deterministic 4 KiB files.",
    "runsPerCase": args.runs,
    "variantOrder": "Alternate baseline then candidate within each repetition" if len(variants) > 1 else "Single variant",
    "results": [],
}
for case_name, paths, byte_count in cases:
    if args.case and case_name not in args.case:
        continue
    manifest_path = args.work_dir / "manifest.json"
    receipt_path = args.work_dir / "receipt.json"
    manifest_path.write_text(json.dumps({"paths": paths, "receiptPath": str(receipt_path.resolve())}))
    for runtime in args.runtime or ("node", "python"):
        for operation in ("create", "verify"):
            all_runs = {name: [] for name, _, _ in variants}
            for index in range(args.runs):
                for name, node_module, python_root in variants:
                    prefix = ([args.node, "--expose-gc", str(script_root / "artifact-worker.mjs"), str(node_module.resolve())] if runtime == "node" else [args.python, str(script_root / "artifact-worker.py"), str(python_root.resolve())])
                    warm(paths)
                    result = json.loads(subprocess.check_output(prefix + [operation, str(args.work_dir.resolve()), str(manifest_path.resolve())], text=True))
                    receipt = result.pop("receipt", None)
                    if receipt is not None:
                        receipt_path.write_text(json.dumps(receipt))
                    result["throughputMiBPerSecond"] = byte_count / (1024 * 1024) / result["elapsedSeconds"]
                    all_runs[name].append(result)
            for name, runs in all_runs.items():
                entry = {"variant": name, "runtime": runtime, "case": case_name, "operation": operation,
                         "totalBytes": byte_count, "fileCount": len(paths), "runs": runs,
                         "median": {key: statistics.median(run[key] for run in runs) for key in runs[0]}}
                report["results"].append(entry)
                print(f"{name} {runtime} {case_name} {operation}: {entry['median']['throughputMiBPerSecond']:.1f} MiB/s, +{entry['median']['peakIncrementBytes'] / 1024 / 1024:.1f} MiB RSS", flush=True)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, indent=2) + "\n")

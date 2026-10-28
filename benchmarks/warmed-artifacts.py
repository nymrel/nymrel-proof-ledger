#!/usr/bin/env python3
"""Five paired >=200 ms batches in warmed, persistent variant workers (Linux).

This steady-state diagnostic is distinct from artifact-benchmark.py's original
fresh-process acceptance comparison. It preserves all samples, including slow or
throttled ones, and does not replace the original process-startup observations.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
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
parser.add_argument("--baseline-node-module", type=Path, required=True)
parser.add_argument("--baseline-python-root", type=Path, required=True)
parser.add_argument("--node", default="node")
parser.add_argument("--python", default=sys.executable)
parser.add_argument("--work-dir", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--summary", type=Path)
parser.add_argument("--target-ms", type=float, default=400)
args = parser.parse_args()
if sys.platform != "linux":
    parser.error("Linux is required for contention telemetry")
if args.target_ms < 200:
    parser.error("--target-ms must be at least 200")
script_root = Path(__file__).resolve().parent
variants = {
    "baseline": (args.baseline_node_module.resolve(), args.baseline_python_root.resolve()),
    "candidate": (args.node_module.resolve(), args.python_root.resolve()),
}


def digest_file(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def code_info():
    result = {}
    for name, (node_module, python_root) in variants.items():
        node_files = {str(file.relative_to(node_module.parent)): digest_file(file) for file in sorted(node_module.parent.glob("*.js"))}
        python_files = {str(file.relative_to(python_root)): digest_file(file) for file in sorted((python_root / "nymrel_proof_ledger").rglob("*.py"))}
        result[name] = {
            "nodeModule": str(node_module), "pythonRoot": str(python_root),
            "nodeCoreFilesSha256": node_files, "pythonPackageFilesSha256": python_files,
        }
    return result


def optional_text(path):
    try:
        return {"value": Path(path).read_text().strip(), "error": None}
    except OSError as error:
        return {"value": None, "error": str(error)}


def counter_text(path):
    result = optional_text(path)
    return {"value": None if result["value"] is None else {
        line.split()[0]: int(line.split()[1]) for line in result["value"].splitlines()
    }, "error": result["error"]}


def host_snapshot():
    return {
        "loadAverage": list(os.getloadavg()),
        "cgroupCpuStat": counter_text("/sys/fs/cgroup/cpu.stat"),
        "cgroupCpuPressure": optional_text("/sys/fs/cgroup/cpu.pressure"),
        "hostCpuPressure": optional_text("/proc/pressure/cpu"),
    }


class Worker:
    def __init__(self, runtime, variant):
        node_module, python_root = variants[variant]
        command = ([args.node, "--expose-gc", str(script_root / "warmed-artifact-worker.mjs"), str(node_module)]
                   if runtime == "node" else [args.python, str(script_root / "warmed-artifact-worker.py"), str(python_root)])
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        self.metadata = self.receive()
        if not self.metadata.get("ready"):
            raise RuntimeError(self.metadata)

    def receive(self):
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError(f"Worker exited ({self.process.poll()}): {self.process.stderr.read()}")
        result = json.loads(line)
        if "error" in result:
            raise RuntimeError(result["error"])
        return result

    def request(self, command):
        self.process.stdin.write(json.dumps(command) + "\n")
        self.process.stdin.flush()
        return self.receive()

    def batch(self, operation, iterations):
        return self.request({"action": "batch", "operation": operation, "iterations": iterations})

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=10)
        if self.process.returncode:
            raise RuntimeError(self.process.stderr.read())
        self.process.stdout.close()
        self.process.stderr.close()


def warm(paths):
    for path in paths:
        with (args.work_dir / path).open("rb") as file:
            while file.read(1024 * 1024):
                pass


def calibrate(worker, operation):
    worker.batch(operation, 3)
    count = 1
    while True:
        result = worker.batch(operation, count)
        if result["elapsedSeconds"] >= 0.1:
            return result
        count *= 2


def summarize(report):
    result = {key: report[key] for key in ("schemaVersion", "measuredAt", "method", "sourceRevision", "code", "workers", "workerScriptsSha256", "host", "limitations", "sourceFilesUnchanged", "allMeasuredSamplesAtLeast200ms")}
    result["rawEvidence"] = {"path": str(args.output.resolve()), "sha256": digest_file(args.output)}
    result["results"] = [{key: row[key] for key in ("runtime", "case", "operation", "iterationsPerSample", "samplesPerVariant", "variantFirstCounts", "median", "throughputChangePercent", "pairedThroughputChangesPercent", "medianPairedThroughputChangePercent", "minimumSampleSeconds", "allSamplesAtLeast200ms", "throughputTargetMet", "cgroupCpuStatDeltas")} for row in report["results"]]
    return result


# Reuse the original deterministic data, and fail rather than benchmark new data.
cases = {
    "node": [("1MiB", ["artifact-1MiB.bin"], 1024 * 1024)],
    "python": [("1-files", ["small/0000.bin"], 4096)],
}
for runtime_cases in cases.values():
    runtime_cases.append(("1000-files", [f"small/{index:04d}.bin" for index in range(1000)], 4096 * 1000))
for runtime_cases in cases.values():
    for _, paths, size in runtime_cases:
        if sum((args.work_dir / path).stat().st_size for path in paths) != size:
            raise RuntimeError("Input data size differs from original benchmark")
report = {
    "schemaVersion": 1, "measuredAt": datetime.now(UTC).isoformat(),
    "method": "Persistent workers, warm page cache and operation warmup/calibration; five paired batches with fixed shared iteration count. Alternate which variant runs first within each pair (3:2 per case, reversed for adjacent cases). Exactly one worker active at a time. Imports, setup, receipt loading, JSON, GC and telemetry excluded from timing; unavoidable automatic GC within a batch remains included. Initial calibration chooses a count targeting 1.5x requested batch duration in the faster variant. Every measured sample must reach 200ms; otherwise this diagnostic is incomplete, with samples retained. No sample or pair is discarded or repeated.",
    "sourceRevision": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "code": code_info(), "workers": {},
    "workerScriptsSha256": {name: digest_file(script_root / name) for name in ("warmed-artifacts.py", "warmed-artifact-worker.mjs", "warmed-artifact-worker.py")},
    "host": {"platform": platform.platform(), "machine": platform.machine(),
             "cpuModel": next((line.partition(":")[2].strip() for line in Path("/proc/cpuinfo").read_text().splitlines() if line.startswith("model name")), "unknown"),
             "cpuCount": os.cpu_count(), "affinity": sorted(os.sched_getaffinity(0)),
             "cgroupCpuMax": optional_text("/sys/fs/cgroup/cpu.max"),
             "cgroupCpuSetEffective": optional_text("/sys/fs/cgroup/cpuset.cpus.effective"),
             "before": host_snapshot()},
    "limitations": "Shared host without exclusive CPU reservation. Cgroup CPU counters include sibling tasks and cannot attribute interference to a worker. Missing pressure telemetry is reported with null/error. Five samples leave variant-first order split 3:2. Each sample reports a batch mean per operation, not individual-operation percentiles. Long-lived RSS readings cannot replace the earlier fresh-process memory evidence. This warmed method investigates steady state and does not erase cold/fresh-process misses.",
    "results": [],
}
case_index = 0
for runtime, runtime_cases in cases.items():
    workers = {name: Worker(runtime, name) for name in variants}
    report["workers"][runtime] = {name: worker.metadata for name, worker in workers.items()}
    try:
        for case_name, paths, byte_count in runtime_cases:
            warm(paths)
            fixture = workers["baseline"].request({"action": "setup", "cwd": str(args.work_dir.resolve()), "paths": paths})["receipt"]
            candidate_fixture = workers["candidate"].request({"action": "setup", "cwd": str(args.work_dir.resolve()), "paths": paths, "receipt": fixture})["receipt"]
            if fixture != candidate_fixture:
                raise RuntimeError("Workers must share an identical immutable verification fixture")
            fixture_sha256 = hashlib.sha256(json.dumps(fixture, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            for operation in ("create", "verify"):
                pilots = {name: calibrate(worker, operation) for name, worker in workers.items()}
                iterations = math.ceil(args.target_ms / 1000 * 1.5 / min(row["secondsPerOperation"] for row in pilots.values()))
                runs = {name: [] for name in variants}
                pairs = []
                case_before = host_snapshot()
                for sample in range(5):
                    order = ["baseline", "candidate"] if (sample + case_index) % 2 == 0 else ["candidate", "baseline"]
                    pair = {"sample": sample + 1, "order": order, "before": host_snapshot(), "runs": {}}
                    for name in order:
                        result = workers[name].batch(operation, iterations)
                        result["throughputMiBPerSecond"] = byte_count / 1024**2 / result["secondsPerOperation"]
                        result["cpuToWallRatio"] = result["cpuSeconds"] / result["elapsedSeconds"]
                        runs[name].append(result)
                        pair["runs"][name] = result
                    pair["after"] = host_snapshot()
                    pairs.append(pair)
                case_after = host_snapshot()
                median = {name: {key: statistics.median(row[key] for row in rows) for key in rows[0]} for name, rows in runs.items()}
                changes = [100 * (pair["runs"]["candidate"]["throughputMiBPerSecond"] / pair["runs"]["baseline"]["throughputMiBPerSecond"] - 1) for pair in pairs]
                change = 100 * (median["candidate"]["throughputMiBPerSecond"] / median["baseline"]["throughputMiBPerSecond"] - 1)
                stat_before, stat_after = (row["cgroupCpuStat"]["value"] for row in (case_before, case_after))
                row = {
                    "runtime": runtime, "case": case_name, "operation": operation,
                    "totalBytes": byte_count, "fileCount": len(paths), "fixtureSha256": fixture_sha256,
                    "iterationsPerSample": iterations, "samplesPerVariant": 5,
                    "variantFirstCounts": {name: sum(pair["order"][0] == name for pair in pairs) for name in variants},
                    "calibration": pilots, "pairs": pairs, "median": median,
                    "throughputChangePercent": change, "pairedThroughputChangesPercent": changes,
                    "medianPairedThroughputChangePercent": statistics.median(changes),
                    "minimumSampleSeconds": min(sample["elapsedSeconds"] for rows in runs.values() for sample in rows),
                    "cgroupCpuStatDeltas": None if stat_before is None or stat_after is None else {key: stat_after[key] - value for key, value in stat_before.items()},
                }
                row["allSamplesAtLeast200ms"] = row["minimumSampleSeconds"] >= 0.2
                row["throughputTargetMet"] = row["allSamplesAtLeast200ms"] and change >= -10
                report["results"].append(row)
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(report, indent=2) + "\n")
                print(f"{runtime} {case_name} {operation}: {iterations} ops/sample, minimum {row['minimumSampleSeconds']:.3f}s, change {change:+.2f}%, paired median {statistics.median(changes):+.2f}%", flush=True)
                case_index += 1
    finally:
        for worker in workers.values():
            worker.close()
report["host"]["after"] = host_snapshot()
report["sourceFilesUnchanged"] = code_info() == report["code"]
report["allMeasuredSamplesAtLeast200ms"] = all(row["allSamplesAtLeast200ms"] for row in report["results"])
args.output.write_text(json.dumps(report, indent=2) + "\n")
if args.summary:
    args.summary.parent.mkdir(parents=True, exist_ok=True)
    args.summary.write_text(json.dumps(summarize(report), indent=2) + "\n")
if not report["sourceFilesUnchanged"] or not report["allMeasuredSamplesAtLeast200ms"]:
    raise RuntimeError("Diagnostic incomplete: source changed or a measured batch was shorter than 200ms; all samples retained")

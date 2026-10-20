#!/usr/bin/env python3
"""Reduce a paired raw result to a portable, checksum-linked summary."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("raw", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
raw = json.loads(args.raw.read_text())
groups = {}
for row in raw["results"]:
    key = (row["runtime"], row["case"], row["operation"])
    groups.setdefault(key, {})[row["variant"]] = row
summary = {key: raw[key] for key in ("schemaVersion", "measuredAt", "sourceRevision", "host", "runtimes", "code", "cacheConditions", "measurement", "runsPerCase", "variantOrder")}
summary["rawEvidence"] = {"path": str(args.raw.resolve()), "sha256": hashlib.sha256(args.raw.read_bytes()).hexdigest()}
summary["results"] = []
for (runtime, case, operation), variants in groups.items():
    baseline, candidate = (variants[key]["median"] for key in ("baseline", "candidate"))
    throughput_change = 100 * (candidate["throughputMiBPerSecond"] / baseline["throughputMiBPerSecond"] - 1)
    memory_reduction = 100 * (1 - candidate["peakIncrementBytes"] / baseline["peakIncrementBytes"]) if baseline["peakIncrementBytes"] else None
    summary["results"].append({
        "runtime": runtime, "case": case, "operation": operation,
        "baselineMedian": baseline, "candidateMedian": candidate,
        "throughputChangePercent": throughput_change,
        "incrementalPeakMemoryReductionPercent": memory_reduction,
        "throughputTargetMet": throughput_change >= -10,
        "memoryTargetMet": memory_reduction is not None and memory_reduction >= 75 if case == "1024MiB" else None,
    })
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(summary, indent=2) + "\n")
print("| Runtime | Case | Operation | Before MiB/s | After MiB/s | Change | Before/after RSS growth (MiB) |")
print("| --- | --- | --- | ---: | ---: | ---: | ---: |")
for row in summary["results"]:
    before, after = row["baselineMedian"], row["candidateMedian"]
    print(f"| {row['runtime']} | {row['case']} | {row['operation']} | {before['throughputMiBPerSecond']:.1f} | {after['throughputMiBPerSecond']:.1f} | {row['throughputChangePercent']:+.1f}% | {before['peakIncrementBytes'] / 1024**2:.2f} / {after['peakIncrementBytes'] / 1024**2:.2f} |")

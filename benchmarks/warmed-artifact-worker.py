"""Persistent worker for warmed-artifacts.py; protocol overhead is untimed."""
from __future__ import annotations

import gc
import json
import os
import resource
import sys
import time
from importlib import import_module
from importlib.metadata import version

sys.path.insert(0, sys.argv[1])
receipt_module = import_module("nymrel_proof_ledger.receipt")
secret = "11" * 32  # Public synthetic benchmark fixture.
setup = None
receipt = None


def create():
    return receipt_module.create_receipt(
        task={"name": "Warmed artifact benchmark"}, signing_key=secret,
        signer_identity="synthetic-benchmark", cwd=setup["cwd"],
        artifacts=[{"path": path} for path in setup["paths"]],
    )


def verify():
    return receipt_module.verify_receipt(
        receipt, public_key_or_secret=secret, expected_algorithm="HMAC-SHA256",
        check_files_on_disk=True, cwd=setup["cwd"],
    )


def rss():
    with open("/proc/self/status", encoding="utf-8") as file:
        return next(int(line.split()[1]) * 1024 for line in file if line.startswith("VmRSS:"))


def send(value):
    print(json.dumps(value), flush=True)


send({"ready": True, "pid": os.getpid(), "runtime": sys.version,
      "dependencies": {name: version(name) for name in ("cryptography", "rfc8785")}})
for line in sys.stdin:
    try:
        command = json.loads(line)
        if command["action"] == "setup":
            setup = command
            receipt = command.get("receipt") or create()
            result = verify()
            if not result["trusted"] or result["checkedArtifacts"] != len(setup["paths"]):
                raise RuntimeError("Setup verification failed")
            send({"receipt": receipt, "checkedArtifacts": result["checkedArtifacts"]})
            continue
        if command["action"] != "batch":
            raise ValueError("Expected setup or batch")
        operation = create if command["operation"] == "create" else verify
        gc.collect()
        rss_before_bytes = rss()
        usage_before = resource.getrusage(resource.RUSAGE_SELF)
        started = time.perf_counter()
        for _ in range(command["iterations"]):
            result = operation()
        elapsed_seconds = time.perf_counter() - started
        usage_after = resource.getrusage(resource.RUSAGE_SELF)
        rss_after_bytes = rss()
        if command["operation"] == "verify":
            if not result["trusted"] or result["checkedArtifacts"] != len(setup["paths"]):
                raise RuntimeError("Batch verification failed")
        elif len(result["artifacts"]) != len(setup["paths"]) or any(
            artifact["sha256"] != expected["sha256"] or artifact["sizeBytes"] != expected["sizeBytes"]
            for artifact, expected in zip(result["artifacts"], receipt["artifacts"], strict=True)
        ):
            raise RuntimeError("Batch receipt digest/size mismatch")
        send({
            "elapsedSeconds": elapsed_seconds, "iterations": command["iterations"],
            "secondsPerOperation": elapsed_seconds / command["iterations"],
            "cpuSeconds": (usage_after.ru_utime - usage_before.ru_utime) + (usage_after.ru_stime - usage_before.ru_stime),
            "voluntaryContextSwitches": usage_after.ru_nvcsw - usage_before.ru_nvcsw,
            "involuntaryContextSwitches": usage_after.ru_nivcsw - usage_before.ru_nivcsw,
            "rssBeforeBytes": rss_before_bytes, "rssAfterBytes": rss_after_bytes,
        })
    except Exception as error:
        send({"error": repr(error)})

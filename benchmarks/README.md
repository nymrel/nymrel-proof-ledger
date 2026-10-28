# Artifact hashing benchmark

`artifact-benchmark.py` measures complete receipt creation and authenticated
verification with disk checks in fresh Node and Python processes. It uses only
the standard libraries plus the package's existing Python dependencies. The
measurement harness currently requires Linux for consistent RSS accounting.

The data set contains non-sparse deterministic 1 MiB, 100 MiB and 1 GiB files,
and manifests of 1, 100 and 1,000 deterministic 4 KiB files. Every operation runs
five times; results retain every run and report median elapsed time, throughput,
idle RSS, lifetime peak RSS, and peak RSS growth above idle. Imports, fixture
loading, garbage collection, fixture generation and page-cache warming are
excluded from timing. Creation includes hashing, receipt construction and signing;
verification includes authentication, path checks and file hashing. Both use a
public synthetic HMAC test key.

Before every run the driver sequentially reads the complete input outside the
worker, so these are warm-page-cache measurements. It does not drop host caches.
Each worker records idle RSS after imports, fixture loading and garbage collection.
Incremental peak memory is `max(0, lifetime peak RSS - idle RSS)`, using Linux
`getrusage`/Node `resourceUsage`. This is an RSS high-water measurement rather
than a heap estimate; initialization high-water marks and allocator behavior can
influence small-file measurements. Host characteristics, runtime versions, exact
receipt-module hashes, cache procedure and measurement time are recorded in JSON.

To compare a preserved baseline against the current build, run from the repository
root (use an isolated Python environment with the documented runtime dependencies):

```bash
npm run build
python benchmarks/artifact-benchmark.py \
  --node-module dist/src/core/receipt.js \
  --python-root python \
  --baseline-node-module /path/to/baseline/node/core/receipt.js \
  --baseline-python-root /path/to/baseline/python-root \
  --python /path/to/venv/bin/python \
  --work-dir /workspace/scratch/proof-ledger-bench/data \
  --output /workspace/scratch/proof-ledger-bench/paired.json
```

The baseline Python root must contain `nymrel_proof_ledger/`; the preserved Node
root must include the receipt module's relative imports and an ancestor
`package.json` with `"type": "module"` (or be inside this ESM repository). The
same input data and worker code are used for both implementations, alternating
baseline then candidate within each repetition. Optional `--case`, `--runtime`,
and `--runs` arguments support focused investigations. Keep five runs for an
acceptance comparison. Use separate work directories for concurrent driver runs.

Copy or build the baseline before editing artifact I/O. Keep both implementations
unchanged throughout a comparison, and retain the original raw JSON. The goal's
1 GiB memory target is at least 75% less median incremental peak RSS, and a
throughput decrease greater than 10% is material. These are measurement targets,
not timing assertions in shared CI. Cold-cache behavior and concurrent file
mutation are outside this benchmark.

The warmed diagnostic uses persistent workers and five alternating paired
batches. Its default cases remain Node 1 MiB, Python one 4 KiB file, and 1,000
files in both runtimes. To investigate another manifest size, add
`--case 100-files` to `warmed-artifacts.py`; explicitly selected cases run in
both runtimes. Available selections are `1MiB`, `1-files`, `100-files`, and
`1000-files`; repeat `--case` for multiple cases. Keep fresh-process and warmed
results separate, retain every sample, and declare additional cases before
running them. The warmed diagnostic does not replace the full fresh-process
comparison or its RSS measurements.

Use `--runtime node` or `--runtime python` to restrict the warmed diagnostic to
one runtime. Omitting `--runtime` preserves the original two-runtime behavior;
repeat it to select both explicitly. This supports sequential quiet windows
without maintaining another copy of the harness.

## Opt in to a fresh CI job

Include this literal marker in a pull request's body before opening it or
pushing the candidate commit:

```text
<!-- proof-ledger-artifact-benchmark -->
```

The existing CI workflow then adds one bounded `Opt-in artifact benchmark` job;
ordinary checks and triggers remain unchanged. Editing the body alone does not
start another run. The body is used only in a boolean marker check and is never
inserted into a command. No new schedule, secret, publication, or timing-based
pass/fail gate is created.

The job builds its checked-out candidate and fixed baseline
`232849c4e833da992cbcdcc6fa4b7bd0f56cbde3` with locked npm dependencies and
disabled lifecycle scripts, then measures all 24 fresh-process comparisons with
five paired samples on the same Node 24/Python 3.13 job VM. Both variants share
one bounded Python dependency environment. Each pair runs baseline first, as
in the existing harness. The job runs no other tests while measuring. A fresh
Actions VM removes this workspace's concurrent workloads; it does not establish
exclusive physical hardware or eliminate every source of measurement noise.

Download `artifact-benchmark-evidence` from that CI run within 90 days. It retains
raw samples, compact medians, exact checked-out and PR-head identities,
before/after transitive source and harness checksums, runtime/dependency
versions, host/cgroup observations, and logs. Partial evidence is uploaded after
failure; a setup failure can leave only setup logs. The 1 GiB fixtures, baseline
checkout, and virtual environment stay outside the uploaded evidence directory.
The ordinary job log also prints the median Markdown table between
`BENCHMARK_TABLE_BEGIN` / `BENCHMARK_TABLE_END` and a compact source-bound JSON
report between `BENCHMARK_RESULT_JSON_BEGIN` / `BENCHMARK_RESULT_JSON_END`, so
agents can review the measured results without downloading a binary archive.
Throughput misses remain recorded observations. Do not rerun unchanged work
until it passes; retain an unfavorable result and investigate its cause.

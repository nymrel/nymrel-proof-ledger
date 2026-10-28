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

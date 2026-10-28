# Artifact hashing measurements — October 18, 2026

Streaming file hashing is implemented in both runtimes, with a reusable 1 MiB
Node buffer and a reusable 64 KiB Python buffer per receipt operation. In-memory
inputs retain their original behavior, and verification still rejects invalid
receipts before artifact I/O. Node remains free of production dependencies.

The final paired comparison used Node v24.19.0 and Python 3.13.5 on the same Linux
6.18.55 x86_64 host (Intel Xeon Platinum 8370C, five available CPUs). Each
implementation ran five times per case and operation, alternating baseline and
candidate, with input bytes warmed in the page cache before each fresh worker.
The shared host was not reserved exclusively for benchmarking. See
[the measurement procedure](README.md) and [all median results and code hashes](results/artifacts-2026-10-18.json).

| 1 GiB operation | Before / after throughput (MiB/s) | Before / after RSS growth (MiB) | RSS growth reduction |
| --- | ---: | ---: | ---: |
| Node creation | 437.9 / 809.1 | 1026.12 / 3.00 | 99.71% |
| Node disk verification | 428.3 / 776.9 | 1025.88 / 3.12 | 99.70% |
| Python creation | 557.0 / 923.1 | 1023.96 / 0.08 | 99.99% |
| Python disk verification | 539.8 / 1001.0 | 1023.96 / 0.00 | 100.00% measured |

All four 1 GiB operations exceed the 75% memory reduction target and improve
median throughput by 65.7–85.4%. Zero measured RSS growth means the operation did
not increase the process high-water mark above its measured idle RSS; it does
not mean hashing uses no memory. Receipt metadata and Merkle data still grow with
manifest size; the bounded buffers prevent memory growth with artifact byte size.

The universal throughput target remains open. Two shorter cases exceeded the
10% material-regression threshold in the final five-run comparison:

- Node 1 MiB creation: 171.0 to 150.4 MiB/s, a 12.0% decrease (5.85 to 6.65 ms).
- Python single 4 KiB file creation: 4.69 to 4.17 MiB/s, an 11.0% decrease
  (0.833 to 0.936 ms).

The other 22 cases met the throughput target. Repeated exploratory Node 1 MiB
measurements varied in direction; the final comparison retains the observed
regression rather than dismissing it as noise. Reusing buffers removed a severe
initial Python small-manifest regression; selecting 64 KiB Python chunks also
removed the initial 1 MiB verification regression. No timing threshold is added
to CI. Further dedicated-host measurement and short-operation profiling are still
needed before claiming the throughput target for every case.

The original implementation was built and copied before editing artifact I/O.
Its source revision was `232849c4e833da992cbcdcc6fa4b7bd0f56cbde3`.
The October 18 candidate was the uncommitted implementation identified by the
module hashes in the summary, not a published release. Raw evidence is retained locally under
`/workspace/scratch/proof-ledger-bench/`:

| File | SHA-256 | Purpose |
| --- | --- | --- |
| `baseline.json` | `29fc19b5a75b14c534552bc12bb20963eb1f805d9a28437cd0712ef7875a0d50` | Original five-run baseline, recorded before artifact I/O edits. |
| `candidate.json` | `5495e36ec37904f49ec41815717c210dcf45e355fd61de7f7e927a5cd10edc34` | Initial streaming implementation; exposed Python manifest-allocation overhead. |
| `paired-initial.json` | `dff1a86f522d0466cb5fc389796cdcd71a7581bf1a80614f6e2e54e603438314` | Alternating baseline and candidate after buffer reuse. |
| `paired-final.json` | `8911180f96c90e2e0ddaf6ea38ba08a7f281636f0a20527d1406d7a78769838e` | Final alternating five-run comparison with 64 KiB Python chunks. |

Only the compact median summary is tracked. Preserve or export the raw files
separately when moving this workspace. The workers contain a public synthetic
fixture key, not operator credentials. Run `python benchmarks/summarize-artifacts.py
/path/to/paired.json /path/to/summary.json` to regenerate a summary and print
its full table.

Focused regression checks passed: 27 TypeScript streaming/path cases, seven
Python streaming cases and three Python path cases. They cover empty and binary
files, Unicode inputs, multi-chunk files with partial tails, exact hashes and byte
counts, tail tampering, missing/read-failed files with cleanup, signature rejection
before filesystem access, and traversal/symlink boundaries.

## Follow-up profiling

After the release tests finished, the two missed creation cases were repeated in
a quiet root-work window with unchanged core source, retaining five paired runs
per comparison. [The follow-up summary](results/followup-2026-10-18.json) links
raw evidence by checksum and preserves the median data:

| Quiet repeat | Creation before / after | Throughput change |
| --- | ---: | ---: |
| Node 1 MiB, first repeat | 6.178 / 6.900 ms | -10.46% |
| Node 1 MiB, second repeat | 11.648 / 7.506 ms | +55.17% |
| Python single 4 KiB | 0.830 / 0.771 ms | +7.65% |

The Python creation miss reversed, while its verification timings moved in the
opposite direction. Node creation had one further marginal miss followed by a
large reversal; the second baseline varied from 5.59 to 14.14 ms. This host is
shared, so stopping root test activity did not establish exclusive access.

A separate five-pair Node diagnostic wrapped artifact I/O with timing spans.
Whole creation medians were 5.782 ms baseline and 5.633 ms streaming; standalone
hashing medians were 3.374 and 3.395 ms. Measured I/O spans were slightly faster
for streaming in both operations (creation: 1.649 to 1.564 ms; standalone hashing:
1.682 to 1.579 ms). The wrappers add instrumentation overhead, so these are
profiling observations rather than acceptance results. They did not identify a
repeatable I/O bottleneck justifying a production change. A file-size `fstat`
branch would add filesystem work and complexity without evidence that it resolves
the observed variation; the existing Python buffer is already 64 KiB.

No core changes were made during this follow-up. The initial full-case comparison
and its two observed misses remain recorded above; the universal throughput target
is still not declared met. Dedicated-host measurement remains the next step for
resolving these short-operation results.

## Warmed steady-state batches — October 20, 2026

A separate diagnostic now measures repeated use in persistent workers, reducing
the effect of first-call initialization on sub-millisecond operations. It retains
the original fresh-process observations above and uses a distinct method; it does
not replace those observations or claim that a cold-operation regression was
fixed. All file bytes use the warm page cache; "cold" here refers to process and
first-call initialization, rather than cold-cache disk I/O.

For each runtime, baseline and candidate run in separate long-lived processes.
Both warm their operation and calibrate before timing. Each measured case uses
the same fixed iteration count for both variants, five paired samples, and
alternating execution order (3:2 within a case, reversed for the next case).
Only one worker executes a batch at a time. Importing, fixture preparation,
protocol JSON, explicit garbage collection and telemetry are outside timed
batches; automatic garbage collection during a batch remains included. Verifiers
share the same immutable authenticated fixture. Each completed batch checks its
final result for trusted verification and artifact count, or creation digests and
byte sizes. All samples are retained, including slow ones.

The run used Node v24.19.0 and Python 3.13.5, with Python cryptography 50.0.2 and
rfc8785 0.1.4 identical in both variants. Every measured batch lasted at least
0.503 seconds, exceeding the 200 ms minimum. Each table entry is the median of
five batch means per operation, and throughput changes compare the median
throughputs. Individual paired ratios and their medians are retained separately
in [the compact result](results/warmed-2026-10-20.json).

| Runtime | Input | Operation | Baseline / streaming ms per operation | Median throughput change |
| --- | --- | --- | ---: | ---: |
| Node | 1 MiB | Creation | 1.782 / 1.841 | -3.21% |
| Node | 1 MiB | Disk verification | 1.895 / 1.939 | -2.23% |
| Node | 1,000 × 4 KiB | Creation | 141.510 / 149.734 | -5.49% |
| Node | 1,000 × 4 KiB | Disk verification | 247.301 / 196.019 | +26.16% |
| Python | 4 KiB | Creation | 0.116 / 0.122 | -4.70% |
| Python | 4 KiB | Disk verification | 0.160 / 0.167 | -4.42% |
| Python | 1,000 × 4 KiB | Creation | 25.371 / 26.736 | -5.10% |
| Python | 1,000 × 4 KiB | Disk verification | 58.827 / 60.897 | -3.40% |

All eight median comparisons meet the 10% throughput target under this warmed
method. The original two creation misses do not persist in these longer batches;
there is no demonstrated material steady-state bottleneck justifying another
production change. No production source changed during the investigation. The
original fresh-process comparison, including its two misses, remains separate
acceptance evidence; universal cold-and-warm throughput acceptance is still not
claimed. This experiment does not retest the earlier large-file memory result.

The environment provided a four-CPU quota (`cpu.max` = `400000 100000`) with five
CPUs in the effective affinity set. Root and other project agents paused heavy
tests during the run. Cgroup throttling counters remained zero for every measured
case, and recorded load averages rose from 0.235 to 0.672. These observations do
not establish exclusive access to the shared host. CPU pressure files were
unavailable and are recorded as missing, rather than zero. CPU time, voluntary
and involuntary context switches, RSS before/after batches, and cgroup counters
are retained for diagnosing interference; cgroup totals include sibling tasks.
Some Node pair ratios still vary materially, so the medians do not establish a
bound for every individual operation or pair or a statistical confidence bound.
Calibration reduces startup effects without proving that JIT warmup has reached
a stationary state. Long-lived RSS is cumulative and
cannot replace the earlier fresh-process memory measurements.

Raw evidence is retained at
`/workspace/scratch/proof-ledger-bench/warmed-2026-10-20.json`, SHA-256
`f76b95c4e93614b5f167628aefad019c2020e7c3cd543b5911ccb35d59f627b1`.
The tracked summary includes exact worker script hashes, transitive core/package
source hashes, runtime versions, all median values, paired ratios, host limits
and missing-telemetry details. Source hashes matched before and after the run.
Reproduce with the preserved baseline directories and original deterministic
input files:

```bash
python benchmarks/warmed-artifacts.py \
  --node-module dist/src/core/receipt.js \
  --python-root python \
  --baseline-node-module /path/to/baseline/node/core/receipt.js \
  --baseline-python-root /path/to/baseline/python-root \
  --python /path/to/venv/bin/python \
  --work-dir /workspace/scratch/proof-ledger-bench/data \
  --output /workspace/scratch/proof-ledger-bench/warmed.json \
  --summary /workspace/scratch/proof-ledger-bench/warmed-summary.json
```

The driver uses a 400 ms calibration target with a 1.5× margin. If any measured
batch falls below 200 ms or source files change, it retains all samples and exits
with an incomplete-diagnostic error. It does not discard pairs or silently rerun
until a favorable result appears. Timing remains diagnostic rather than a shared
CI pass/fail check.

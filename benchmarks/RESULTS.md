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

## Current-source repeat — October 28, 2026

**The full throughput criterion remains unmet in this measurement.** A complete
five-run fresh-process comparison passed 20 of 24 throughput medians. The four
1 GiB operations passed the memory target, with 99.695–100% measured reduction
in incremental peak RSS and 42.8–84.0% faster median throughput. A zero RSS
increment remains a high-water measurement, not evidence of zero memory use.

The baseline was rebuilt from
`232849c4e833da992cbcdcc6fa4b7bd0f56cbde3`; the current candidate was
`a4faccb082ec17233df700f3deb392a31d076374`. Both used Node 24.19.0 and Python
3.13.5 with cryptography 50.0.2 and rfc8785 0.1.4. This compares complete receipt
operations across those revisions, including intervening validation/path
changes; it cannot attribute a difference solely to streaming I/O.

The [fresh-process summary](results/fresh-2026-10-28.json) retains these misses:

| Runtime | Input | Operation | Baseline / candidate ms | Throughput change |
| --- | --- | --- | ---: | ---: |
| Python | One 4 KiB file | Disk verification | 0.874 / 1.135 | -23.02% |
| Node | 100 × 4 KiB | Creation | 38.973 / 44.069 | -11.56% |
| Python | 100 × 4 KiB | Disk verification | 5.595 / 6.481 | -13.67% |
| Node | 1,000 × 4 KiB | Disk verification | 283.557 / 328.879 | -13.78% |

The separately planned [default warmed diagnostic](results/warmed-2026-10-28.json)
passed four of eight throughput medians. Its misses were Node 1 MiB creation
(-26.18%) and verification (-21.31%), Python single-file verification (-11.41%),
and Python 1,000-file creation (-10.33%). All batches exceeded 200 ms; no sample
was discarded or rerun. Python single-file verification decreased under both
methods, so the current evidence does not support dismissing every miss as
short-operation noise.

The default warmed cases exclude 100-file manifests. After reading the fresh
results, one additional five-pair comparison was declared for both runtimes and
both operations at that manifest size, using the new optional `--case` selector.
All four [100-file warmed medians](results/warmed100-2026-10-28.json) passed:
Node creation +27.42%, Node verification +17.44%, Python creation -2.39%, and
Python verification +2.80%. This diagnoses the fresh 100-file misses without
erasing them. Every additional batch exceeded 200 ms.

Other project agents paused installs, builds, and heavy tests for the timed
window. The host remained shared: four-CPU quota, five-CPU affinity, and 16 GiB
memory limit; there was no exclusive reservation. Cgroup throttling counters
did not increase during any measured run. Missing pressure telemetry and host
snapshots are retained rather than treated as zero. The original deterministic
fixture specification was regenerated because earlier workspace raw files were
unavailable; this is new evidence, not a reproduction of the old host session.

[Source provenance](results/provenance-2026-10-28.json) records exact source,
emitted-module and harness hashes, before/after host state, and checksums of all
raw samples. Source and harness identities stayed unchanged within each run.
Raw JSON, logs, and the reproduction wrapper are retained outside the checkout
at `/workspace/proof-ledger-results/performance/`, with an exportable
`evidence-2026-10-28.tar.gz` and `EVIDENCE_SHA256SUMS`. Preserve that bundle when
moving the workspace; the compact tracked summaries do not contain every raw
sample. No production source was changed to chase these timings. The next
performance increment is controlled profiling of the current Node 1 MiB and
Python single-file verification paths, followed by an attributable fix only if
the measurements identify one. Universal throughput acceptance stays open.

### Node profiling and rejected buffer-size hypothesis

The [Node profile summary](results/node-profile-2026-10-28.json) retains
deterministic cost counts and two instrumented diagnostics. Per 1 MiB operation,
both baseline and current source perform one open, two reads, and one close;
baseline additionally performs `fstat`. Verification uses the same two
`realpath` calls in each implementation. Current source creates one fewer
promise and one fewer filesystem request per operation. Neither more filesystem
calls nor added path checks explain the observed regression.

In five alternating instrumented pairs, current creation took 2.447 ms versus
2.013 ms at baseline; verification took 1.822 ms versus 1.720 ms. Creation's
difference spanned I/O, SHA updates, and residual work, with 130.8 versus 82.2
minor faults per operation. An earlier grouped profile reversed the direction.
The wrappers add overhead, and these stage medians cannot be used as acceptance
timings or proof of a sole production bottleneck.

The allocation/read-granularity difference was tested as one explicit
hypothesis: current 1 MiB streaming buffer versus an otherwise identical 512 KiB
buffer. Only the copied emitted constant changed; production source stayed
unchanged. Existing streaming/path checks passed all 28 cases against the
512 KiB variant, including exact digests, byte counts, partial tails, read
failures, signature rejection before disk, and filesystem confinement.

One predeclared [fresh five-pair comparison](results/node-buffer-fresh-2026-10-28.json)
and one [warmed five-pair comparison](results/node-buffer-warmed-2026-10-28.json)
retained these throughput changes relative to the current 1 MiB buffer:

| Input | Operation | Fresh | Warmed |
| --- | --- | ---: | ---: |
| 1 MiB | Creation | -18.12% | -0.46% |
| 1 MiB | Verification | +11.82% | -0.71% |
| 1 GiB | Creation | -1.72% | Not measured |
| 1 GiB | Verification | +3.08% | Not measured |
| 1,000 × 4 KiB | Creation | -3.88% | -5.79% |
| 1,000 × 4 KiB | Verification | -15.11% | +0.32% |

**The 512 KiB change was rejected.** It provided no useful warmed improvement
and retained two material fresh-process regressions. Both variants kept 1 GiB
RSS growth below 4 MiB; these relative buffer comparisons are separate from
the original 75% memory-reduction target against whole-file hashing. All warmed
batches exceeded 200 ms. No unfavorable sample was dropped or repeated.
[The variant manifest and provenance](results/node-buffer-provenance-2026-10-28.json)
bind exact emitted modules, harnesses, host counters, and raw evidence. Hashes
stayed unchanged within each run and throttling counters did not increase.
Raw profiles, counts, scripts, and variant modules are included in the existing
exportable evidence bundle. The original throughput criterion remains open;
this experiment does not justify a speculative production rewrite.

### Python buffering attribution and scoped change

A deterministic raw-read count identified redundant work in Python's existing
streaming implementation. For a 4 KiB file, `BufferedReader.readinto(65536)`
returns the data after raw reads of 4,096 and zero bytes; the loop then performs
another EOF read. Unbuffered `FileIO.readinto` needs two raw reads instead of
three. The change retains the reusable 64 KiB buffer, continues after short
reads, and leaves authentication, canonicalization, path containment, and
verification-before-disk rules unchanged. Eight streaming, three path-boundary,
and thirteen API-hardening checks passed, including a new short-read creation
and trusted-verification regression.

The [buffering comparison](results/python-buffering-2026-10-28.json) isolates
old streaming revision `d73f440d436facd8599b9e4148c883cd0b8102f3` from unbuffered
candidate `c1cbf00e1c2298c04c7f45ee8df5e918d4679b8b`. It uses Python 3.13.5,
cryptography 50.0.2, and rfc8785 0.1.4 on the same shared Linux AMD EPYC 9V74
host. All cases and five paired samples per variant were declared before the
run; no unfavorable sample was dropped or repeated.

| Input | Operation | Method | Old / unbuffered ms | Throughput change |
| --- | --- | --- | ---: | ---: |
| One 4 KiB file | Creation | Warmed | 0.103 / 0.101 | +2.04% |
| One 4 KiB file | Verification | Warmed | 0.156 / 0.158 | -1.84% |
| 1,000 × 4 KiB | Creation | Warmed | 27.293 / 26.276 | +3.87% |
| 1,000 × 4 KiB | Verification | Warmed | 54.513 / 52.980 | +2.89% |
| 1 MiB | Creation | Warmed | 1.027 / 1.042 | -1.38% |
| 1 MiB | Verification | Warmed | 1.075 / 1.025 | +4.91% |
| 100 MiB | Creation | Fresh process | 84.920 / 82.336 | +3.14% |
| 100 MiB | Verification | Fresh process | 83.741 / 86.348 | -3.02% |

**No material regression was observed; a single-file verification speedup was
not established.** All 60 warmed batches lasted at least 0.517 seconds, source
hashes stayed unchanged, and cgroup throttling counters did not increase. The
100 MiB fresh-process representative retained median incremental RSS of
102,400 bytes for creation in both variants and 4,096/zero bytes for verification.
Those are high-water observations, not zero-memory claims or a replacement for
the separate 1 GiB memory target.

The warmed run reused the existing driver and workers with two recorded copy
adaptations: measuring Python only and binding the original worker directory.
It had already started when the shared `--runtime` selector became available;
it was retained without a consistency rerun. The tracked summary binds both
driver hashes, worker/package hashes, host observations, medians, and every
external raw-evidence checksum. Raw samples, logs, the counted-read script, and
the adapted driver remain at
`/workspace/proof-ledger-results/python-performance/`. Preserve that directory
when exporting the workspace. This scoped comparison demonstrates removal of
redundant reads without an observed material regression against old streaming;
it does not close the original full throughput criterion against whole-file
hashing.

### Final complete-candidate comparison

The accepted Python unbuffered-read change justified one new complete comparison
against the original whole-file baseline. A detached, built checkout fixed the
candidate at `1e3c049414dc79f26f2947a6d6a5c5d6e377d9d3`; the baseline remained
`232849c4e833da992cbcdcc6fa4b7bd0f56cbde3`. Node production hashing was unchanged.
Changes in other worktrees could not alter this candidate. The same Node
24.19.0, Python 3.13.5, cryptography 50.0.2, and rfc8785 0.1.4 were used.

Exactly one predeclared full fresh-process comparison and one default warmed
diagnostic were run, retaining every sample:

| Criterion | Final observation |
| --- | --- |
| Fresh throughput | 22 of 24 medians met the 10% threshold; all 12 Node comparisons passed. |
| Warmed throughput | All eight default medians met the 10% threshold; every batch exceeded 200 ms. |
| 1 GiB memory | All four creation/verification comparisons passed, with 99.720–100% measured incremental-RSS reduction. |
| Integrity of measurement | Both drivers exited zero; transitive source, emitted modules, and harness hashes stayed unchanged within each run. |

The [final fresh summary](results/final-fresh-2026-10-28.json) retains two misses:

| Runtime | Input | Operation | Baseline / candidate ms | Throughput change |
| --- | --- | --- | ---: | ---: |
| Python | One 4 KiB file | Creation | 0.703 / 0.882 | -20.28% |
| Python | One 4 KiB file | Verification | 0.739 / 1.618 | -54.34% |

The [final warmed summary](results/final-warmed-2026-10-28.json) remains separate:

| Runtime | Input | Creation throughput change | Verification throughput change |
| --- | --- | ---: | ---: |
| Node | 1 MiB | -7.97% | -1.16% |
| Node | 1,000 × 4 KiB | +18.76% | +1.94% |
| Python | One 4 KiB file | -5.13% | +22.99% |
| Python | 1,000 × 4 KiB | +1.22% | -2.05% |

The warmed passes do not erase the fresh misses or prove a cold-operation
guarantee. These methods use a warm page cache; "fresh" describes a new process
and first measured operation. Other project agents paused heavy work, but the
host was still shared without an exclusive reservation. Cgroup throttling
counters did not increase during either run; this does not establish absence
of every form of host interference.

**The full throughput acceptance criterion remains unmet.** No further timing
runs were performed to seek a pass. Another comparison requires a controlled
host or an attributable source change and a declared method; these results do
not justify an unsupported Node rewrite or another buffer-size search.

[Final provenance](results/final-provenance-2026-10-28.json) retains exact source
and transitive emitted/Python module hashes, harness identities, observation
times, host state, and raw-file checksums. Raw results, logs, and the reproduction
wrapper are exported separately at
`/workspace/proof-ledger-results/performance/final-2026-10-28/evidence-2026-10-28.tar.gz`,
with `EVIDENCE_SHA256SUMS` alongside it. Preserve this final bundle in addition to
the earlier profiling/variant evidence when moving the workspace.

### Hosted acceptance — October 28, 2026

**All 24 throughput medians and all four 1 GiB memory comparisons met the
declared targets in one fresh GitHub Actions job.** The
[source-bound hosted report](results/hosted-ci-2026-10-28.json) records the actual
observations from [job 123121759113](https://github.com/nymrel/nymrel-proof-ledger/actions/runs/40774966293/job/123121759113),
not an inferred result from the job's success status. Throughput changes ranged
from -8.27% to +73.56%; none exceeded the 10% material-regression threshold.

The actual checkout was `65c8bd113c36cd8f813bfd0447010a771771eb16`, GitHub's
test merge of PR44 head `e5b62523bed7b48d7a92e9b8965cd6af56eb1211` with main
`b8bbf4b8278cbcc4fe80c6ad3fbdb3350d017aa5`, which includes concurrent checkpoint
PR43. The baseline remained `232849c4e833da992cbcdcc6fa4b7bd0f56cbde3`.
Before/after transitive source, emitted-module and harness hashes matched.

Both sources ran on the same Ubuntu 24.04 job VM with Node 24.22.1, Python
3.13.17, cryptography 50.0.2, and rfc8785 0.1.4. The four-CPU VM reported an AMD
EPYC 9V45 CPU. The unchanged fresh-process harness ran five pairs for each case,
baseline first in each pair, warming input bytes in the page cache before every
worker. No other tests ran within the benchmark job during timing.

| 1 GiB operation | Throughput change | Incremental peak-RSS reduction |
| --- | ---: | ---: |
| Node creation | +66.16% | 99.624% |
| Node verification | +61.69% | 99.708% |
| Python creation | +73.37% | 100% measured |
| Python verification | +73.56% | 100% measured |

Zero measured RSS growth remains a high-water observation, not zero memory use.
The job's CPU and memory limit files were unavailable; they are not interpreted
as unlimited resources. Effective CPUs were 0–3, throttling counters stayed at
zero, and CPU-pressure observations were present and nonzero. A fresh job VM
does not establish exclusive physical hardware. Runtime patches also differ
from the workspace measurements, so this outcome cannot be attributed solely
to the execution environment.

This run satisfies the stated measured matrix criteria for its exact source,
runtime pair, host, and method. It does not establish every-host or every-runtime
guarantees, cold-cache performance, or an individual-operation bound. Earlier
workspace failures, including the final Python single-file misses, remain
recorded above; this result does not rewrite or causally fix those observations.
No unchanged measurement was rerun after this result.

The successful upload retains all raw samples, compact summary, metadata,
before/after checksums and logs in
[artifact 12855070119](https://github.com/nymrel/nymrel-proof-ledger/actions/runs/40774966293/artifacts/12855070119)
until January 26, 2027 at 21:48:27 UTC. Its provider-reported SHA-256 digest is
`edde42066ea25534b9ede314082fa0fdbfad96cd754466e012339e31a3b9eee4`.
The compact report and decoded job log were inspected; the ZIP digest was not
independently rehashed in this read. Registry publication and independent
adoption remain separate outcomes.

# Benchmarks

These benchmarks compare `zerosearch-node` against the Python
[`zerosearch`](../../zerosearch) library on the **same corpus** and the **same
queries**, so the numbers are directly comparable.

## How the comparison stays fair

- **Same documents.** Both runners read the Simple English Wikipedia JSONL
  samples that live in the Python repo
  (`../zerosearch/benchmarks/data/simplewiki_{1000,10000}.jsonl`).
- **Same queries.** Python's query sampling is deterministic
  (`random.Random(42)`). `gen_queries.py` calls the Python benchmark's own
  `make_queries` and dumps the result to `benchmarks/data/queries_*.json`. The
  Node runner reads that file; the Python runner regenerates the identical list
  internally. Both sides execute the exact same query workload.
- **Same index shape.** A single `text` field, `num_results=10` per search, one
  warmup query before timing.

The two libraries also rank **identically** (same tokenizer, BM25-lite math, and
tie-breaks) — that guarantee is enforced by the parity tests in `tests/`, not by
these benchmarks. Benchmarks measure speed and footprint only.

## Running

```bash
# 1. Dump the shared query workload (needs the Python repo + uv)
cd ../zerosearch
uv run python ../zerosearch-node/benchmarks/gen_queries.py \
  --input benchmarks/data/simplewiki_10000.jsonl --num-docs 10000 \
  --num-queries 100000 \
  --output ../zerosearch-node/benchmarks/data/queries_10000_100k.json

# 2. Node side
cd ../zerosearch-node
npm run bench -- \
  --input ../zerosearch/benchmarks/data/simplewiki_10000.jsonl \
  --queries benchmarks/data/queries_10000_100k.json \
  --num-docs 10000 --num-queries 100000 --label node_10000_100k

# 3. Python side (same docs + same seed = same queries)
cd ../zerosearch
uv run python benchmarks/simplewiki_benchmark.py \
  --input benchmarks/data/simplewiki_10000.jsonl \
  --num-docs 10000 --num-queries 100000 --label py_10000_100k
```

`npm run bench` runs Node with `--expose-gc` so the build-memory delta is
measured after a forced GC.

## Results on this machine

Node v24.13.1, Python 3.13, both `zerosearch` 0.4.0.

### Build time

`fit()` over the `text` field. Node is faster, but **not** by the ~8x the raw
runner output suggests.

> ⚠️ **The Python runner times `fit` while `tracemalloc` is running**, which
> traces every allocation and slows the build ~4x (8.4 s → 34.2 s on the 10k
> sample, measured directly). The Node runner has no equivalent instrumentation,
> so comparing the two runners' printed `build_seconds` is apples-to-oranges.
> The table below uses Python's build time measured **without** tracemalloc,
> averaged over 3 runs, for a fair comparison.

| sample | Python build (no tracemalloc) | Node build | speedup |
|---:|---:|---:|---:|
| 10,000 docs | ~8.4–9.0 s | ~4.7–4.9 s | **~1.8x** |

The real ~1.8x advantage comes almost entirely from the **tokenizer**, which
dominates build (the pack step is ~0.5 s). Tokenizing all 10k docs' text in
isolation:

| | tokens/sec | time (7.19M tokens) |
|---|---:|---:|
| Python (CPython 3.13) | 1.85 M/s | 3.88 s |
| Node (V8) | 5.66 M/s | 1.27 s |

The algorithm is identical (same `TOKEN_RE`, `.lower()`, stop-word filter). V8
JIT-compiles the per-token regex/lowercase/filter loop to native code; CPython
runs it as interpreted bytecode with per-token call overhead (`re.Match.group`,
`str.lower`, set membership, generator stepping), so the same loop is ~3x
slower. The rest of `fit` (Counter, dict, array packing) is comparable between
the two.

### Search latency

100 queries is noisy; the 100,000-query run is the stable measurement. Search
performance is essentially a **wash** — Node has a lower median, Python a
slightly tighter tail, throughput is within noise of each other.

| sample / queries | metric | Python | Node |
|---|---|---:|---:|
| 10,000 docs / 100 q | avg | 0.401 ms | 0.303 ms |
| | median | 0.118 ms | 0.061 ms |
| | p95 | 1.613 ms | 1.225 ms |
| | qps | 2,495 | 3,302 |
| 10,000 docs / 100,000 q | avg | 0.348 ms | 0.367 ms |
| | median | 0.093 ms | 0.062 ms |
| | p95 | 1.613 ms | 1.787 ms |
| | qps | 2,875 | 2,726 |

### Footprint

The serialized JSON artifact is the same size (the format is identical), as
expected. Build-memory numbers are **not** directly comparable: Python uses
`tracemalloc` (Python-object allocations), Node reports process RSS / V8 heap
deltas, which include interpreter overhead and unreclaimed garbage.

| sample | serialized (Python) | serialized (Node) |
|---:|---:|---:|
| 1,000 docs | 14.7 MB | 14.5 MB |
| 10,000 docs | 101.4 MB | 102.9 MB |

## Takeaways

- **Build is a modest Node win — ~1.8x, not 8x.** The raw runner output shows
  ~8x only because the Python runner times `fit` under `tracemalloc`. Measured
  fairly, Node builds ~1.8x faster, driven by a ~3x-faster tokenizer (V8 JIT vs
  CPython interpreted bytecode).
- **Search latency is a tie** — sub-millisecond medians on both, with Node
  winning the median and Python winning the tail. Differences are within
  run-to-run noise.
- **The shipped index is the same size** in both languages.

## Caveats

- Numbers are single-run on one machine; expect a few percent of jitter,
  especially on the 100-query runs. Prefer the 100k-query latency numbers.
- Python build memory is `tracemalloc` peak; Node build memory is an RSS/heap
  delta after a forced GC. Treat them as separate, not as a head-to-head.
- `total_text_chars` differs by a few dozen characters between the two runners:
  JS `String.length` counts UTF-16 code units while Python `len()` counts code
  points. This is cosmetic and does not affect tokenization or ranking.

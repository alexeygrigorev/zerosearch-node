#!/usr/bin/env python3
"""Dump the exact query workload the Python benchmark generates.

Both the Python and Node benchmarks use this file so they run the *same*
queries on the *same* documents. Python's query sampling is deterministic
(``random.Random(42)``), so the dumped list is byte-for-byte the list the
Python benchmark builds internally.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Reuse make_queries / load_docs from the sibling Python benchmark.
PY_BENCH = Path(__file__).resolve().parents[2] / "zerosearch" / "benchmarks"
sys.path.insert(0, str(PY_BENCH))

from simplewiki_benchmark import load_docs, make_queries  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, required=True)
    ap.add_argument("--num-docs", type=int, default=None)
    ap.add_argument("--num-queries", type=int, default=100)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()

    docs = load_docs(args.input, args.num_docs)
    queries = make_queries(docs, args.num_queries)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(queries), encoding="utf-8")
    print(f"wrote {len(queries)} queries -> {args.output}")


if __name__ == "__main__":
    main()

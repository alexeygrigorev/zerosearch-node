#!/usr/bin/env python3
"""Generate the cross-language parity fixture from the *Python* zerosearch lib.

This script imports the upstream Python ``zerosearch`` (read-only; it does not
modify it), builds an index over a deterministic corpus, and writes a single
JSON fixture that the Node test suite consumes. The fixture contains:

* ``docs``     - the corpus (so Node can rebuild the index with ``fit``),
* ``cases``    - query/filter/boost combos with the Python top-k results,
* ``index``    - the index serialized in the *portable JSON format* that
                 ``zerosearch-node`` reads (see FORMAT.md). It is produced here
                 by reading the Python index's packed internal arrays, which is
                 exactly the reader/writer the Python library still needs.

Run:  uv run --no-project python scripts/gen_fixture.py
  or: PYTHONPATH=~/git/zerosearch python3 scripts/gen_fixture.py
"""

from __future__ import annotations

import json
import os
import random
import sys
from array import array
from pathlib import Path

# Import the upstream Python library without installing it.
ZEROSEARCH_SRC = os.path.expanduser("~/git/zerosearch")
if ZEROSEARCH_SRC not in sys.path:
    sys.path.insert(0, ZEROSEARCH_SRC)

from zerosearch import Index  # noqa: E402

VOCAB = (
    "docker compose kafka consumer python pandas merge join spark airflow "
    "mlflow conda pip env error deadline homework capstone node.js c++ "
    "f-string postgres sql index query group network container"
).split()
COURSES = ["de", "mlops", "ml", ""]
TEXT_FIELDS = ["title", "text"]
KEYWORD_FIELDS = ["id", "course", "kind"]

QUERIES = [
    "docker compose",
    "kafka kafka consumer",
    "pandas merge join",
    "mlflow",
    "python pip conda env error",
    "node.js c++ f-string",
    "deadline homework homework",
    "spark airflow",
    "zzz totally unknown term",
    "",
]
FILTERS = [None, {"course": "de"}, {"course": "mlops", "kind": "faq"}, {"course": "nope"}]
BOOSTS = [None, {"title": 3.0}, {"title": 0.5, "text": 2.0}]


def make_corpus(n: int = 200, seed: int = 7) -> list[dict]:
    rng = random.Random(seed)
    docs = []
    for i in range(n):
        title = " ".join(rng.choice(VOCAB) for _ in range(rng.randint(1, 4)))
        text = " ".join(rng.choice(VOCAB) for _ in range(rng.randint(3, 30)))
        docs.append(
            {
                "id": f"d{i}",
                "title": title,
                "text": text,
                "course": rng.choice(COURSES),
                "kind": rng.choice(["faq", "lesson"]),
                "meta": {"n": i},
            }
        )
    return docs


def to_portable_json(index: Index) -> dict:
    """Read the Python index's packed internal state into the portable format.

    This is the byte-for-byte logical equivalent of what a Node-compatible
    ``save`` on the Python side would emit (see FORMAT.md).
    """
    keyword_index = {
        field: {value: sorted(ids) for value, ids in values.items()}
        for field, values in index._keyword_index.items()
    }
    return {
        "magic": "zerosearch",
        "format": "json-1",
        "text_fields": list(index.text_fields),
        "keyword_fields": list(index.keyword_fields),
        "stop_words": sorted(index._stop_words),
        "n_fields": index._n_fields,
        "docs": index.docs,
        "vocab": list(index._vocab),
        "post_off": list(index._post_off),
        "post_doc": list(index._post_doc),
        "post_field": list(index._post_field),
        "post_tf": list(index._post_tf),
        "doc_freq": list(index._doc_freq),
        "lengths": list(index._lengths),
        "keyword_index": keyword_index,
    }


def main() -> None:
    corpus = make_corpus()
    index = Index(text_fields=TEXT_FIELDS, keyword_fields=KEYWORD_FIELDS).fit(corpus)

    cases = []
    for query in QUERIES:
        for filter_dict in FILTERS:
            for boost in BOOSTS:
                results = index.search(
                    query, filter_dict=filter_dict, boost_dict=boost, num_results=10
                )
                cases.append(
                    {
                        "query": query,
                        "filter": filter_dict,
                        "boost": boost,
                        "expected": [[r["id"], r["score"]] for r in results],
                    }
                )

    fixture = {
        "source": "python zerosearch",
        "text_fields": TEXT_FIELDS,
        "keyword_fields": KEYWORD_FIELDS,
        "docs": corpus,
        "cases": cases,
        "index": to_portable_json(index),
    }

    out = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "parity.json"
    out.write_text(json.dumps(fixture, ensure_ascii=False))
    print(f"wrote {out} ({out.stat().st_size} bytes, {len(cases)} cases)")


if __name__ == "__main__":
    main()

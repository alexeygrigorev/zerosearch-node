# zerosearch portable index format (`json-1`)

This document defines the **language-neutral** on-disk format that
`zerosearch-node` reads and writes with `Index.save` / `Index.load` (and the
in-memory `dumps` / `loads`). It exists so an index built in one language can be
loaded and searched in another.

## Why a new format

The upstream Python `zerosearch` library serializes with
[`marshal`](https://docs.python.org/3/library/marshal.html). `marshal` is:

- **Python-only** — there is no Node/JS reader for it.
- **Version-pinned** — the Python loader refuses to load a blob written by a
  different `major.minor` interpreter.
- **Platform-pinned** — it records and verifies the C `array` item sizes.

So the existing `.zsx` artifact is not portable across languages (or even across
Python versions). To meet the cross-language requirement, `zerosearch-node`
defines this `json-1` format, which captures the **same logical index state** in
plain JSON.

## File contents

A single JSON object (UTF-8). All fields are required.

| key             | type                                  | meaning |
|-----------------|---------------------------------------|---------|
| `magic`         | `"zerosearch"`                        | identifies the artifact |
| `format`        | `"json-1"`                            | format version tag |
| `text_fields`   | `string[]`                            | ranked fields, in field order |
| `keyword_fields`| `string[]`                            | exact-match filter fields |
| `stop_words`    | `string[]` (sorted)                   | stop words used at build time |
| `n_fields`      | `number`                              | `text_fields.length` |
| `docs`          | `object[]`                            | the original documents, in doc-id order (doc id = array index) |
| `vocab`         | `string[]` (sorted)                   | term `i` has term-id `i` |
| `post_off`      | `number[]` (length `vocab.length+1`)  | CSR offsets: term `t`'s postings are `[post_off[t], post_off[t+1])` |
| `post_doc`      | `number[]`                            | postings: document id |
| `post_field`    | `number[]`                            | postings: text-field index |
| `post_tf`       | `number[]`                            | postings: term frequency in that doc+field |
| `doc_freq`      | `number[]` (length `vocab.length`)    | document frequency per term |
| `lengths`       | `number[]` (length `docs.length * n_fields`) | field length at `doc_id * n_fields + field_index` |
| `keyword_index` | `{ [field]: { [value]: number[] } }`  | per keyword field, value -> sorted doc ids |

### Postings (CSR layout)

The three parallel arrays `post_doc` / `post_field` / `post_tf` form a
compressed-sparse-row postings list. For term id `t`, iterate
`j` from `post_off[t]` to `post_off[t+1]`; each `j` is a posting
`(post_doc[j], post_field[j], post_tf[j])`. Within a term, postings are sorted
by `(doc_id, field_index, tf)` so that tied scores fall back to document order.

### Invariants

- `docs` order **is** the doc-id space: document `k` is `docs[k]`.
- `vocab` is sorted ascending (by code point); a term's id is its position.
- `keyword_index[field][value]` lists are sorted ascending.
- Field values are string-coerced before indexing/filtering (the equivalent of
  Python `str(value)` / JS `String(value)`), and a missing field is `""`.

## Scoring reproduced from this state

Ranking is BM25-lite (identical in both languages):

```
idf(term)          = log(1 + (N - df + 0.5) / (df + 0.5))
contribution(d,f)  = boost[f] * idf(term) * qtf(term) * (tf / sqrt(field_length))
score(d)           = sum of contributions over query terms and text fields
```

where `N` is the candidate-document count (the whole corpus, or the filtered
subset), `df` is the document frequency over that candidate set, `qtf` is the
query-term frequency, and `boost[f]` defaults to `1.0`. Results are ranked by
`(score desc, doc_id asc)`. There is no `k1`/`b` term-saturation — that is what
"BM25-lite" means here: BM25's IDF combined with a Lucene-style
`tf / sqrt(field_length)` normalization.

## Interop status

- `zerosearch-node` reads and writes `json-1` natively.
- The Python `zerosearch` library does **not** yet read or write `json-1`; it
  still uses `marshal`. A matching reader/writer needs to be added there for a
  Python-built index to load in Node directly (and vice versa). The repository's
  `scripts/gen_fixture.py` shows the exact, read-only mapping from the Python
  index's internal arrays to `json-1` — it is the reference for that future
  Python-side implementation.

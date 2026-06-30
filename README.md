# zerosearch-node

A tiny, **zero-dependency** BM25-lite in-memory text search index for
TypeScript/Node — a faithful port of the Python
[`zerosearch`](https://github.com/alexeygrigorev/zerosearch) library.

Documents are plain objects. Text fields are tokenized once when the index is
built and kept as an inverted index, so a query only scores the documents that
actually contain a query term. The runtime has **no third-party dependencies**.

## Cross-language compatibility

This is the headline feature: `zerosearch-node` and Python `zerosearch` rank
identically (same tokenizer, same BM25-lite math, same tie-breaks), and they
share a **portable, language-neutral JSON index format** (`json-1`, documented
in [`FORMAT.md`](./FORMAT.md)). An index serialized in that format can be built
in one language and searched in the other.

The cross-language guarantee is enforced by a parity test: the fixture in
`tests/fixtures/parity.json` is produced by the **Python** library
(`scripts/gen_fixture.py`), and the Node test suite asserts that loading that
Python-built index — and re-fitting the same corpus — reproduces Python's
top-k results (ids and scores within `1e-9`) for 120 query/filter/boost cases.

> Note: the upstream Python library currently serializes with `marshal`
> (Python-only), so it does not yet read/write `json-1` directly. `FORMAT.md`
> and `scripts/gen_fixture.py` specify exactly what a matching Python-side
> reader/writer needs to do.

## Install

```bash
npm install zerosearch-node
```

## Usage

```ts
import { Index } from "zerosearch-node";

const docs = [
  { id: "1", title: "Docker compose basics", text: "how to start services", course: "de" },
  { id: "2", title: "Kafka consumers", text: "consumer groups explained", course: "de" },
];

const index = new Index(
  ["title", "text"],   // text fields (tokenized + ranked)
  ["id", "course"],    // keyword fields (exact-match filtering)
);
index.fit(docs);

const results = index.search(
  "how do I start docker compose",
  { course: "de" },              // filter: scalar = exact, array = IN
  { title: 3.0, text: 1.0 },     // per-field boosts
  5,                             // num results
);

for (const r of results) console.log(r.score, r.title);
```

Each result is a shallow copy of the original document with an added `score`.

### API

- `new Index(textFields, keywordFields?, { stopWords?, tokenizer? })`
- `index.fit(docs)` → `this`
- `index.search(query, filterDict?, boostDict?, numResults = 10)` → `results`
- `tokenize(text, stopWords?)`, `DEFAULT_STOP_WORDS`, `TOKEN_RE`, `VERSION`

### Filtering

A `filterDict` value can be a scalar (exact match) or an array (IN / OR within
that field). Filters on different fields combine with AND.

```ts
index.search("docker", { course: "de" });                       // course === "de"
index.search("docker", { course: ["de", ""] });                 // course === "de" OR ""
index.search("docker", { course: ["de", "mlops"], kind: "faq" }); // (de OR mlops) AND faq
```

## Saving & loading a prebuilt index

`fit()` does the tokenization up front. Build the index once (e.g. in CI) and
ship the artifact so the consumer loads in milliseconds without re-tokenizing.

```ts
// build step
new Index(["title", "text"], ["id", "course"]).fit(docs).save("index.zsj");

// runtime
const index = Index.load("index.zsj");
const results = index.search("docker compose");
```

`dumps()` / `loads()` are the in-memory equivalents (return/accept a JSON
string). The artifact is portable `json-1` JSON — see [`FORMAT.md`](./FORMAT.md).
If you built with a **custom tokenizer**, resupply it on load:
`Index.load("index.zsj", { tokenizer: myTokenizer })`.

## How it works

- **Tokenizer** — lowercased word/number tokens; keeps `+ . # _ -` *inside* a
  token so `c++`, `node.js`, `f-string` survive (a token must start with a
  letter/digit). Drops 1-character tokens and a small English stop-word list
  (both overridable).
- **Inverted index** — built once in `fit()` and compacted into flat CSR
  postings arrays, so search only scores documents that contain a query term.
- **Ranking** — BM25-lite: each query term contributes
  `boost * idf * (term_frequency / sqrt(field_length))` per field, with
  `idf = log(1 + (N - df + 0.5) / (df + 0.5))`. IDF and document frequencies are
  computed over the filtered candidate set. Ties break by document order. There
  is no `k1`/`b` saturation term.

## Development

```bash
npm install
npm run typecheck
npm test          # node:test, includes the cross-language parity suite
npm run build     # tsc -> dist/

# regenerate the parity fixture from the Python library:
PYTHONPATH=~/git/zerosearch python3 scripts/gen_fixture.py
```

## License

WTFPL.

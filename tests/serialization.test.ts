import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

import { Index, tokenize, DEFAULT_STOP_WORDS } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "parity.json");

interface Fixture {
  text_fields: string[];
  keyword_fields: string[];
  docs: Array<Record<string, unknown>>;
  cases: Array<{
    query: string;
    filter: Record<string, unknown> | null;
    boost: Record<string, number> | null;
    expected: Array<[string, number]>;
  }>;
  index: Record<string, unknown>;
}

const fixture: Fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

// --- independent brute-force oracle (mirrors the Python reference) ---------

function bruteForce(
  docs: Array<Record<string, unknown>>,
  textFields: string[],
  query: string,
  filterDict: Record<string, unknown> | null,
  boostDict: Record<string, number> | null,
  numResults = 10,
): Array<[unknown, number]> {
  const filters = filterDict ?? {};
  const boosts = boostDict ?? {};
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const queryTf = new Map<string, number>();
  for (const t of queryTerms) queryTf.set(t, (queryTf.get(t) ?? 0) + 1);

  let candidates: Set<number>;
  if (Object.keys(filters).length > 0) {
    let acc: Set<number> | null = null;
    for (const [field, value] of Object.entries(filters)) {
      const matched = new Set<number>();
      docs.forEach((d, i) => {
        if (String(d[field] ?? "") === String(value)) matched.add(i);
      });
      acc = acc === null ? matched : new Set([...acc].filter((i) => matched.has(i)));
    }
    candidates = acc ?? new Set();
    if (candidates.size === 0) return [];
  } else {
    candidates = new Set(docs.map((_, i) => i));
  }

  const documentCount = candidates.size;
  const tokensByDoc = new Map<number, Map<string, string[]>>();
  for (const i of candidates) {
    const byField = new Map<string, string[]>();
    for (const f of textFields) byField.set(f, tokenize(String(docs[i][f] ?? "")));
    tokensByDoc.set(i, byField);
  }

  const documentFrequencies = new Map<string, number>();
  for (const term of queryTf.keys()) {
    let df = 0;
    for (const byField of tokensByDoc.values()) {
      if (textFields.some((f) => byField.get(f)!.includes(term))) df += 1;
    }
    if (df) documentFrequencies.set(term, df);
  }
  const idf = new Map<string, number>();
  for (const [t, df] of documentFrequencies) {
    idf.set(t, Math.log(1 + (documentCount - df + 0.5) / (df + 0.5)));
  }

  const scores = new Map<number, number>();
  for (const [i, byField] of tokensByDoc) {
    let score = 0;
    for (const field of textFields) {
      const fieldTokens = byField.get(field)!;
      if (fieldTokens.length === 0) continue;
      const counts = new Map<string, number>();
      for (const t of fieldTokens) counts.set(t, (counts.get(t) ?? 0) + 1);
      const norm = Math.sqrt(fieldTokens.length);
      const boost = boosts[field] === undefined ? 1.0 : Number(boosts[field]);
      for (const term of queryTerms) {
        if (idf.has(term) && counts.get(term)) {
          score += boost * idf.get(term)! * (counts.get(term)! / norm);
        }
      }
    }
    if (score > 0) scores.set(i, score);
  }

  const ranked = [...scores.keys()].sort((a, b) => scores.get(b)! - scores.get(a)! || a - b);
  return ranked.slice(0, numResults).map((i) => [docs[i].id, round9(scores.get(i)!)]);
}

const round9 = (x: number) => Math.round(x * 1e9) / 1e9;

const keyed = (results: Array<Record<string, unknown>>): Array<[unknown, number]> =>
  results.map((r) => [r.id, round9(r.score as number)]);

// --- a deterministic corpus mirroring the Python serialization test --------

const VOCAB =
  ("docker compose kafka consumer python pandas merge join spark airflow " +
    "mlflow conda pip env error deadline homework capstone node.js c++ " +
    "f-string postgres sql index query group network container").split(" ");
const COURSES = ["de", "mlops", "ml", ""];
const TEXT_FIELDS = ["title", "text"];
const KEYWORD_FIELDS = ["id", "course", "kind"];

// A small deterministic PRNG (we only need reproducibility, not Python parity).
function makeCorpus(n = 200, seed = 12345): Array<Record<string, unknown>> {
  let state = seed >>> 0;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const docs = [];
  for (let i = 0; i < n; i++) {
    const title = Array.from({ length: between(1, 4) }, () => pick(VOCAB)).join(" ");
    const text = Array.from({ length: between(3, 30) }, () => pick(VOCAB)).join(" ");
    docs.push({
      id: `d${i}`,
      title,
      text,
      course: pick(COURSES),
      kind: pick(["faq", "lesson"]),
      meta: { n: i },
    });
  }
  return docs;
}

const corpus = makeCorpus();
const builtIndex = new Index(TEXT_FIELDS, KEYWORD_FIELDS).fit(corpus);

const QUERIES = [
  "docker compose",
  "kafka kafka consumer",
  "pandas merge join",
  "mlflow",
  "python pip conda env error",
  "node.js c++ f-string",
  "spark airflow",
  "zzz totally unknown term",
];
const FILTERS = [null, { course: "de" }, { course: "mlops", kind: "faq" }, { course: "nope" }];
const BOOSTS = [null, { title: 3.0 }, { title: 0.5, text: 2.0 }];

describe("packed scorer matches the brute-force oracle", () => {
  for (const query of QUERIES) {
    for (const filter of FILTERS) {
      it(`query=${JSON.stringify(query)} filter=${JSON.stringify(filter)}`, () => {
        for (const boost of BOOSTS) {
          const got = keyed(builtIndex.search(query, filter, boost, 10));
          const want = bruteForce(corpus, TEXT_FIELDS, query, filter, boost, 10);
          assert.deepEqual(got, want);
        }
      });
    }
  }
});

describe("save / load round-trips", () => {
  it("loads round-trip is identical", () => {
    const restored = Index.loads(builtIndex.dumps());
    for (const query of QUERIES) {
      for (const filter of FILTERS) {
        assert.deepEqual(keyed(restored.search(query, filter)), keyed(builtIndex.search(query, filter)));
      }
    }
  });

  it("save/load file round-trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "zsn-"));
    const path = join(dir, "index.zsj");
    builtIndex.save(path);
    const restored = Index.load(path);
    assert.deepEqual(
      keyed(restored.search("docker compose", null, { title: 3.0 })),
      keyed(builtIndex.search("docker compose", null, { title: 3.0 })),
    );
  });

  it("round-trip preserves docs and fields", () => {
    const restored = Index.loads(builtIndex.dumps());
    assert.deepEqual(restored.docs, builtIndex.docs);
    assert.deepEqual(restored.textFields, builtIndex.textFields);
    assert.deepEqual(restored.keywordFields, builtIndex.keywordFields);
    assert.deepEqual((restored.docs[0] as { meta: unknown }).meta, { n: 0 });
  });

  it("empty index round-trips", () => {
    const empty = new Index(["title"], ["course"]);
    const restored = Index.loads(empty.dumps());
    assert.deepEqual(restored.search("docker"), []);
    const restored2 = Index.loads(new Index(["title"]).fit([{ id: "1", title: "docker" }]).dumps());
    assert.deepEqual(restored2.search("docker").map((r) => r.id), ["1"]);
  });

  it("custom stop words survive round-trip", () => {
    const index = new Index(["text"], null, { stopWords: ["docker"] }).fit([{ id: "1", text: "docker kafka" }]);
    const restored = Index.loads(index.dumps());
    assert.deepEqual(restored.search("docker"), []);
    assert.deepEqual(restored.search("kafka").map((r) => r.id), ["1"]);
  });

  it("custom tokenizer must be resupplied on load", () => {
    const splitter = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);
    const index = new Index(["title"], null, { tokenizer: splitter }).fit([{ id: "1", title: "the answer" }]);
    assert.deepEqual(index.search("the").map((r) => r.id), ["1"]);
    const defaultReload = Index.loads(index.dumps());
    assert.deepEqual(defaultReload.search("the"), []); // "the" is a default stop word
    const sameReload = Index.loads(index.dumps(), { tokenizer: splitter });
    assert.deepEqual(sameReload.search("the").map((r) => r.id), ["1"]);
  });
});

describe("load guards", () => {
  it("rejects non-index payloads", () => {
    assert.throws(() => Index.loads(JSON.stringify({ hello: "world" })), /not a zerosearch index/);
  });

  it("rejects unknown format version", () => {
    const state = JSON.parse(builtIndex.dumps());
    state.format = "json-999";
    assert.throws(() => Index.loads(JSON.stringify(state)), /unsupported zerosearch index format/);
  });
});

// --- THE cross-language parity test ----------------------------------------
// Results below come from running the *Python* zerosearch library (see
// scripts/gen_fixture.py). They must match what zerosearch-node produces.

describe("cross-language parity with Python zerosearch", () => {
  const TOL = 1e-9;

  const matches = (
    got: Array<Record<string, unknown>>,
    expected: Array<[string, number]>,
  ): void => {
    assert.equal(got.length, expected.length, "result count differs");
    for (let i = 0; i < expected.length; i++) {
      assert.equal(got[i].id, expected[i][0], `id mismatch at rank ${i}`);
      const diff = Math.abs((got[i].score as number) - expected[i][1]);
      assert.ok(diff < TOL, `score mismatch at rank ${i}: ${got[i].score} vs ${expected[i][1]} (diff ${diff})`);
    }
  };

  it("loads the Python-built portable index and matches every case", () => {
    // Load the index serialized by the Python library into the portable format.
    const loaded = Index.fromJSON(fixture.index as never);
    for (const c of fixture.cases) {
      matches(loaded.search(c.query, c.filter, c.boost, 10), c.expected);
    }
  });

  it("re-fitting the Python corpus in Node matches Python's results", () => {
    const node = new Index(fixture.text_fields, fixture.keyword_fields).fit(fixture.docs);
    for (const c of fixture.cases) {
      matches(node.search(c.query, c.filter, c.boost, 10), c.expected);
    }
  });

  it("loads a NATIVE Python zerosearch.save() artifact and matches every case", () => {
    // py-native.zsx is the raw marshal blob written by the Python library.
    const loaded = Index.load(join(here, "fixtures", "py-native.zsx"));
    for (const c of fixture.cases) {
      matches(loaded.search(c.query, c.filter, c.boost, 10), c.expected);
    }
  });

  it("native marshal load preserves nested document values", () => {
    const loaded = Index.load(join(here, "fixtures", "py-native.zsx"));
    assert.deepEqual((loaded.docs[0] as { meta: unknown }).meta, { n: 0 });
    assert.equal(loaded.docs.length, fixture.docs.length);
  });

  it("sanity: stop words in the Python index match the Node default", () => {
    assert.deepEqual((fixture.index as { stop_words: string[] }).stop_words, [...DEFAULT_STOP_WORDS].sort());
  });
});

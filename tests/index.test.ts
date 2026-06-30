import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  Index,
  tokenize,
  DEFAULT_STOP_WORDS,
  TOKEN_RE,
  VERSION,
} from "../src/index.ts";

const DOCS = [
  { id: "1", title: "Docker compose basics", text: "how to start services with docker", course: "de" },
  { id: "2", title: "Kafka consumers", text: "consumer groups explained in kafka", course: "de" },
  { id: "3", title: "Docker networking", text: "containers talk over a docker network", course: "mlops" },
  { id: "4", title: "Pandas joins", text: "merge and join dataframes", course: "ml" },
];

const makeIndex = () =>
  new Index(["title", "text"], ["id", "course"]).fit(DOCS);

const ids = (results: Array<Record<string, unknown>>) => results.map((r) => r.id);

describe("tokenize", () => {
  it("keeps technical tokens", () => {
    assert.deepEqual(tokenize("Node.js and C++ with f-strings"), ["node.js", "c++", "f-strings"]);
  });

  it("normalizes supported token shapes", () => {
    assert.deepEqual(tokenize("Python 3.11, C#, foo_bar, e-mail"), ["python", "3.11", "c#", "foo_bar", "e-mail"]);
    assert.deepEqual(tokenize(".env +leading #tag"), ["env", "leading", "tag"]);
    assert.deepEqual(tokenize("HELLO hello HeLLo"), ["hello", "hello", "hello"]);
  });

  it("drops stop words and single chars", () => {
    assert.ok(!tokenize("the a docker").includes("the"));
    assert.deepEqual(tokenize("a I"), []);
  });

  it("accepts any stop-word iterable", () => {
    assert.deepEqual(tokenize("alpha beta gamma", ["alpha", "gamma"]), ["beta"]);
  });
});

describe("search behavior", () => {
  it("returns nothing before fit", () => {
    assert.deepEqual(new Index(["title"]).search("docker"), []);
  });

  it("fit returns self", () => {
    const index = new Index(["title"]);
    assert.equal(index.fit(DOCS), index);
  });

  it("empty query returns nothing", () => {
    assert.deepEqual(makeIndex().search(""), []);
    assert.deepEqual(makeIndex().search("   "), []);
  });

  it("basic ranking finds the relevant doc", () => {
    const results = makeIndex().search("docker compose", null, null, 5);
    assert.ok(results.length > 0);
    assert.equal(results[0].id, "1");
    assert.ok(results.every((r) => "score" in r));
  });

  it("results are sorted by score desc", () => {
    const scores = makeIndex().search("docker", null, null, 5).map((r) => r.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });

  it("keyword filter restricts candidates", () => {
    const results = makeIndex().search("docker", { course: "mlops" }, null, 5);
    assert.deepEqual(ids(results), ["3"]);
  });

  it("keyword filters are intersected (AND)", () => {
    const docs = [
      { id: "1", title: "docker", course: "de", kind: "lesson" },
      { id: "2", title: "docker", course: "de", kind: "faq" },
      { id: "3", title: "docker", course: "mlops", kind: "faq" },
    ];
    const index = new Index(["title"], ["course", "kind"]).fit(docs);
    const results = index.search("docker", { course: "de", kind: "faq" });
    assert.deepEqual(ids(results), ["2"]);
  });

  it("list filter value matches any (IN)", () => {
    const docs = [
      { id: "1", title: "docker", course: "de" },
      { id: "2", title: "docker", course: "mlops" },
      { id: "3", title: "docker", course: "ml" },
      { id: "4", title: "docker", course: "" },
    ];
    const index = new Index(["title"], ["course"]).fit(docs);
    const results = index.search("docker", { course: ["de", ""] }, null, 5);
    assert.deepEqual(ids(results).sort(), ["1", "4"]);
  });

  it("list filter value is union not intersection", () => {
    const docs = [
      { id: "1", title: "docker", course: "de" },
      { id: "2", title: "docker", course: "mlops" },
    ];
    const index = new Index(["title"], ["course"]).fit(docs);
    const results = index.search("docker", { course: ["de", "mlops"] }, null, 5);
    assert.deepEqual(ids(results).sort(), ["1", "2"]);
  });

  it("list filter combines with other fields via AND", () => {
    const docs = [
      { id: "1", title: "docker", course: "de", kind: "faq" },
      { id: "2", title: "docker", course: "mlops", kind: "faq" },
      { id: "3", title: "docker", course: "de", kind: "lesson" },
    ];
    const index = new Index(["title"], ["course", "kind"]).fit(docs);
    const results = index.search("docker", { course: ["de", "mlops"], kind: "faq" });
    assert.deepEqual(ids(results).sort(), ["1", "2"]);
  });

  it("empty list filter matches nothing", () => {
    assert.deepEqual(makeIndex().search("docker", { course: [] }), []);
  });

  it("single-element list filter equals scalar", () => {
    const scalar = makeIndex().search("docker", { course: "mlops" });
    const listed = makeIndex().search("docker", { course: ["mlops"] });
    assert.deepEqual(ids(scalar), ["3"]);
    assert.deepEqual(ids(listed), ["3"]);
  });

  it("unknown keyword filter field returns empty", () => {
    assert.deepEqual(makeIndex().search("docker", { missing: "value" }), []);
  });

  it("keyword filters coerce values to strings", () => {
    const docs = [
      { id: 1, title: "docker" },
      { id: 2, title: "kafka" },
    ];
    const index = new Index(["title"], ["id"]).fit(docs);
    assert.deepEqual(index.search("docker", { id: 1 }).map((r) => r.id), [1]);
  });

  it("filter with no matches returns empty", () => {
    assert.deepEqual(makeIndex().search("docker", { course: "nonexistent" }), []);
  });

  it("filter candidates without query terms return empty", () => {
    assert.deepEqual(makeIndex().search("docker", { course: "ml" }), []);
  });

  it("boost changes ranking", () => {
    const docs = [
      { id: "title", title: "spark", text: "" },
      { id: "body", title: "", text: "spark spark spark spark" },
    ];
    const index = new Index(["title", "text"]).fit(docs);
    assert.equal(index.search("spark")[0].id, "body");
    assert.equal(index.search("spark", null, { title: 3.0 })[0].id, "title");
  });

  it("num_results caps output", () => {
    assert.equal(makeIndex().search("docker", null, null, 1).length, 1);
  });

  it("num_results zero returns empty", () => {
    assert.deepEqual(makeIndex().search("docker", null, null, 0), []);
  });

  it("does not mutate source docs", () => {
    makeIndex().search("docker");
    assert.ok(DOCS.every((d) => !("score" in d)));
  });

  it("results are independent shallow copies", () => {
    const docs = [{ id: "1", title: "docker", metadata: { course: "de" } }];
    const result = new Index(["title"]).fit(docs).search("docker")[0] as {
      title: string;
      metadata: { course: string };
    };
    result.title = "changed";
    result.metadata.course = "mlops";
    assert.equal(docs[0].title, "docker");
    assert.equal(docs[0].metadata.course, "mlops"); // shallow: nested is shared
  });

  it("existing score field is replaced in result only", () => {
    const docs = [{ id: "1", title: "docker", score: "original" }];
    const result = new Index(["title"]).fit(docs).search("docker")[0];
    assert.notEqual(result.score, "original");
    assert.equal(typeof result.score, "number");
    assert.equal(docs[0].score, "original");
  });

  it("unknown term returns empty", () => {
    assert.deepEqual(makeIndex().search("zzzznonexistentterm"), []);
  });

  it("missing text fields are treated as empty text", () => {
    const docs = [{ id: "missing" }, { id: "match", title: "docker" }];
    const index = new Index(["title"]).fit(docs);
    assert.deepEqual(index.search("docker").map((r) => r.id), ["match"]);
  });

  it("non-string text fields are tokenized as strings", () => {
    const docs = [{ id: "year", title: 2026 }, { id: "word", title: "docker" }];
    const index = new Index(["title"]).fit(docs);
    assert.deepEqual(index.search("2026").map((r) => r.id), ["year"]);
  });

  it("refit replaces previous index state", () => {
    const index = makeIndex();
    index.fit([{ id: "new", title: "postgres", course: "db" }]);
    assert.deepEqual(index.search("docker"), []);
    assert.deepEqual(index.search("postgres").map((r) => r.id), ["new"]);
    assert.deepEqual(index.search("postgres", { course: "de" }), []);
  });

  it("fit copies the document list not the document dicts", () => {
    const docs = [{ id: "1", title: "docker" }];
    const index = new Index(["title"]).fit(docs);
    docs.push({ id: "2", title: "kafka" });
    assert.deepEqual(index.search("kafka"), []);
    assert.equal(index.search("docker")[0].id, "1");
  });

  it("tied scores keep document order", () => {
    const docs = [
      { id: "1", title: "docker" },
      { id: "2", title: "docker" },
      { id: "3", title: "docker" },
    ];
    const index = new Index(["title"]).fit(docs);
    assert.deepEqual(index.search("docker", null, null, 3).map((r) => r.id), ["1", "2", "3"]);
  });

  it("repeated query terms increase score", () => {
    const index = new Index(["title"]).fit([{ id: "1", title: "docker" }]);
    const single = index.search("docker")[0].score;
    const repeated = index.search("docker docker")[0].score;
    assert.ok(Math.abs(repeated - single * 2) < 1e-12);
  });

  it("custom stop words", () => {
    const index = new Index(["text"], null, { stopWords: ["docker"] }).fit(DOCS);
    assert.deepEqual(index.search("docker"), []);
  });

  it("custom tokenizer", () => {
    const index = new Index(["title"], null, {
      tokenizer: (s) => s.toLowerCase().split(/\s+/).filter(Boolean),
    }).fit(DOCS);
    assert.equal(index.search("kafka")[0].id, "2");
  });

  it("idf is positive and finite", () => {
    for (const r of makeIndex().search("docker")) {
      assert.ok(Number.isFinite(r.score) && r.score > 0);
    }
  });

  it("too many text fields is rejected", () => {
    const fields = Array.from({ length: 257 }, (_, i) => `f${i}`);
    assert.throws(() => new Index(fields).fit([{ f0: "x" }]), /at most 256 text fields/);
  });
});

describe("module exports", () => {
  it("DEFAULT_STOP_WORDS contains the and is read-only-ish", () => {
    assert.ok(DEFAULT_STOP_WORDS.has("the"));
  });

  it("TOKEN_RE and VERSION are exported", () => {
    assert.ok(TOKEN_RE instanceof RegExp);
    assert.equal(typeof VERSION, "string");
  });
});

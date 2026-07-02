import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  Index,
  tokenize,
  getStemmer,
  porterStemmer,
} from "../src/index.ts";

// --- Porter parity fixture -------------------------------------------------
// Each pair is `input -> expected stem`, produced by running the reference
// Python `stemlite.porter.porter_stemmer`. The TypeScript port must agree.
const PORTER_PARITY: Array<[string, string]> = [
  ["running", "run"],
  ["startups", "startup"],
  ["startup", "startup"],
  ["pipelines", "pipelin"],
  ["pipeline", "pipelin"],
  ["happiness", "happi"],
  ["jumps", "jump"],
  ["runner", "runner"],
  ["ponies", "poni"],
  ["caresses", "caress"],
  ["ties", "ti"],
  ["cats", "cat"],
  ["agreed", "agre"],
  ["plastered", "plaster"],
  ["bled", "bled"],
  ["motoring", "motor"],
  ["sing", "sing"],
  ["conflated", "conflat"],
  ["troubling", "troubl"],
  ["sized", "size"],
  ["hopping", "hop"],
  ["tanned", "tan"],
  ["falling", "fal"],
  ["hissing", "his"],
  ["fizzed", "fiz"],
  ["failing", "fail"],
  ["filing", "file"],
  ["rational", "ration"],
  ["relational", "relat"],
  ["conditional", "condition"],
  ["digitizer", "digit"],
  ["vietnamization", "vietnam"],
  ["predication", "predic"],
  ["operator", "oper"],
  ["feudalism", "feudal"],
  ["decisiveness", "decis"],
  ["hopefulness", "hope"],
  ["callousness", "callous"],
  ["formaliti", "formal"],
  ["sensitiviti", "sensit"],
  ["sensibiliti", "sensibl"],
  ["triplicate", "triplic"],
  ["formative", "format"],
  ["formalize", "formal"],
  ["electriciti", "electr"],
  ["electrical", "electr"],
  ["hopeful", "hope"],
  ["goodness", "good"],
  ["revival", "reviv"],
  ["allowance", "allow"],
  ["inference", "infer"],
  ["airliner", "airlin"],
  ["gyroscopic", "gyroscop"],
  ["adjustable", "adjust"],
  ["defensible", "defens"],
  ["irritant", "irrit"],
  ["replacement", "replac"],
  ["adjustment", "adjust"],
  ["dependent", "depend"],
  ["adoption", "adop"],
  ["homologou", "homolog"],
  ["communism", "commun"],
  ["activate", "activ"],
  ["homologous", "homolog"],
  ["effective", "effect"],
  ["bowdlerize", "bowdler"],
  ["probate", "probat"],
  ["rate", "rate"],
  ["cease", "ceas"],
  ["controll", "controll"],
  ["roll", "roll"],
  ["data", "data"],
  ["engineering", "engin"],
  ["engineer", "engin"],
  ["models", "model"],
  ["model", "model"],
  ["learning", "learn"],
  ["learned", "learn"],
  ["searches", "search"],
  ["search", "search"],
  ["indexing", "index"],
  ["indexed", "index"],
  ["queries", "queri"],
  ["query", "query"],
  ["", ""],
];

describe("porter stemmer parity with Python stemlite", () => {
  for (const [word, expected] of PORTER_PARITY) {
    it(`porter(${JSON.stringify(word)}) == ${JSON.stringify(expected)}`, () => {
      assert.equal(porterStemmer(word), expected);
      assert.equal(getStemmer("porter")(word), expected);
    });
  }

  it("uppercases are lowercased first", () => {
    assert.equal(porterStemmer("Running"), "run");
    assert.equal(porterStemmer("STARTUPS"), "startup");
  });
});

describe("getStemmer registry (mirrors stemlite.get_stemmer)", () => {
  it("null/undefined -> no-op (lowercase only)", () => {
    assert.equal(getStemmer(null)("Running"), "running");
    assert.equal(getStemmer(undefined)("Running"), "running");
    assert.equal(getStemmer()("Running"), "running");
  });

  it("unknown name -> no-op (lowercase only)", () => {
    assert.equal(getStemmer("does-not-exist")("Running"), "running");
  });

  it("'none' -> no-op", () => {
    assert.equal(getStemmer("none")("Running"), "running");
  });

  it("'porter' -> porter", () => {
    assert.equal(getStemmer("porter")("running"), "run");
  });
});

describe("tokenize stemmer option", () => {
  it("default tokenizer does NOT stem", () => {
    assert.deepEqual(tokenize("running startups pipelines"), [
      "running",
      "startups",
      "pipelines",
    ]);
  });

  it("stemmer applied after stop-word/length filtering", () => {
    // "is" is a stop word and dropped before stemming; "a" is length 1.
    assert.deepEqual(
      tokenize("running is a startup", undefined, getStemmer("porter")),
      ["run", "startup"],
    );
  });

  it("a custom function stemmer works", () => {
    const upper = (w: string) => w.toUpperCase();
    assert.deepEqual(tokenize("hello world", undefined, upper), ["HELLO", "WORLD"]);
  });
});

describe("Index stemmer option", () => {
  const docs = [
    { id: "1", text: "building a startup with docker containers" },
    { id: "2", text: "scaling startups and pipelines" },
    { id: "3", text: "kafka consumer groups" },
  ];

  it("no stemmer: singular query does not match plural doc", () => {
    const index = new Index(["text"], null).fit(docs);
    assert.deepEqual(index.search("startup").map((r) => r.id), ["1"]);
    assert.deepEqual(index.search("startups").map((r) => r.id), ["2"]);
  });

  it("named porter stemmer bridges singular/plural", () => {
    const index = new Index(["text"], null, { stemmer: "porter" }).fit(docs);
    // Both docs now share the stem "startup".
    assert.deepEqual(
      index.search("startup").map((r) => r.id).sort(),
      ["1", "2"],
    );
    assert.deepEqual(
      index.search("startups").map((r) => r.id).sort(),
      ["1", "2"],
    );
    // "pipeline" (query) stems to "pipelin" and matches "pipelines" in doc 2.
    assert.deepEqual(index.search("pipeline").map((r) => r.id), ["2"]);
  });

  it("function stemmer works but is not persisted by name", () => {
    const index = new Index(["text"], null, { stemmer: getStemmer("porter") }).fit(docs);
    assert.deepEqual(index.search("startups").map((r) => r.id).sort(), ["1", "2"]);
    // The serialized state records no stemmer name for a function stemmer.
    const state = JSON.parse(index.dumps());
    assert.equal(state.stemmer, null);
  });
});

describe("stemmer round-trips through serialize/deserialize", () => {
  const docs = [
    { id: "1", text: "scaling startups" },
    { id: "2", text: "docker containers" },
  ];

  it("named porter round-trips and keeps stemming queries", () => {
    const index = new Index(["text"], null, { stemmer: "porter" }).fit(docs);
    const state = JSON.parse(index.dumps());
    assert.equal(state.stemmer, "porter");

    const restored = Index.loads(index.dumps());
    // Restored index stems the query automatically ("startup" -> "startup"
    // matches the stored stem of "startups").
    assert.deepEqual(restored.search("startup").map((r) => r.id), ["1"]);
    assert.deepEqual(
      restored.search("startup"),
      index.search("startup"),
    );
  });

  it("default (no stemmer) round-trips with no stemming", () => {
    const index = new Index(["text"], null).fit(docs);
    const state = JSON.parse(index.dumps());
    assert.equal(state.stemmer, null);
    const restored = Index.loads(index.dumps());
    assert.deepEqual(restored.search("startup"), []);
  });

  it("a custom tokenizer on load overrides the persisted stemmer", () => {
    const index = new Index(["text"], null, { stemmer: "porter" }).fit(docs);
    const raw = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);
    const restored = Index.loads(index.dumps(), { tokenizer: raw });
    // With the raw tokenizer, "startup" no longer matches the stored "startup"
    // stem of "startups" — the query token stays "startup" but the raw doc
    // token would have been "startups" (stored stems remain "startup"). The
    // point: the custom tokenizer path bypasses the restored stemmer.
    assert.deepEqual(restored.search("startups"), []);
  });
});

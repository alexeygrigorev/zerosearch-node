import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readMarshal } from "../src/marshal.ts";
import { Index } from "../src/index.ts";

// Tiny hand-rolled marshal encoders for the opcodes under test.
const concat = (...parts: number[][]) => Uint8Array.from(parts.flat());
const u32le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const shortAscii = (s: string) => [0x7a, s.length, ...[...s].map((c) => c.charCodeAt(0))];

describe("marshal reader primitives", () => {
  it("reads None / True / False", () => {
    assert.equal(readMarshal(Uint8Array.from([0x4e])), null); // 'N'
    assert.equal(readMarshal(Uint8Array.from([0x54])), true); // 'T'
    assert.equal(readMarshal(Uint8Array.from([0x46])), false); // 'F'
  });

  it("reads a 32-bit int", () => {
    assert.equal(readMarshal(concat([0x69], u32le(42))), 42); // 'i'
    assert.equal(readMarshal(concat([0x69], u32le(-7 >>> 0))), -7);
  });

  it("reads an 8-byte float", () => {
    const buf = new Uint8Array(9);
    buf[0] = 0x67; // 'g'
    new DataView(buf.buffer).setFloat64(1, 3.5, true);
    assert.equal(readMarshal(buf), 3.5);
  });

  it("reads a short-ascii string and bytes", () => {
    assert.equal(readMarshal(Uint8Array.from(shortAscii("docker"))), "docker");
    const bytes = readMarshal(concat([0x73], u32le(3), [1, 2, 3])); // 's' bytes
    assert.ok(bytes instanceof Uint8Array);
    assert.deepEqual([...(bytes as Uint8Array)], [1, 2, 3]);
  });

  it("reads a list", () => {
    const buf = concat([0x5b], u32le(2), [0x54], [0x46]); // '[' [True, False]
    assert.deepEqual(readMarshal(buf), [true, false]);
  });

  it("reads a dict terminated by a NULL key", () => {
    const buf = concat([0x7b], shortAscii("k"), [0x69], u32le(5), [0x30]); // '{' "k":5 NULL
    assert.deepEqual(readMarshal(buf), { k: 5 });
  });

  it("resolves FLAG_REF / TYPE_REF back-references", () => {
    // ['x' (ref0), REF 0] -> the second element reuses the first string object.
    const refString = [0x7a | 0x80, 1, "x".charCodeAt(0)]; // SHORT_ASCII + FLAG_REF
    const buf = concat([0x5b], u32le(2), refString, [0x72], u32le(0)); // 'r' REF 0
    assert.deepEqual(readMarshal(buf), ["x", "x"]);
  });

  it("throws on an unknown opcode", () => {
    assert.throws(() => readMarshal(Uint8Array.from([0x21])), /unsupported opcode/);
  });
});

describe("marshal index guards", () => {
  it("rejects a marshalled dict that is not a zerosearch index", () => {
    // marshal of {"hello": "world"}
    const buf = concat([0x7b], shortAscii("hello"), shortAscii("world"), [0x30]);
    assert.throws(() => Index.loadsMarshal(buf), /not a zerosearch index/);
  });
});

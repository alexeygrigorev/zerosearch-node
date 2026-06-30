#!/usr/bin/env node
/**
 * Benchmark zerosearch-node on the Simple English Wikipedia corpus.
 *
 * This mirrors the Python `benchmarks/simplewiki_benchmark.py` runner so the
 * two implementations can be compared directly: same documents, same queries
 * (loaded from a shared queries file), same index shape (`text` field), same
 * `num_results=10` searches, same reported metrics.
 *
 * Run:
 *   node --import tsx benchmarks/simplewiki_benchmark.ts \
 *     --input ../zerosearch/benchmarks/data/simplewiki_1000.jsonl \
 *     --queries benchmarks/data/queries_1000.json \
 *     --label node_1000
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Index, type Doc } from "../src/index.ts";

interface Args {
  input: string;
  queries: string;
  numDocs: number | null;
  numQueries: number;
  outputDir: string;
  label: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    input: "../zerosearch/benchmarks/data/simplewiki_1000.jsonl",
    queries: "benchmarks/data/queries_1000.json",
    numDocs: null,
    numQueries: 100,
    outputDir: "benchmarks/results",
    label: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    if (a === "--input") out.input = next();
    else if (a === "--queries") out.queries = next();
    else if (a === "--num-docs") out.numDocs = Number(next());
    else if (a === "--num-queries") out.numQueries = Number(next());
    else if (a === "--output-dir") out.outputDir = next();
    else if (a === "--label") out.label = next();
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

function loadDocs(path: string, limit: number | null): Doc[] {
  const text = readFileSync(path, "utf-8");
  const docs: Doc[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    docs.push(JSON.parse(line));
    if (limit !== null && docs.length >= limit) break;
  }
  return docs;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    ordered.length - 1,
    Math.round((pct / 100) * (ordered.length - 1)),
  );
  return ordered[idx];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
}

function benchmark(docs: Doc[], queries: string[]) {
  const totalChars = docs.reduce(
    (sum, d) => sum + String((d as Record<string, unknown>).text ?? "").length,
    0,
  );

  if (global.gc) global.gc();
  const memBefore = process.memoryUsage();
  const buildStart = performance.now();
  const index = new Index(["text"]).fit(docs);
  const buildSeconds = (performance.now() - buildStart) / 1000;
  const memAfter = process.memoryUsage();

  // Warmup (matches Python: searches queries[0] once before timing).
  if (queries.length) index.search(queries[0], null, null, 10);

  const timings: number[] = [];
  const hitCounts: number[] = [];
  for (const query of queries) {
    const start = performance.now();
    const results = index.search(query, null, null, 10);
    timings.push((performance.now() - start) / 1000);
    hitCounts.push(results.length);
  }

  const avg = mean(timings);
  const serialized = index.dumps();

  return {
    timestamp_utc: new Date().toISOString(),
    engine: "zerosearch-node",
    node_version: process.version,
    docs: docs.length,
    queries: queries.length,
    total_text_chars: totalChars,
    build_seconds: buildSeconds,
    build_rss_delta_bytes: memAfter.rss - memBefore.rss,
    build_heap_delta_bytes: memAfter.heapUsed - memBefore.heapUsed,
    index_serialized_bytes: Buffer.byteLength(serialized, "utf-8"),
    search_avg_ms: avg * 1000,
    search_median_ms: median(timings) * 1000,
    search_p95_ms: percentile(timings, 95) * 1000,
    search_min_ms: timings.length ? Math.min(...timings) * 1000 : 0,
    search_max_ms: timings.length ? Math.max(...timings) * 1000 : 0,
    qps: avg ? 1 / avg : 0,
    avg_hits: mean(hitCounts),
  };
}

function printSummary(r: ReturnType<typeof benchmark>): void {
  const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
  console.log("\nSimple Wikipedia benchmark (node)");
  console.log(`docs:              ${r.docs.toLocaleString()}`);
  console.log(`queries:           ${r.queries.toLocaleString()}`);
  console.log(`text chars:        ${r.total_text_chars.toLocaleString()}`);
  console.log(`build:             ${r.build_seconds.toFixed(3)} s`);
  console.log(`build rss delta:   ${mb(r.build_rss_delta_bytes)} MB`);
  console.log(`build heap delta:  ${mb(r.build_heap_delta_bytes)} MB`);
  console.log(`serialized index:  ${mb(r.index_serialized_bytes)} MB`);
  console.log(`search avg:        ${r.search_avg_ms.toFixed(3)} ms`);
  console.log(`search median:     ${r.search_median_ms.toFixed(3)} ms`);
  console.log(`search p95:        ${r.search_p95_ms.toFixed(3)} ms`);
  console.log(`search qps:        ${r.qps.toFixed(1)}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const docs = loadDocs(resolve(args.input), args.numDocs);
  const queries: string[] = JSON.parse(readFileSync(resolve(args.queries), "utf-8"));
  if (args.numQueries && queries.length !== args.numQueries) {
    console.warn(
      `warning: queries file has ${queries.length} entries, expected ${args.numQueries}`,
    );
  }
  const results = benchmark(docs, queries);

  mkdirSync(resolve(args.outputDir), { recursive: true });
  const label =
    args.label ?? new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const outPath = resolve(args.outputDir, `${label}.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");

  printSummary(results);
  console.log(`results:           ${outPath}`);
}

main();

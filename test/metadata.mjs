import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import test from "node:test";
import { rememberAccount } from "../server/env.mjs";
import { META_TTL_MS, cachedMeta, clearMeta, forgetMetaMemory } from "../server/metadata.mjs";

const FILE = "data/metadata-TESTMETA1.json";
rememberAccount("TESTMETA1");

test.after(() => rmSync(FILE, { force: true }));

test("metadata loads once, then comes from memory and from disk after a restart", async () => {
  rmSync(FILE, { force: true });
  forgetMetaMemory();
  let calls = 0;
  const load = async () => {
    calls += 1;
    return ["salesorder", "estimate"];
  };
  assert.deepEqual(await cachedMeta("types", load), ["salesorder", "estimate"]);
  assert.deepEqual(await cachedMeta("types", load), ["salesorder", "estimate"]);
  assert.equal(calls, 1);
  assert.ok(existsSync(FILE));
  forgetMetaMemory();
  assert.deepEqual(await cachedMeta("types", load), ["salesorder", "estimate"]);
  assert.equal(calls, 1);
});

test("two calls at once share one NetSuite request", async () => {
  forgetMetaMemory();
  clearMeta();
  let calls = 0;
  const load = () => new Promise((resolve) => setTimeout(() => resolve(++calls), 20));
  const [a, b] = await Promise.all([cachedMeta("tables", load), cachedMeta("tables", load)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test("a value older than a day, or a fresh request, loads again", async () => {
  clearMeta();
  let calls = 0;
  const load = async () => ++calls;
  let clock = 1_000;
  const now = () => clock;
  await cachedMeta("fields:salesorder", load, { now });
  clock += META_TTL_MS + 1;
  assert.equal(await cachedMeta("fields:salesorder", load, { now }), 2);
  assert.equal(await cachedMeta("fields:salesorder", load, { now, fresh: true }), 3);
});

test("memory-only values never reach the file, and clearMeta drops by prefix", async () => {
  clearMeta();
  await cachedMeta("me", async () => ({ name: "Pat" }), { ttl: 60_000, disk: false });
  await cachedMeta("columns:customer", async () => ["id"]);
  await cachedMeta("columns:item", async () => ["id"]);
  const saved = JSON.parse(readFileSync(FILE, "utf8"));
  assert.equal(saved.me, undefined);
  clearMeta("columns:");
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(FILE, "utf8"))), []);
});

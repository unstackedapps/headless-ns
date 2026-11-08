import assert from "node:assert/strict";
import test from "node:test";
import { blockedReason } from "../server/http.mjs";

const json = "application/json";

function req(method, headers) {
  return { method, headers: { host: "localhost:5173", ...headers } };
}

test("a same-origin JSON POST passes", () => {
  assert.equal(blockedReason(req("POST", { "content-type": json, origin: "https://localhost:5173" }), 5173), "");
  assert.equal(
    blockedReason(req("POST", { "content-type": "application/json; charset=utf-8", origin: "https://127.0.0.1:5173", host: "127.0.0.1:5173" }), 5173),
    "",
  );
});

test("a POST from another origin is refused", () => {
  assert.match(blockedReason(req("POST", { "content-type": json, origin: "https://evil.example" }), 5173), /Cross-site/);
  assert.match(blockedReason(req("POST", { "content-type": json, origin: "https://localhost:5174" }), 5173), /Cross-site/);
  assert.match(blockedReason(req("POST", { "content-type": json, origin: "http://localhost:5173" }), 5173), /Cross-site/);
  assert.match(blockedReason(req("POST", { "content-type": json, origin: "null" }), 5173), /Cross-site/);
});

test("a POST that is not JSON is refused", () => {
  const origin = "https://localhost:5173";
  assert.match(blockedReason(req("POST", { "content-type": "text/plain", origin }), 5173), /application\/json/);
  assert.match(blockedReason(req("POST", { "content-type": "application/x-www-form-urlencoded", origin }), 5173), /application\/json/);
  assert.match(blockedReason(req("POST", { origin }), 5173), /application\/json/);
});

test("a POST with no Origin needs Sec-Fetch-Site same-origin", () => {
  assert.equal(blockedReason(req("POST", { "content-type": json, "sec-fetch-site": "same-origin" }), 5173), "");
  assert.match(blockedReason(req("POST", { "content-type": json, "sec-fetch-site": "cross-site" }), 5173), /Cross-site/);
  assert.match(blockedReason(req("POST", { "content-type": json }), 5173), /Cross-site/);
});

test("GET passes without Origin, including the OAuth callback", () => {
  assert.equal(blockedReason(req("GET", {}), 5173), "");
  assert.equal(blockedReason(req("GET", { "sec-fetch-site": "cross-site" }), 5173), "");
});

test("another Host header is refused", () => {
  assert.match(blockedReason(req("GET", { host: "evil.example:5173" }), 5173), /localhost/);
  assert.match(blockedReason(req("POST", { host: "evil.example", "content-type": json, origin: "https://localhost:5173" }), 5173), /localhost/);
});

import { inSlot, isReadTool, withRetry } from "../server/osmcp.mjs";

test("NetSuite calls share a few slots", async () => {
  let peak = 0;
  let now = 0;
  const task = async () => {
    now += 1;
    peak = Math.max(peak, now);
    await new Promise((resolve) => setTimeout(resolve, 5));
    now -= 1;
  };
  await Promise.all(Array.from({ length: 10 }, () => inSlot(task)));
  assert.equal(peak, 3);
});

test("a busy answer repeats reads but never writes", async () => {
  const busy = () => Object.assign(new Error("busy"), { status: 429 });
  let reads = 0;
  const value = await withRetry("ns_getRecord", async () => {
    reads += 1;
    if (reads < 3) throw busy();
    return "ok";
  }, [1, 1, 1]);
  assert.equal(value, "ok");
  assert.equal(reads, 3);
  let writes = 0;
  await assert.rejects(withRetry("ns_transformRecord", async () => {
    writes += 1;
    throw busy();
  }, [1, 1, 1]), /busy/);
  assert.equal(writes, 1);
  assert.equal(isReadTool("ns_runCustomSuiteQL"), true);
  assert.equal(isReadTool("ns_createRecord"), false);
});

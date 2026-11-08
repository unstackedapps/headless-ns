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

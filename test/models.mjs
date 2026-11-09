import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { keepsExistingKey, openModelStore, redactKey } from "../server/models.mjs";

test("redacts a saved key down to a dotted tail", () => {
  assert.equal(redactKey("sk-live-secret-1234"), "••••••••1234");
  assert.equal(redactKey(""), "");
});

test("a blank field or the dotted preview keeps the saved key", () => {
  const key = "sk-live-secret-1234";
  assert.equal(keepsExistingKey("", key), true);
  assert.equal(keepsExistingKey("••••••••1234", key), true);
  assert.equal(keepsExistingKey("••••", key), true);
  assert.equal(keepsExistingKey("sk-new-secret-9999", key), false);
});

test("the store saves several models and never returns the key", () => {
  const file = join(mkdtempSync(join(tmpdir(), "hn-models-")), "models.json");
  const store = openModelStore(file, { seed: false });
  const first = store.save({ provider: "openai", model: "gpt-5.2", label: "OpenAI", apiKey: "sk-live-secret-1234" });
  const second = store.save({ provider: "anthropic", model: "claude-sonnet-5-5", label: "Claude", apiKey: "sk-ant-secret-9876" });
  assert.equal(second.connections.length, 2);
  assert.equal(JSON.stringify(second).includes("sk-live"), false);
  assert.equal(JSON.stringify(second).includes("sk-ant"), false);
  assert.equal(second.connections[0].keyMask, "••••••••1234");
  const kept = store.save({ id: first.connections[0].id, provider: "openai", model: "gpt-5.2", label: "OpenAI", apiKey: "" });
  assert.equal(store.require(kept.connections[0].id).apiKey, "sk-live-secret-1234");
  const active = store.activate(second.connections[1].id);
  assert.equal(active.activeId, second.connections[1].id);
});

// Live on 2026-11-09: the user revoked a Claude key and saved claude-haiku-5-5 with a new one.
// claude-sonnet-5-5, saved earlier, kept the revoked key and Anthropic answered "invalid x-api-key".
test("a new key for a provider replaces the old key on every model saved for it", () => {
  const file = join(mkdtempSync(join(tmpdir(), "hn-models-")), "models.json");
  const store = openModelStore(file, { seed: false });
  const sonnet = store.save({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-ant-revoked-1111" }).connections[0].id;
  store.save({ provider: "compatible", baseUrl: "https://gemma.example/v1", model: "gemma-4", apiKey: "sk-gemma-2222" });
  const haiku = store.save({ provider: "anthropic", model: "claude-haiku-5-5", apiKey: "sk-ant-fresh-3333" }).connections[2].id;
  assert.equal(store.require(sonnet).apiKey, "sk-ant-fresh-3333");
  assert.equal(store.require(haiku).apiKey, "sk-ant-fresh-3333");
  const gemma = store.read().connections.find((row) => row.provider === "compatible");
  assert.equal(gemma.apiKey, "sk-gemma-2222");
});

test("setup tests a draft without saving it, and reuses the saved key for the same provider URL", () => {
  const file = join(mkdtempSync(join(tmpdir(), "hn-models-")), "models.json");
  const store = openModelStore(file, { seed: false });
  assert.throws(() => store.draft({ provider: "compatible", baseUrl: "https://gemma.example/v1", model: "gemma-4" }), /Add an API key/);
  const draft = store.draft({ provider: "compatible", baseUrl: "https://gemma.example/v1/", model: "gemma-4", apiKey: "sk-gemma-1234" });
  assert.equal(draft.baseUrl, "https://gemma.example/v1");
  assert.equal(store.read().connections.length, 0);
  store.save({ provider: "compatible", baseUrl: "https://gemma.example/v1", model: "gemma-4", apiKey: "sk-gemma-1234" });
  assert.equal(store.credentials({ provider: "compatible", baseUrl: "https://gemma.example/v1", apiKey: "" }).apiKey, "sk-gemma-1234");
  assert.throws(() => store.credentials({ provider: "compatible", baseUrl: "https://other.example/v1", apiKey: "" }), /Add an API key/);
  assert.throws(() => store.credentials({ provider: "compatible", baseUrl: "ftp://x" }), /must start with http/);
});

test("Finish saves the model as the one Ask uses, and a repeat setup updates it in place", () => {
  const file = join(mkdtempSync(join(tmpdir(), "hn-models-")), "models.json");
  const store = openModelStore(file, { seed: false });
  const first = store.save({ provider: "openai", model: "gpt-5.2", apiKey: "sk-live-secret-1234" });
  const second = store.save({ provider: "compatible", baseUrl: "https://gemma.example/v1", model: "gemma-4", apiKey: "sk-gemma-1234" }, { activate: true });
  assert.equal(second.connections.length, 2);
  assert.equal(second.activeId, second.connections[1].id);
  assert.notEqual(second.activeId, first.activeId);
  const again = store.save({ provider: "compatible", baseUrl: "https://gemma.example/v1", model: "gemma-4", apiKey: "sk-gemma-5678" }, { activate: true });
  assert.equal(again.connections.length, 2);
  assert.equal(store.require(again.activeId).apiKey, "sk-gemma-5678");
});

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

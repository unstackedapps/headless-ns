import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { ask } from "../server/llm.mjs";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function model(doGenerate) {
  return new MockLanguageModelV4({ doGenerate });
}

const connection = { apiKey: "sk-test-secret", provider: "openai", model: "mock" };
const identity = { accountId: "TD0000000", roleId: "customrole" };

test("a write tool pauses the whole batch before anything runs", async () => {
  let ran = false;
  const result = await ask({
    text: "Create a customer named Northwind.",
    model: model(async () => ({
      content: [{ type: "tool-call", toolCallId: "call-1", toolName: "ns_createRecord", input: { type: "customer" } }],
      finishReason: "tool-calls",
      usage,
    })),
    connection,
    identity,
    policy: { allowWrites: true, disabled: [] },
    catalog: [{ name: "ns_createRecord", description: "Create a record", schema: { type: "object", properties: {} } }],
    runTool: async () => {
      ran = true;
      return { id: 1 };
    },
  });
  assert.equal(ran, false);
  assert.equal(result.pending.length, 1);
  assert.equal(result.pending[0].name, "ns_createRecord");
  assert.equal(result.steps.length, 0);
});

test("a read tool runs and the next reply becomes the answer", async () => {
  let calls = 0;
  const seen = [];
  const result = await ask({
    text: "How many open orders are there?",
    model: model(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          content: [{ type: "tool-call", toolCallId: "call-2", toolName: "ns_runCustomSuiteQL", input: { sqlQuery: "select 1" } }],
          finishReason: "tool-calls",
          usage,
        };
      }
      return { content: [{ type: "text", text: "There are 624." }], finishReason: "stop", usage };
    }),
    connection,
    identity,
    policy: { allowWrites: false, disabled: [] },
    catalog: [{ name: "ns_runCustomSuiteQL", description: "Run SuiteQL", schema: { type: "object", properties: {} } }],
    runTool: async (name, args) => {
      seen.push({ name, args });
      return { rows: [{ n: 624 }] };
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "ns_runCustomSuiteQL");
  assert.equal(result.answer, "There are 624.");
  assert.equal(result.pending, null);
  assert.equal(result.steps[0].ok, true);
});

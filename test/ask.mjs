import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { PENDING_TTL_MS, ask, confirmAsk } from "../server/llm.mjs";

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

const createTool = [{ name: "ns_createRecord", description: "Create a record", schema: { type: "object", properties: {} } }];

// Proposes ns_createRecord once, then answers with text after any tool result.
function writeThenAnswer(seen = []) {
  return model(async (options) => {
    const last = options.prompt.at(-1);
    if (last?.role === "tool") {
      seen.push(last.content[0].output);
      return { content: [{ type: "text", text: "Done." }], finishReason: "stop", usage };
    }
    return {
      content: [{ type: "tool-call", toolCallId: "call-9", toolName: "ns_createRecord", input: JSON.stringify({ type: "customer" }) }],
      finishReason: "tool-calls",
      usage,
    };
  });
}

async function propose() {
  const result = await ask({
    text: "Create a customer.",
    model: writeThenAnswer(),
    connection,
    identity,
    policy: { allowWrites: true, disabled: [] },
    catalog: createTool,
    runTool: async () => assert.fail("nothing runs before confirm"),
  });
  assert.ok(result.pendingId);
  return result.pendingId;
}

function confirmWith(id, policy, runTool, seen = []) {
  return confirmAsk({ id, approved: true, model: writeThenAnswer(seen), connection, identity, policy, catalog: createTool, runTool });
}

test("confirm runs the stored write once", async () => {
  const id = await propose();
  const ran = [];
  const result = await confirmWith(id, { allowWrites: true, disabled: [] }, async (name, args) => {
    ran.push({ name, args });
    return { id: 42 };
  });
  assert.deepEqual(ran, [{ name: "ns_createRecord", args: { type: "customer" } }]);
  assert.equal(result.answer, "Done.");
  await assert.rejects(confirmWith(id, { allowWrites: true, disabled: [] }, async () => ({})), /expired or was already handled/);
});

test("confirm refuses an unknown id", async () => {
  await assert.rejects(confirmWith("not-a-real-id", { allowWrites: true, disabled: [] }, async () => ({})), /expired or was already handled/);
  await assert.rejects(confirmWith(undefined, { allowWrites: true, disabled: [] }, async () => ({})), /expired or was already handled/);
});

test("confirm refuses an expired id", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const id = await propose();
  t.mock.timers.tick(PENDING_TTL_MS + 1);
  await assert.rejects(confirmWith(id, { allowWrites: true, disabled: [] }, async () => assert.fail("must not run")), /expired/);
});

test("confirm re-checks the policy: writes turned off", async () => {
  const id = await propose();
  const seen = [];
  await confirmWith(id, { allowWrites: false, disabled: [] }, async () => assert.fail("must not run"), seen);
  assert.match(JSON.stringify(seen), /Writes are off in Settings/);
});

test("confirm re-checks the policy: tool disabled", async () => {
  const id = await propose();
  const seen = [];
  await confirmWith(id, { allowWrites: true, disabled: ["ns_createRecord"] }, async () => assert.fail("must not run"), seen);
  assert.match(JSON.stringify(seen), /turned off for Ask/);
});

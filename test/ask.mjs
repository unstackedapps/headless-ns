import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { MAX_MS, MAX_TURNS, PENDING_TTL_MS, ask, confirmAsk } from "../server/llm.mjs";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function model(doGenerate) {
  return new MockLanguageModelV4({ doGenerate });
}

const connection = { apiKey: "sk-test-secret", provider: "openai", model: "mock" };
const identity = { accountId: "TD0000000", roleId: "customrole" };
const query = async () => [];

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
    query,
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
    query,
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
    query,
    policy: { allowWrites: true, disabled: [] },
    catalog: createTool,
    runTool: async () => assert.fail("nothing runs before confirm"),
  });
  assert.ok(result.pendingId);
  return result.pendingId;
}

function confirmWith(id, policy, runTool, seen = []) {
  return confirmAsk({ id, approved: true, model: writeThenAnswer(seen), connection, identity, query, policy, catalog: createTool, runTool });
}

test("confirm runs the stored write once", async () => {
  const id = await propose();
  const ran = [];
  const result = await confirmWith(id, { allowWrites: true, disabled: [] }, async (name, args) => {
    ran.push({ name, args });
    return { id: 42 };
  });
  assert.equal(ran.length, 1);
  assert.equal(ran[0].name, "ns_createRecord");
  assert.equal(ran[0].args.type, "customer");
  assert.match(JSON.parse(ran[0].args.data).externalId, /^hns-ask-record-[0-9a-f-]{36}$/);
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

const sqlTool = [{ name: "ns_runCustomSuiteQL", description: "Run SuiteQL", schema: { type: "object", properties: {} } }];

// Calls SuiteQL with a new query every turn, so it never repeats and never answers.
function endlessReads() {
  let n = 0;
  return model(async () => {
    n += 1;
    return {
      content: [{ type: "tool-call", toolCallId: `call-${n}`, toolName: "ns_runCustomSuiteQL", input: { sqlQuery: `select ${n}` } }],
      finishReason: "tool-calls",
      usage,
    };
  });
}

test("one request can take many steps, then stops at the turn limit", async () => {
  let ran = 0;
  const result = await ask({
    text: "Keep reading.",
    model: endlessReads(),
    connection,
    identity,
    query,
    policy: { allowWrites: false, disabled: [] },
    catalog: sqlTool,
    runTool: async () => {
      ran += 1;
      return { rows: [] };
    },
  });
  assert.ok(MAX_TURNS >= 10, "room for quote, order and fulfillment reads");
  assert.equal(ran, MAX_TURNS);
  assert.match(result.answer, new RegExp(`after ${MAX_TURNS} steps`));
});

test("a request stops when it runs out of time", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  let ran = 0;
  const result = await ask({
    text: "Keep reading.",
    model: endlessReads(),
    connection,
    identity,
    query,
    policy: { allowWrites: false, disabled: [] },
    catalog: sqlTool,
    runTool: async () => {
      ran += 1;
      if (ran === 2) t.mock.timers.tick(MAX_MS + 1);
      return { rows: [] };
    },
  });
  assert.equal(ran, 2);
  assert.match(result.answer, /ran out of time/);
});

test("the same failing call twice stops the request", async () => {
  let ran = 0;
  const result = await ask({
    text: "Read it.",
    model: model(async () => ({
      content: [{ type: "tool-call", toolCallId: `call-x${ran}`, toolName: "ns_runCustomSuiteQL", input: { sqlQuery: "select bad" } }],
      finishReason: "tool-calls",
      usage,
    })),
    connection,
    identity,
    query,
    policy: { allowWrites: false, disabled: [] },
    catalog: sqlTool,
    runTool: async () => {
      ran += 1;
      throw new Error("Invalid search query");
    },
  });
  assert.equal(ran, 1);
  assert.match(result.answer, /the same step failed twice/);
  assert.doesNotMatch(result.answer, /ns_/);
});

test("a pending write carries a readable summary with looked-up names", async () => {
  const data = {
    entity: { id: "341" },
    location: { id: "2" },
    externalId: "hns-ask-estimate-1",
    item: { items: [{ item: { id: "248" }, quantity: 2, rate: 10 }, { item: { id: "243" }, quantity: 3, rate: 5 }] },
  };
  const result = await ask({
    text: "Make a quote.",
    model: model(async () => ({
      content: [{ type: "tool-call", toolCallId: "call-q", toolName: "ns_createRecord", input: { recordType: "estimate", data: JSON.stringify(data) } }],
      finishReason: "tool-calls",
      usage,
    })),
    connection,
    identity,
    query: async (sql) => {
      if (/FROM entity/.test(sql)) return [{ id: "341", name: "Acme", currency: "British pound" }];
      if (/FROM location/.test(sql)) return [{ id: "2", name: "Boston" }];
      if (/FROM item/.test(sql)) return [{ id: "248", name: "SPC002" }, { id: "243", name: "GAR002" }];
      return [];
    },
    policy: { allowWrites: true, disabled: [] },
    catalog: createTool,
    runTool: async () => assert.fail("nothing runs before confirm"),
  });
  assert.equal(result.pending[0].summary.title, "Create quote for Acme: 2 lines, Boston, total 35.00 British pound");
  const held = JSON.parse(result.pending[0].arguments.data).externalId;
  assert.match(held, /^hns-ask-estimate-[0-9a-f-]{36}$/, "the server replaces the model's external id");
  assert.equal(JSON.parse(result.transcript.at(-1).tool_calls[0].function.arguments).data, result.pending[0].arguments.data);
  assert.deepEqual(result.pending[0].summary.details.slice(0, 2), ["2 × SPC002 at 10.00 British pound", "3 × GAR002 at 5.00 British pound"]);
});

test("a fulfillment without stock goes back to the model with the reason, not to the person", async () => {
  const fulfill = {
    sourceRecordType: "salesorder",
    sourceRecordId: "17389",
    targetRecordType: "itemfulfillment",
    data: JSON.stringify({ shipStatus: { id: "C" } }),
  };
  const seen = [];
  let turns = 0;
  const result = await ask({
    text: "Fulfill SO639.",
    model: model(async ({ prompt }) => {
      turns += 1;
      seen.push(prompt);
      if (turns === 1) return { content: [{ type: "tool-call", toolCallId: "call-f", toolName: "ns_transformRecord", input: fulfill }], finishReason: "tool-calls", usage };
      return { content: [{ type: "text", text: "Boston has none; San Francisco has 3." }], finishReason: "stop", usage };
    }),
    connection,
    identity,
    query: async (sql) => {
      if (/FROM transactionline tl JOIN transactionline h/.test(sql)) {
        return [{ line: 1, item: 761, itemname: "Oral-B iO", location: 1, locationname: "Boston", headlocation: 1, headlocationname: "Boston", quantity: 1, done: 0, picked: 0 }];
      }
      if (/FROM inventorybalance/.test(sql)) return [{ item: 761, location: 2, name: "San Francisco", available: 3 }];
      return [];
    },
    policy: { allowWrites: true, disabled: [] },
    catalog: [{ name: "ns_transformRecord", description: "Transform", schema: { type: "object", properties: {} } }],
    runTool: async () => assert.fail("nothing reaches NetSuite"),
  });
  assert.equal(result.pending, null);
  assert.equal(result.answer, "Boston has none; San Francisco has 3.");
  const tool = result.transcript.find((message) => message.role === "tool");
  assert.match(tool.content, /Only 0 available at Boston\. San Francisco \(location id 2\) has 3/);
});

test("the prompt places Ask inside headless-ns and keeps tool names and NetSuite menus out of replies", async () => {
  const { systemPrompt } = await import("../server/llm.mjs");
  const prompt = systemPrompt(identity);
  assert.match(prompt, /using headless-ns/);
  assert.match(prompt, /Never describe NetSuite menus or screens/);
  assert.match(prompt, /offer to do it now/);
  assert.match(prompt, /Never show tool names to the person/);
  assert.doesNotMatch(prompt, /Name the figure and the tool/);
});

test("the prompt counts every active customer, not only companies", async () => {
  const { systemPrompt } = await import("../server/llm.mjs");
  assert.match(systemPrompt(identity), /SELECT COUNT\(id\) FROM customer WHERE isinactive = 'F'/);
});

test("a cancelled request stops before the next model turn and runs no more tools", async () => {
  const controller = new AbortController();
  let turns = 0;
  let ran = 0;
  const result = await ask({
    text: "How many open orders are there?",
    signal: controller.signal,
    model: model(async () => {
      turns += 1;
      controller.abort();
      return {
        content: [{ type: "tool-call", toolCallId: `call-c${turns}`, toolName: "ns_runCustomSuiteQL", input: { sqlQuery: "select 1" } }],
        finishReason: "tool-calls",
        usage,
      };
    }),
    connection,
    identity,
    query,
    policy: { allowWrites: false, disabled: [] },
    catalog: [{ name: "ns_runCustomSuiteQL", description: "Run SuiteQL", schema: { type: "object", properties: {} } }],
    runTool: async () => {
      ran += 1;
      return { rows: [] };
    },
  });
  assert.equal(turns, 1);
  assert.equal(ran, 0);
  assert.equal(result.answer, "You cancelled this request.");
});

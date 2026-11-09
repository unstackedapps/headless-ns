import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTEXT_MESSAGE, MAX_MS, MAX_SKILL_TURNS, MAX_TURNS, PENDING_TTL_MS, SKILL_LISTING_CHARS, ask, confirmAsk, contextTooSmall, skillListing, systemPrompt } from "../server/llm.mjs";
import { openSkillStore } from "../server/skills.mjs";
import { listTrace } from "../server/trace.mjs";
import { languageModel } from "../server/providers.mjs";

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
  await assert.rejects(confirmWith(id, { allowWrites: true, disabled: [] }, async () => ({})), /That change expired/);
});

test("confirm refuses an unknown id", async () => {
  await assert.rejects(confirmWith("not-a-real-id", { allowWrites: true, disabled: [] }, async () => ({})), /That change expired/);
  await assert.rejects(confirmWith(undefined, { allowWrites: true, disabled: [] }, async () => ({})), /That change expired/);
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
  assert.match(JSON.stringify(seen), /turned this tool off for Ask/);
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

function openai(replies) {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(String(init.body)));
    const [status, body] = replies[Math.min(bodies.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "retry-after-ms": "0" } });
  };
  return { bodies, model: languageModel({ provider: "openai", model: "gpt-5.5", apiKey: "sk-test-secret" }, fetchImpl) };
}


test("OpenAI's Responses API gets the tool call and its result back on the next turn", async () => {
  const done = { id: "resp_2", object: "response", created_at: 1, model: "gpt-5.5", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  const sales = openai([
    [200, { ...done, id: "resp_1", output: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "ns_runCustomSuiteQL", arguments: '{"sqlQuery":"SELECT COUNT(*) n FROM transaction"}', status: "completed" }] }],
    [200, { ...done, output: [{ id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "212 open sales orders.", annotations: [] }] }] }],
  ]);
  const result = await ask({
    text: "How many open sales orders?",
    model: sales.model,
    connection,
    identity,
    query,
    policy: { allowWrites: true, disabled: [] },
    catalog: sqlTool,
    runTool: async () => ({ items: [{ n: 212 }] }),
  });
  assert.equal(result.answer, "212 open sales orders.");
  const input = sales.bodies[1].input;
  const call = input.find((item) => item.type === "function_call");
  const output = input.find((item) => item.type === "function_call_output");
  assert.equal(call.call_id, "call_1");
  assert.equal(call.name, "ns_runCustomSuiteQL");
  assert.equal(output.call_id, "call_1");
  assert.match(String(output.output), /212/);
});

// Recorded from OpenAI on 2026-11-09, when the account had no credits. The SDK retried it 3 times.
test("a provider error shows the provider's own reason, not the SDK's retry wrapper", async () => {
  const broke = openai([[429, { error: { message: "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.", type: "insufficient_quota", param: null, code: "insufficient_quota" } }]]);
  await assert.rejects(
    ask({ text: "hi", model: broke.model, connection, identity, query, policy: { allowWrites: false, disabled: [] }, catalog: [], runTool: async () => ({}) }),
    (error) => {
      assert.equal(error.message, "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.");
      assert.equal(error.status, 502);
      return true;
    },
  );
});

// A temp skill store with one runbook skill and, optionally, a disabled one.
function skillsWith(names = ["vendor-spend"], off = []) {
  const skills = openSkillStore(mkdtempSync(join(tmpdir(), "hn-ask-skills-")));
  const files = names.map((name) => ({
    path: `${name}/SKILL.md`,
    bytes: Buffer.from(`---\nname: ${name}\ndescription: Rank vendors by spend for ${name}.\n---\n\nUse ns_runCustomSuiteQL. See [rules](shared/RULES.md).\n`),
  }));
  files.push({ path: `${names[0]}/shared/RULES.md`, bytes: Buffer.from("Read-only.") });
  skills.importStaged(skills.stage(files, { kind: "folder" }).id, names);
  for (const name of off) skills.toggle(name, false);
  return skills;
}

const suiteqlTool = [{ name: "ns_runCustomSuiteQL", description: "Run SuiteQL", schema: { type: "object", properties: {} } }];
const toolCall = (id, toolName, input) => ({ content: [{ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) }], finishReason: "tool-calls", usage });

test("skill_read runs locally with no pending, and the step names the skill", async () => {
  let calls = 0;
  const ran = [];
  const result = await ask({
    text: "Top vendors?",
    model: model(async () => {
      calls += 1;
      if (calls === 1) return toolCall("s1", "skill_read", { name: "vendor-spend" });
      if (calls === 2) return toolCall("s2", "skill_read", { name: "vendor-spend", path: "shared/RULES.md" });
      if (calls === 3) return toolCall("q1", "ns_runCustomSuiteQL", { sqlQuery: "select 1" });
      return { content: [{ type: "text", text: "Acme." }], finishReason: "stop", usage };
    }),
    connection,
    identity,
    query,
    policy: { allowWrites: false, disabled: [] },
    catalog: suiteqlTool,
    skills: skillsWith(),
    runTool: async (name) => {
      ran.push(name);
      return { rows: [] };
    },
  });
  assert.deepEqual(ran, ["ns_runCustomSuiteQL"], "skill_read never reaches MCP");
  assert.equal(result.pending, null);
  assert.deepEqual(result.steps.map((step) => [step.name, step.ok, step.detail]), [
    ["skill_read", true, "vendor-spend"],
    ["skill_read", true, "vendor-spend · shared/RULES.md"],
    ["ns_runCustomSuiteQL", true, undefined],
  ]);
  const read = JSON.parse(result.transcript.find((message) => message.tool_call_id === "s2").content);
  assert.equal(read.text, "Read-only.");
  assert.ok(listTrace().some((entry) => entry.source === "ask" && entry.name === "model mock" && /input tokens/.test(entry.detail)));
});

test("a write proposed after a skill read still pauses for Run", async () => {
  let calls = 0;
  const result = await ask({
    text: "Create the vendor the skill says.",
    model: model(async () => {
      calls += 1;
      if (calls === 1) return toolCall("s1", "skill_read", { name: "vendor-spend" });
      return toolCall("w1", "ns_createRecord", { recordType: "vendor", data: "{}" });
    }),
    connection,
    identity,
    query,
    policy: { allowWrites: true, disabled: [] },
    catalog: createTool,
    skills: skillsWith(),
    runTool: async () => assert.fail("the write must not run"),
  });
  assert.equal(result.pending.length, 1);
  assert.ok(result.pendingId);
});

test("skill-only turns don't use up MAX_TURNS, and their own cap holds", async () => {
  let calls = 0;
  const result = await ask({
    text: "Read forever.",
    model: model(async () => {
      calls += 1;
      return toolCall(`s${calls}`, "skill_read", { name: "vendor-spend", page: calls });
    }),
    connection,
    identity,
    query,
    policy: { allowWrites: false, disabled: [] },
    catalog: suiteqlTool,
    skills: skillsWith(),
    runTool: async () => ({}),
  });
  assert.equal(calls, MAX_SKILL_TURNS + MAX_TURNS);
  assert.match(result.answer, /I stopped after 12 steps/);
});

test("the prompt lists only enabled skills with the precedence rule, and no skills means no skill_read", async () => {
  const seen = [];
  const capture = () =>
    model(async (options) => {
      seen.push(options);
      return { content: [{ type: "text", text: "ok" }], finishReason: "stop", usage };
    });
  const base = { text: "Hi", connection, identity, query, policy: { allowWrites: false, disabled: [] }, catalog: suiteqlTool, runTool: async () => ({}) };
  await ask({ ...base, model: capture(), skills: skillsWith(["vendor-spend", "old-skill"], ["old-skill"]) });
  const system = seen[0].prompt.find((message) => message.role === "system").content;
  assert.match(system, /- vendor-spend: Rank vendors/);
  assert.doesNotMatch(system, /old-skill/);
  assert.match(system, /The rules above win over a skill/);
  assert.deepEqual(seen[0].tools.map((tool) => tool.name), ["ns_runCustomSuiteQL", "skill_read"]);

  await ask({ ...base, model: capture(), skills: skillsWith(["vendor-spend"], ["vendor-spend"]) });
  assert.deepEqual(seen[1].tools.map((tool) => tool.name), ["ns_runCustomSuiteQL"]);
  assert.equal(seen[1].prompt.find((message) => message.role === "system").content, systemPrompt(identity));
  assert.doesNotMatch(systemPrompt(identity), /skill/i);
});

test("the skill listing cuts descriptions evenly to stay under 6,000 characters", () => {
  const skills = Array.from({ length: 15 }, (_, index) => ({ name: `skill-${index}`, description: "d".repeat(1024) }));
  const listing = skillListing(skills);
  assert.equal(listing.shortened, 15);
  const lines = listing.text.split("\n").filter((line) => line.startsWith("- "));
  assert.ok(lines.join("\n").length <= SKILL_LISTING_CHARS);
  assert.equal(new Set(lines.map((line) => line.length)).size, 2, "every description gets the same share");
  assert.equal(skillListing([{ name: "a", description: "short" }]).shortened, 0);
});

test("a context-length error becomes one plain sentence", async () => {
  for (const text of ["This model's maximum context length is 8192 tokens", "prompt is too long: 210000 tokens > 200000", "the request exceeds the available context size, n_ctx 4096"]) {
    assert.equal(contextTooSmall(text), true, text);
  }
  assert.equal(contextTooSmall("Invalid API key"), false);
  await assert.rejects(
    ask({
      text: "Hi",
      model: model(async () => {
        throw new Error("Trying to keep the first 9000 tokens when context length is 8192");
      }),
      connection,
      identity,
      query,
      policy: { allowWrites: false, disabled: [] },
      catalog: suiteqlTool,
      skills: skillsWith(),
      runTool: async () => ({}),
    }),
    (error) => error.message === CONTEXT_MESSAGE,
  );
});

test("provider data on a tool call, such as Gemini's thoughtSignature, goes back with it on later turns and requests", async () => {
  const signature = { google: { thoughtSignature: "sig-abc" } };
  const prompts = [];
  // Only the first model call of the whole test proposes a tool call. Every later call answers in text.
  let calls = 0;
  const signed = () =>
    model(async (options) => {
      prompts.push(options.prompt);
      calls += 1;
      if (calls === 1) return { content: [{ type: "tool-call", toolCallId: "q1", toolName: "ns_runCustomSuiteQL", input: "{}", providerMetadata: signature }], finishReason: "tool-calls", usage };
      return { content: [{ type: "text", text: "Done." }], finishReason: "stop", usage };
    });
  const base = { connection, identity, query, policy: { allowWrites: false, disabled: [] }, catalog: suiteqlTool, skills: skillsWith(), runTool: async () => ({ rows: [] }) };
  const first = await ask({ ...base, text: "Count orders.", model: signed() });
  const replayed = (prompt) => prompt.find((message) => message.role === "assistant").content.find((part) => part.type === "tool-call");
  assert.deepEqual(replayed(prompts[1]).providerOptions, signature, "same request, next turn");

  // The browser sends the transcript back as it got it. A later request still carries the signature.
  const browser = JSON.parse(JSON.stringify(first.transcript));
  await ask({ ...base, text: "And invoices?", transcript: browser, model: signed() });
  assert.deepEqual(replayed(prompts[2]).providerOptions, signature, "next request");
  assert.equal(prompts.length, 3);

  // From the browser, only google.thoughtSignature survives. Other provider settings and oversized values are dropped.
  browser[1].tool_calls[0].provider_options = {
    google: { thoughtSignature: "sig-abc", cachedContent: "cachedContents/evil", safetySettings: [] },
    openai: { store: true, user: "someone" },
    anthropic: { cacheControl: { type: "ephemeral" } },
  };
  await ask({ ...base, text: "Again?", transcript: browser, model: signed() });
  assert.deepEqual(replayed(prompts[3]).providerOptions, signature);
  for (const junk of [{ google: { thoughtSignature: "x".repeat(16_001) } }, { google: { thoughtSignature: { nested: true } } }, { openai: { itemId: "i1" } }, "text", null]) {
    browser[1].tool_calls[0].provider_options = junk;
    await ask({ ...base, text: "Again?", transcript: browser, model: signed() });
    assert.equal(replayed(prompts.at(-1)).providerOptions, undefined, JSON.stringify(junk)?.slice(0, 60));
  }
});

import { randomBytes } from "node:crypto";
import { APICallError, dynamicTool, generateText, jsonSchema } from "ai";
import { WRITE_TOOLS, assistantCanCall } from "./kinds.mjs";
import { callTool, listTools, osmcpIdentity, withSource } from "./osmcp.mjs";
import { modelStore } from "./models.mjs";
import { readPolicy } from "./policy.mjs";
import { languageModel, scrub } from "./providers.mjs";

const ROLES = new Set(["user", "assistant", "tool"]);

// Writes the model proposed, held here until the person confirms them by id.
// The client never sends the tool calls back, so it cannot change what runs.
export const PENDING_TTL_MS = 10 * 60_000;
const pendingWrites = new Map();

function holdPending(transcript) {
  const now = Date.now();
  for (const [key, entry] of pendingWrites) if (entry.expires <= now) pendingWrites.delete(key);
  const id = randomBytes(16).toString("base64url");
  pendingWrites.set(id, { transcript, expires: now + PENDING_TTL_MS });
  return id;
}

function takePending(id) {
  const entry = pendingWrites.get(String(id || ""));
  if (entry) pendingWrites.delete(String(id));
  if (!entry || entry.expires <= Date.now()) {
    const error = new Error("That change expired or was already handled. Ask again.");
    error.status = 400;
    throw error;
  }
  return entry.transcript;
}

function refusal(name, policy) {
  if (assistantCanCall(name, policy)) return "";
  if (WRITE_TOOLS.has(name) && !policy.allowWrites) return "Writes are off in Settings.";
  return "This tool is turned off for Ask.";
}

function systemPrompt(identity) {
  const account = identity?.accountId || "the connected account";
  const role = identity?.roleId || "the connected role";
  return [
    `You answer questions about NetSuite account ${account} as role ${role}.`,
    "Call tools for every figure. Do not invent amounts, names, or record ids.",
    "Use ns_runCustomSuiteQL for lists and counts. Call ns_getSuiteQLMetadata before using a column you have not seen.",
    "Use ns_listAllReports, ns_getSubsidiaries, and ns_runReport for saved reports. Dates are YYYY-MM-DD.",
    "A write tool posts a record. Call it only when the person asked to change NetSuite. The server pauses for confirmation before it runs.",
    "Keep the reply short. Name the figure and the tool that produced it.",
  ].join(" ");
}

function sanitize(transcript) {
  if (!Array.isArray(transcript)) return [];
  return transcript.slice(-30).flatMap((message) => {
    if (!message || !ROLES.has(message.role)) return [];
    const next = { role: message.role };
    if (message.role === "tool") {
      if (!message.tool_call_id) return [];
      next.tool_call_id = String(message.tool_call_id).slice(0, 80);
      next.name = String(message.name || "").slice(0, 80);
      next.content = String(message.content || "").slice(0, 14000);
      return [next];
    }
    if (message.content) next.content = String(message.content).slice(0, 8000);
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      next.tool_calls = message.tool_calls.slice(0, 8).map((call) => ({
        id: String(call.id || "").slice(0, 80),
        type: "function",
        function: {
          name: String(call.function?.name || "").slice(0, 80),
          arguments:
            typeof call.function?.arguments === "string"
              ? call.function.arguments.slice(0, 8000)
              : JSON.stringify(call.function?.arguments || {}),
        },
      }));
    }
    if (!next.content && !next.tool_calls) return [];
    return [next];
  });
}

function parseArgs(call) {
  try {
    const raw = call.function?.arguments ?? call.input ?? "{}";
    return typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
  } catch {
    return {};
  }
}

function toModelMessages(messages) {
  const out = [];
  let toolBatch = [];
  const flushTools = () => {
    if (!toolBatch.length) return;
    out.push({ role: "tool", content: toolBatch });
    toolBatch = [];
  };
  for (const message of messages) {
    if (message.role !== "tool") flushTools();
    if (message.role === "system") {
      out.push({ role: "system", content: String(message.content || "") });
    } else if (message.role === "user") {
      out.push({ role: "user", content: String(message.content || "") });
    } else if (message.role === "assistant") {
      const content = [];
      if (message.content) content.push({ type: "text", text: String(message.content) });
      for (const call of message.tool_calls || []) {
        content.push({
          type: "tool-call",
          toolCallId: call.id,
          toolName: call.function.name,
          input: parseArgs(call),
        });
      }
      if (content.length) out.push({ role: "assistant", content });
    } else if (message.role === "tool") {
      let value = message.content;
      try {
        value = JSON.parse(message.content);
      } catch {
        value = String(message.content || "");
      }
      toolBatch.push({
        type: "tool-result",
        toolCallId: message.tool_call_id,
        toolName: message.name || "tool",
        output: typeof value === "string" ? { type: "text", value } : { type: "json", value },
      });
    }
  }
  flushTools();
  return out;
}

function clientCall(call) {
  return {
    id: call.toolCallId,
    type: "function",
    function: { name: call.toolName, arguments: JSON.stringify(call.input ?? {}) },
  };
}

async function catalogTools(policy) {
  const catalog = await listTools();
  return catalog.filter((tool) => assistantCanCall(tool.name, policy));
}

function sdkTools(catalog) {
  const tools = {};
  for (const tool of catalog) {
    const schema = tool.schema?.type ? tool.schema : { type: "object", properties: tool.schema?.properties || {} };
    tools[tool.name] = dynamicTool({
      description: String(tool.description || tool.name).slice(0, 700),
      inputSchema: jsonSchema(schema),
    });
  }
  return tools;
}

async function step(model, messages, tools, secret) {
  const instructions = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const prompt = messages.filter((message) => message.role !== "system");
  try {
    return await generateText({
      model,
      instructions: instructions || undefined,
      messages: prompt,
      tools: Object.keys(tools).length ? tools : undefined,
      temperature: 0.1,
      abortSignal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    const message = scrub(error instanceof Error ? error.message : "The model request failed.", secret);
    const wrapped = new Error(message || "The model request failed.");
    wrapped.status = APICallError.isInstance(error) && error.statusCode === 401 ? 400 : 502;
    throw wrapped;
  }
}

async function loop(clientMessages, { model, secret, policy, runTool, catalog }) {
  const tools = sdkTools(catalog);
  const messages = toModelMessages(clientMessages);
  const steps = [];
  for (let turn = 0; turn < 4; turn += 1) {
    const result = await step(model, messages, tools, secret);
    const calls = result.toolCalls || [];
    const assistant = {
      role: "assistant",
      content: result.text || "",
      ...(calls.length ? { tool_calls: calls.map(clientCall) } : {}),
    };
    clientMessages.push(assistant);
    if (!calls.length) {
      return { answer: result.text || "", steps, pending: null, transcript: clientMessages.filter((item) => item.role !== "system") };
    }
    const writes = calls.filter((call) => WRITE_TOOLS.has(call.toolName) && !refusal(call.toolName, policy));
    if (writes.length) {
      const transcript = clientMessages.filter((item) => item.role !== "system");
      return {
        answer: result.text || "",
        steps,
        pending: calls.map((call) => ({ id: call.toolCallId, name: call.toolName, arguments: call.input ?? {} })),
        pendingId: holdPending(transcript),
        transcript,
      };
    }
    for (const call of calls) {
      const blocked = refusal(call.toolName, policy);
      let payload;
      let ok = true;
      let error = "";
      if (blocked) {
        payload = { error: blocked };
        ok = false;
        error = payload.error;
      } else {
        try {
          payload = await runTool(call.toolName, call.input ?? {});
        } catch (reason) {
          payload = { error: reason.message || "The tool failed." };
          ok = false;
          error = payload.error;
        }
      }
      const content = JSON.stringify(payload).slice(0, 14000);
      clientMessages.push({ role: "tool", tool_call_id: call.toolCallId, name: call.toolName, content });
      steps.push({ name: call.toolName, ok, ...(error ? { error } : {}) });
    }
    messages.length = 0;
    messages.push(...toModelMessages(clientMessages));
  }
  return {
    answer: "I stopped after several tool calls. Ask a narrower question.",
    steps,
    pending: null,
    transcript: clientMessages.filter((item) => item.role !== "system"),
  };
}

async function context(options) {
  const connection = options.connection || modelStore.require(options.modelId);
  const policy = options.policy || readPolicy();
  const catalog = options.catalog || (await catalogTools(policy));
  const identity = options.identity === undefined ? await osmcpIdentity().catch(() => null) : options.identity;
  const model = options.model || languageModel(connection);
  const runTool = options.runTool || ((name, args) => withSource("ask", () => callTool(name, args)));
  return { connection, policy, catalog, identity, model, runTool };
}

export async function ask({ text, transcript, ...options }) {
  const question = String(text || "").trim();
  if (!question) {
    const error = new Error("Ask a question first.");
    error.status = 400;
    throw error;
  }
  const ready = await context(options);
  const messages = sanitize(transcript);
  messages.push({ role: "user", content: question.slice(0, 4000) });
  return loop([{ role: "system", content: systemPrompt(ready.identity) }, ...messages], {
    model: ready.model,
    secret: ready.connection.apiKey,
    policy: ready.policy,
    runTool: ready.runTool,
    catalog: ready.catalog,
  });
}

export async function confirmAsk({ id, approved, ...options }) {
  const messages = takePending(id);
  const assistant = messages[messages.length - 1];
  const ready = await context(options);
  for (const call of assistant.tool_calls) {
    const name = call.function.name;
    const blocked = refusal(name, ready.policy);
    let payload;
    if (!approved) {
      payload = { cancelled: true, error: "The user did not confirm this change." };
    } else if (blocked) {
      payload = { error: blocked };
    } else {
      try {
        payload = await ready.runTool(name, parseArgs(call));
      } catch (error) {
        payload = { error: error.message };
      }
    }
    messages.push({ role: "tool", tool_call_id: call.id, name, content: JSON.stringify(payload).slice(0, 14000) });
  }
  return loop([{ role: "system", content: systemPrompt(ready.identity) }, ...messages], {
    model: ready.model,
    secret: ready.connection.apiKey,
    policy: ready.policy,
    runTool: ready.runTool,
    catalog: ready.catalog,
  });
}

export async function pingModel(modelId) {
  const connection = modelStore.require(modelId);
  const result = await step(
    languageModel(connection),
    [{ role: "user", content: "Reply with the single word ready." }],
    {},
    connection.apiKey,
  );
  return String(result.text || "").trim();
}

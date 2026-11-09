import assert from "node:assert/strict";
import test from "node:test";
import { generateText } from "ai";
import { languageModel, listModels } from "../server/providers.mjs";

function chatReply() {
  return {
    id: "chatcmpl_test",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: "ready" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function watch(reply) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const bodyText = init?.body || (input instanceof Request ? await input.clone().text() : "");
    calls.push({ url, body: bodyText ? JSON.parse(String(bodyText)) : {} });
    const payload = typeof reply === "function" ? reply(url) : reply;
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

async function say(provider, extra, reply = chatReply()) {
  const seen = watch(reply);
  const result = await generateText({
    model: languageModel({ provider, model: extra.model, apiKey: "sk-test-secret", baseUrl: extra.baseUrl || "" }, seen.fetchImpl),
    prompt: "Reply with the single word ready.",
  });
  return { text: result.text, call: seen.calls[0] };
}

function responsesReply(output) {
  return {
    id: "resp_test",
    object: "response",
    created_at: 1794228000,
    model: "gpt-5.5",
    output,
    status: "completed",
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
}

const ready = [{ id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ready", annotations: [] }] }];

// Live, gpt-5.3-codex on chat completions answered "This model is not supported in the v1/chat/completions endpoint. Use the v1/responses endpoint instead."
test("OpenAI uses the Responses API, which every OpenAI chat model accepts", async () => {
  const openai = await say("openai", { model: "gpt-5.3-codex" }, responsesReply(ready));
  assert.equal(openai.call.url, "https://api.openai.com/v1/responses");
  assert.equal(openai.call.body.model, "gpt-5.3-codex");
  assert.equal(openai.text, "ready");
});

test("Groq, Mistral, and a compatible host use chat completions", async () => {
  const groq = await say("groq", { model: "llama-3.1-8b-instant" });
  assert.match(groq.call.url, /^https:\/\/api\.groq\.com\/openai\/v1\/chat\/completions/);
  assert.equal(groq.call.body.model, "llama-3.1-8b-instant");

  const mistral = await say("mistral", { model: "mistral-large-latest" });
  assert.match(mistral.call.url, /^https:\/\/api\.mistral\.ai\/v1\/chat\/completions/);

  const compatible = await say("compatible", { model: "local-model", baseUrl: "https://models.example/v1" });
  assert.equal(compatible.call.url, "https://models.example/v1/chat/completions");
  assert.equal(compatible.call.body.model, "local-model");
});

test("Claude uses the messages API", async () => {
  const result = await say("anthropic", { model: "claude-sonnet-5-5" }, {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "ready" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  assert.equal(result.call.url, "https://api.anthropic.com/v1/messages");
  assert.equal(result.call.body.model, "claude-sonnet-5-5");
  assert.equal(result.text, "ready");
});

test("Gemini uses generateContent", async () => {
  const result = await say("google", { model: "gemini-4-argon" }, {
    candidates: [{ content: { parts: [{ text: "ready" }], role: "model" }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  });
  assert.match(result.call.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-4-argon:generateContent/);
  assert.equal(result.text, "ready");
});

test("Grok uses the responses API", async () => {
  const result = await say("xai", { model: "grok-4.7" }, {
    id: "resp_test",
    object: "response",
    output: [{ id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ready" }] }],
    status: "completed",
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  });
  assert.match(result.call.url, /^https:\/\/api\.x\.ai\/v1\/responses/);
  assert.equal(result.call.body.model, "grok-4.7");
  assert.equal(result.text, "ready");
});

test("the model list comes from each provider's own endpoint", async () => {
  const seen = [];
  const reply = (body, status = 200) => async (url, init) => {
    seen.push({ url: String(url), headers: init.headers });
    return new Response(JSON.stringify(body), { status });
  };
  const compatible = await listModels({ provider: "compatible", baseUrl: "https://gemma.example/v1", apiKey: "sk-test" }, reply({ data: [{ id: "gemma-4-27b" }, { id: "gemma-4-9b" }, { id: "gemma-4-27b" }] }));
  assert.deepEqual(compatible, ["gemma-4-27b", "gemma-4-9b"]);
  assert.equal(seen[0].url, "https://gemma.example/v1/models");
  assert.equal(seen[0].headers.Authorization, "Bearer sk-test");

  await listModels({ provider: "anthropic", apiKey: "sk-ant" }, reply({ data: [{ id: "claude-sonnet-5-5" }] }));
  assert.match(seen[1].url, /^https:\/\/api\.anthropic\.com\/v1\/models/);
  assert.equal(seen[1].headers["x-api-key"], "sk-ant");

  const gemini = await listModels(
    { provider: "google", apiKey: "g-key" },
    reply({ models: [{ name: "models/gemini-4-argon", supportedGenerationMethods: ["generateContent"] }, { name: "models/embedding-9", supportedGenerationMethods: ["embedContent"] }] }),
  );
  assert.deepEqual(gemini, ["gemini-4-argon"]);
});

test("a rejected key or a wrong URL comes back in plain words, without the key", async () => {
  const denied = async () => new Response("{}", { status: 401 });
  await assert.rejects(listModels({ provider: "openai", apiKey: "sk-bad" }, denied), { message: "The provider did not accept this API key.", status: 400 });
  const html = async () => new Response("<html>sk-secret-key</html>", { status: 200 });
  await assert.rejects(listModels({ provider: "compatible", baseUrl: "https://x.example", apiKey: "sk-secret-key" }, html), /did not send a model list/);
  const broken = async () => new Response("bad key sk-secret-key", { status: 500 });
  await assert.rejects(listModels({ provider: "compatible", baseUrl: "https://x.example", apiKey: "sk-secret-key" }, broken), (error) => !error.message.includes("sk-secret-key"));
  const offline = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(listModels({ provider: "compatible", baseUrl: "https://x.example/v1", apiKey: "k" }, offline), /could not reach x\.example/);
});

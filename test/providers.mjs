import assert from "node:assert/strict";
import test from "node:test";
import { generateText } from "ai";
import { languageModel } from "../server/providers.mjs";

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

test("OpenAI, Groq, Mistral, and a compatible host use chat completions", async () => {
  const openai = await say("openai", { model: "gpt-5.2" });
  assert.equal(openai.call.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(openai.call.body.model, "gpt-5.2");
  assert.equal(openai.text, "ready");

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

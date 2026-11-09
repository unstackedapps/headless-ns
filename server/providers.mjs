import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";

export function scrub(message, secret) {
  const text = String(message || "The model request failed.");
  if (!secret || secret.length < 4 || !text.includes(secret)) return text;
  return text.split(secret).join("••••");
}

export function languageModel(connection, fetchImpl) {
  const settings = { apiKey: connection.apiKey };
  if (fetchImpl) settings.fetch = fetchImpl;
  switch (connection.provider) {
    case "anthropic":
      return createAnthropic(settings)(connection.model);
    case "google":
      return createGoogle(settings)(connection.model);
    case "xai":
      return createXai(settings)(connection.model);
    case "groq":
      return createGroq(settings)(connection.model);
    case "mistral":
      return createMistral(settings)(connection.model);
    case "compatible":
      return createOpenAI({ ...settings, baseURL: connection.baseUrl, name: "compatible" }).chat(connection.model);
    default:
      // The Responses API, because OpenAI's codex and pro models refuse chat completions.
      return createOpenAI(settings).responses(connection.model);
  }
}

const MODEL_LISTS = {
  openai: "https://api.openai.com/v1/models",
  groq: "https://api.groq.com/openai/v1/models",
  mistral: "https://api.mistral.ai/v1/models",
  xai: "https://api.x.ai/v1/models",
  anthropic: "https://api.anthropic.com/v1/models?limit=1000",
  google: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
};

function modelListRequest(connection) {
  if (connection.provider === "anthropic") {
    return { url: MODEL_LISTS.anthropic, headers: { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01" } };
  }
  if (connection.provider === "google") return { url: MODEL_LISTS.google, headers: { "x-goog-api-key": connection.apiKey } };
  const url = connection.provider === "compatible" ? `${connection.baseUrl}/models` : MODEL_LISTS[connection.provider] || MODEL_LISTS.openai;
  return { url, headers: { Authorization: `Bearer ${connection.apiKey}` } };
}

function listFailure(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// Models that make speech, audio, images or embeddings, or need an API other than chat. Each refused Ask's test message.
const NOT_CHAT = /embed|tts|transcri|whisper|dall-e|image|moderation|realtime|audio|sora|lyria|deep-research|antigravity|computer-use/i;

// The ids a provider offers, from its own model list, without the models Ask cannot chat with.
export async function listModels(connection, fetchImpl = fetch) {
  const { url, headers } = modelListRequest(connection);
  let response;
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw listFailure(`The app could not reach ${new URL(url).host}. Check the provider URL.`);
  }
  const text = await response.text();
  if (response.status === 401 || response.status === 403) throw listFailure("The provider did not accept this API key.");
  if (!response.ok) throw listFailure(scrub(`The provider answered ${response.status}. ${text.slice(0, 200)}`, connection.apiKey));
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw listFailure("The provider did not send a model list. Check the provider URL. It usually ends in /v1.");
  }
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  const ids = rows
    .filter((row) => !Array.isArray(row?.supportedGenerationMethods) || row.supportedGenerationMethods.includes("generateContent"))
    .map((row) => String(row?.id || row?.name || "").replace(/^models\//, ""))
    .filter((id) => id && !NOT_CHAT.test(id));
  return [...new Set(ids)].sort();
}

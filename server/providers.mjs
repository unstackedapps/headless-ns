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
      return createOpenAI(settings).chat(connection.model);
  }
}

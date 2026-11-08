import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

function loadEnvFile() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadEnvFile();

const ephemeralSecret = randomBytes(32).toString("base64url");

export const PORT = 5173;
export const REDIRECT_URI = `https://localhost:${PORT}/api/auth/callback`;
export const SCOPES = "openid email rest_webservices";

export function accountId() {
  return process.env.NETSUITE_ACCOUNT_ID?.trim() || "TD3138390";
}

export function clientId() {
  return process.env.NETSUITE_CLIENT_ID?.trim() || "";
}

export function clientSecret() {
  return process.env.NETSUITE_CLIENT_SECRET?.trim() || "";
}

export function sessionSecret() {
  return process.env.SESSION_SECRET?.trim() || ephemeralSecret;
}

export function sessionSecretIsEphemeral() {
  return !process.env.SESSION_SECRET?.trim();
}

export function accountHost(id = accountId()) {
  const host = String(id).trim().toLowerCase().replace(/-/g, "_");
  if (!/^[a-z0-9_]+$/.test(host)) {
    throw new Error("NETSUITE_ACCOUNT_ID is not a valid account id.");
  }
  return host;
}

export function appOrigin() {
  return `https://${accountHost()}.app.netsuite.com`;
}

export function suiteTalkHost() {
  return `${accountHost()}.suitetalk.api.netsuite.com`;
}

export function osmcpUrl() {
  return process.env.OSMCP_URL?.trim() || "https://app.opensuitemcp.com/api/mcp";
}

export function osmcpToken() {
  return process.env.OSMCP_TOKEN?.trim() || "";
}

export function connector() {
  const value = process.env.CONNECTOR?.trim();
  if (value === "opensuitemcp" || value === "netsuite" || value === "custom") return value;
  return osmcpToken() ? "opensuitemcp" : "netsuite";
}

export function customMcpUrl() {
  return process.env.MCP_URL?.trim() || "";
}

export function customMcpToken() {
  return process.env.MCP_TOKEN?.trim() || "";
}

export function mcpClientId() {
  return process.env.NETSUITE_MCP_CLIENT_ID?.trim() || "";
}

export function mcpClientSecret() {
  return process.env.NETSUITE_MCP_CLIENT_SECRET?.trim() || "";
}

export function mcpSuite() {
  return process.env.NETSUITE_MCP_SUITE?.trim() === "all" ? "all" : "standard";
}

export function netsuiteMcpUrl() {
  const path = mcpSuite() === "all" ? "all" : "suiteapp/com.netsuite.mcpstandardtools";
  return `https://${suiteTalkHost()}/services/mcp/v1/${path}`;
}

const SECRET_KEYS = new Set(["OSMCP_TOKEN", "MCP_TOKEN", "NETSUITE_MCP_CLIENT_SECRET", "LLM_API_KEY"]);

export function updateEnv(keys, updates) {
  let next = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  if (next.length && !next.endsWith("\n")) next += "\n";
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
    const value = updates[key] == null ? "" : String(updates[key]);
    if (SECRET_KEYS.has(key) && value.trim() === "") continue;
    process.env[key] = value.trim();
    const line = `${key}=${encodeEnvValue(value.trim())}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    next = pattern.test(next) ? next.replace(pattern, line) : `${next}${line}\n`;
  }
  writeFileSync(".env", next);
}

export function llmBaseUrl() {
  return (process.env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
}

export function llmApiKey() {
  return process.env.LLM_API_KEY?.trim() || "";
}

export function llmModel() {
  return process.env.LLM_MODEL?.trim() || "gpt-4o-mini";
}

export function llmKeyHint() {
  const key = llmApiKey();
  if (!key) return "";
  return key.length > 8 ? `…${key.slice(-4)}` : "saved";
}

const LLM_KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"];

function encodeEnvValue(value) {
  const clean = String(value).replace(/[\r\n]/g, "");
  if (/[\s#"]/.test(clean)) return `"${clean.replace(/"/g, "")}"`;
  return clean;
}

export function updateLlmEnv(updates) {
  updateEnv(LLM_KEYS, updates);
}

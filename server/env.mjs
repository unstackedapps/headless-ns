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

export const PORT = Number(process.env.PORT) || 5173;
export const REDIRECT_URI = `https://localhost:${PORT}/api/auth/callback`;
export const SCOPES = "openid email rest_webservices";

export function accountId() {
  return process.env.NETSUITE_ACCOUNT_ID?.trim() || "";
}

// NetSuite ids look like 1234567, 1234567_SB1, or TSTDRV123456.
export function validAccountId(value) {
  return /^[A-Za-z0-9_-]{1,40}$/.test(String(value ?? ""));
}

// The account an MCP connection reported, so record links work without NETSUITE_ACCOUNT_ID.
let reportedAccount = "";

export function rememberAccount(id) {
  if (validAccountId(id)) reportedAccount = id;
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
  if (!id) throw new Error("Add the NetSuite account ID in Settings.");
  const host = String(id).trim().toLowerCase().replace(/-/g, "_");
  if (!/^[a-z0-9_]+$/.test(host)) {
    throw new Error("NETSUITE_ACCOUNT_ID is not a valid account id.");
  }
  return host;
}

export function appOrigin() {
  const id = accountId() || reportedAccount;
  return id ? `https://${accountHost(id)}.app.netsuite.com` : "";
}

export function suiteTalkHost() {
  return `${accountHost()}.suitetalk.api.netsuite.com`;
}

// CONNECTOR=opensuitemcp and the OSMCP_* keys are the old names for a custom MCP server.
export function connector() {
  const value = process.env.CONNECTOR?.trim();
  if (value === "netsuite") return value;
  if (value === "custom" || value === "opensuitemcp") return "custom";
  return customMcpToken() ? "custom" : "netsuite";
}

export function customMcpUrl() {
  return process.env.MCP_URL?.trim() || process.env.OSMCP_URL?.trim() || "";
}

export function customMcpToken() {
  return process.env.MCP_TOKEN?.trim() || process.env.OSMCP_TOKEN?.trim() || "";
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
  if (!accountId()) return "";
  const path = mcpSuite() === "all" ? "all" : "suiteapp/com.netsuite.mcpstandardtools";
  return `https://${suiteTalkHost()}/services/mcp/v1/${path}`;
}

const SECRET_KEYS = new Set(["MCP_TOKEN", "NETSUITE_MCP_CLIENT_SECRET"]);

export function updateEnv(keys, updates) {
  let next = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  if (next.length && !next.endsWith("\n")) next += "\n";
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
    // A blank secret keeps the saved one. null clears it.
    const value = updates[key] == null ? "" : String(updates[key]);
    if (SECRET_KEYS.has(key) && updates[key] !== null && value.trim() === "") continue;
    process.env[key] = value.trim();
    const line = `${key}=${encodeEnvValue(value.trim())}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    next = pattern.test(next) ? next.replace(pattern, line) : `${next}${line}\n`;
  }
  writeFileSync(".env", next);
}

function encodeEnvValue(value) {
  const clean = String(value).replace(/[\r\n]/g, "");
  if (/[\s#"]/.test(clean)) return `"${clean.replace(/"/g, "")}"`;
  return clean;
}

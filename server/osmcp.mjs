import { AsyncLocalStorage } from "node:async_hooks";
import { connector, customMcpToken, customMcpUrl, netsuiteMcpUrl, osmcpToken, osmcpUrl, rememberAccount } from "./env.mjs";
import { recordTrace } from "./trace.mjs";

const authStore = new AsyncLocalStorage();

export function withAuth(auth, fn) {
  return authStore.run(auth, fn);
}

const sourceStore = new AsyncLocalStorage();

export function withSource(source, fn) {
  return sourceStore.run(source, fn);
}

const PROTOCOL = "2026-07-28";

const recordPermissions = {
  customer: "Lists > Customers",
  transaction: "Transactions > Sales Order, Estimate, Invoice, and Vendor Bill",
  item: "Lists > Items",
  employee: "Lists > Employees",
  inventorybalance: "Lists > Items",
};

function plainSuiteqlError(message) {
  const record = /Record '([^']+)' was not found/i.exec(message);
  if (!record) return String(message).replace(/^Error executing SuiteQL query:\s*/i, "");
  const name = record[1];
  const permission = recordPermissions[name.toLowerCase()] || `the ${name} record`;
  return `This role cannot see ${name}. Add View for ${permission} on that role, then reload.`;
}

// NetSuite MCP write tools answer {success:false, error:"HTTP 400: {...}"} without isError.
export function toolFailure(payload) {
  if (payload?.success !== false) return "";
  const raw = String(payload.error || payload.message || "The tool failed.");
  const details = [...raw.matchAll(/"detail"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1].replace(/\\"/g, '"'));
  const text = details.length ? details.join(" ") : raw;
  return text.replace(/^Error while accessing a resource\.\s*/i, "").replace(/^API call failed:\s*/i, "").trim();
}

function payloadOf(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const text = result?.content?.find((part) => part.type === "text")?.text || "";
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function traceDetail(name, args) {
  if (!args || typeof args !== "object") return name;
  if (args.contentBase64) return "file bytes omitted";
  if (args.sqlQuery) return String(args.sqlQuery).replace(/\s+/g, " ").slice(0, 180);
  return Object.keys(args).slice(0, 8).join(", ");
}

function activeAuth() {
  const stored = authStore.getStore();
  if (stored?.token) return stored;
  const kind = connector();
  if (kind === "custom") {
    return { url: customMcpUrl(), token: customMcpToken(), label: "MCP server", protocol: "2025-06-18", handshake: false };
  }
  if (kind === "opensuitemcp") {
    return { url: osmcpUrl(), token: osmcpToken(), label: "OpenSuiteMCP", protocol: PROTOCOL, handshake: false };
  }
  return { url: netsuiteMcpUrl(), token: "", label: "NetSuite", protocol: "2025-06-18", handshake: true };
}

const mcpSessions = new Map();

async function readMcpBody(response) {
  const text = await response.text();
  if (!text) return {};
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/event-stream")) {
    let last = {};
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      last = JSON.parse(data);
    }
    return last;
  }
  return JSON.parse(text);
}

async function postRpc(auth, method, params, name, sessionId) {
  if (!auth.url) {
    const error = new Error(auth.label === "NetSuite" ? "Add the NetSuite account ID in Settings." : "Add the MCP server URL in Settings.");
    error.status = 400;
    throw error;
  }
  if (!auth.token) {
    const error = new Error(auth.label === "NetSuite" ? "Sign in with NetSuite." : `Add a token for ${auth.label} in Settings.`);
    error.status = 401;
    throw error;
  }
  const headers = {
    Authorization: `Bearer ${auth.token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": auth.protocol,
  };
  if (auth.label === "OpenSuiteMCP") {
    headers["Mcp-Method"] = method;
    if (name) headers["Mcp-Name"] = name;
  }
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const response = await fetch(auth.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || {} }),
  });
  const body = await readMcpBody(response).catch(() => ({}));
  if (!response.ok || body.error) {
    const error = new Error(body?.error?.message || `${auth.label} rejected the call (${response.status}).`);
    error.status = response.status === 401 ? 401 : response.status || 502;
    throw error;
  }
  const nextSession = response.headers.get("mcp-session-id");
  return { result: body.result || {}, sessionId: nextSession || sessionId || "" };
}

async function mcpSessionId(auth) {
  const key = `${auth.url}:${auth.token.slice(-12)}`;
  const cached = mcpSessions.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.id;
  const started = await postRpc(
    auth,
    "initialize",
    {
      protocolVersion: auth.protocol,
      capabilities: {},
      clientInfo: { name: "headless-ns", version: "0.1.0" },
    },
    "",
    "",
  );
  const id = started.sessionId;
  if (id) {
    await postRpc(auth, "notifications/initialized", {}, "", id).catch(() => {});
    mcpSessions.set(key, { id, at: Date.now() });
  }
  return id;
}

async function mcp(method, params, name) {
  const auth = activeAuth();
  let sessionId = "";
  if (auth.handshake) sessionId = await mcpSessionId(auth);
  try {
    const payload = await postRpc(auth, method, params, name, sessionId);
    return payload.result;
  } catch (error) {
    if (auth.handshake && sessionId) mcpSessions.delete(`${auth.url}:${auth.token.slice(-12)}`);
    throw error;
  }
}

export function clearMcpCache() {
  toolsCache = null;
  toolsAt = 0;
  identityCache = null;
  identityAt = 0;
  mcpSessions.clear();
}

export async function callTool(name, args) {
  const started = Date.now();
  const source = sourceStore.getStore() || "app";
  try {
    const result = await mcp("tools/call", { name, arguments: args || {} }, name);
    const payload = payloadOf(result);
    if (result.isError) {
      throw new Error(plainSuiteqlError(payload?.error || payload?.text || "The tool failed."));
    }
    const failure = toolFailure(payload);
    if (failure) throw new Error(failure);
    recordTrace({ source, name, ms: Date.now() - started, ok: true, detail: traceDetail(name, args) });
    return payload;
  } catch (error) {
    recordTrace({
      source,
      name,
      ms: Date.now() - started,
      ok: false,
      detail: error.message || "The tool failed.",
    });
    throw error;
  }
}

let toolsCache = null;
let toolsAt = 0;

export async function listTools() {
  if (toolsCache && Date.now() - toolsAt < 60_000) return toolsCache;
  const result = await mcp("tools/list", {});
  toolsCache = (result.tools || []).map((tool) => ({
    name: tool.name,
    description: String(tool.description || ""),
    schema: tool.inputSchema || { type: "object", properties: {} },
  }));
  toolsAt = Date.now();
  return toolsCache;
}

let identityCache = null;
let identityAt = 0;

export async function osmcpIdentity() {
  if (identityCache && Date.now() - identityAt < 60_000) return identityCache;
  const payload = await callTool("ns_getSessionInfo", {});
  identityCache = {
    accountId: payload?.account?.accountId || "",
    roleId: payload?.role?.roleId || "",
    roleCenter: payload?.role?.roleCenter || "",
    environment: payload?.account?.environmentType || "",
    version: payload?.account?.version || "",
    features: Array.isArray(payload?.features) ? payload.features : [],
    permissions: payload?.permissions && typeof payload.permissions === "object" ? payload.permissions : {},
  };
  identityAt = Date.now();
  rememberAccount(identityCache.accountId);
  return identityCache;
}

export async function suiteqlOsmcp(sql, limit = 100, page = 0) {
  const payload = await callTool("ns_runCustomSuiteQL", {
    sqlQuery: sql,
    description: "Headless NetSuite read",
    pageSize: limit,
    pageIndex: page,
  });
  return {
    items: payload?.data ?? [],
    hasMore: Boolean(payload?.hasNextPage),
    total: payload?.totalResults ?? null,
  };
}

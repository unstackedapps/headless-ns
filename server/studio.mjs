import { llmApiKey, llmBaseUrl, llmKeyHint, llmModel, updateLlmEnv } from "./env.mjs";
import { toolKind } from "./kinds.mjs";
import { ask, confirmAsk, pingModel } from "./llm.mjs";
import { modelStore } from "./models.mjs";
import { callTool, listTools, osmcpIdentity, withSource } from "./osmcp.mjs";
import { readPolicy, writePolicy } from "./policy.mjs";
import { listTrace } from "./trace.mjs";

const NEEDS_CONFIRM = new Set(["write", "internal", "app"]);

function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("The request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("The body was not JSON."));
      }
    });
    req.on("error", reject);
  });
}

function publicTool(tool) {
  return {
    name: tool.name,
    description: tool.description.slice(0, 360),
    schema: tool.schema,
    kind: toolKind(tool.name),
  };
}

let reportCache = null;
let reportAt = 0;

async function reportCatalog() {
  if (reportCache && Date.now() - reportAt < 60_000) return reportCache;
  const [reports, subsidiaries] = await Promise.all([
    withSource("reports", () => callTool("ns_listAllReports", {})),
    withSource("reports", () => callTool("ns_getSubsidiaries", {})),
  ]);
  reportCache = {
    reports: (reports?.data || []).map((report) => ({
      id: report.id,
      title: String(report.title || "").replace(/\{#|#\}/g, ""),
      asOf: Boolean(report.as_of_format),
      subsidiary: Boolean(report.has_subsidiary_filter),
    })),
    subsidiaries: (subsidiaries?.data || []).map((row) => ({
      id: Number(row.id),
      name: row.name,
    })),
  };
  reportAt = Date.now();
  return reportCache;
}

function cellValue(value) {
  if (value == null) return "";
  if (typeof value === "object") return "";
  return value;
}

function normalizeReport(payload) {
  const data = payload?.reportData;
  if (!data || typeof data !== "object") return { columns: [], rows: [], summary: null };
  const rows = [];
  let summary = null;
  let columns = [];
  for (const line of Object.values(data)) {
    const detail = Array.isArray(line?.detailLineValues);
    const cells = detail ? line.detailLineValues : line?.summaryLineValues;
    if (!Array.isArray(cells)) continue;
    const row = {};
    for (const cell of cells) {
      const entry = Object.entries(cell || [])[0];
      if (!entry) continue;
      row[entry[0]] = cellValue(entry[1]);
    }
    columns = Object.keys(row);
    if (detail) rows.push(row);
    else summary = row;
  }
  return { columns, rows, summary };
}

function llmPayload() {
  const models = modelStore.view();
  const active = models.connections.find((row) => row.id === models.activeId) || null;
  return {
    models,
    llm: {
      id: active?.id || null,
      configured: Boolean(active?.configured),
      model: active?.model || "",
      provider: active?.provider || "",
      providerLabel: active?.providerLabel || "",
      keyMask: active?.keyMask || "",
      baseUrl: active?.baseUrl || "",
      label: active?.label || "",
    },
  };
}

export function studioRoutes({ sendJson, authorized }) {
  return {
    "GET /api/config": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const identity = await withSource("settings", () => osmcpIdentity());
      sendJson(res, 200, {
        accountId: identity.accountId,
        roleId: identity.roleId,
        roleCenter: identity.roleCenter,
        environment: identity.environment,
        version: identity.version,
        features: identity.features,
        permissions: identity.permissions,
        ...llmPayload(),
        policy: readPolicy(),
      });
    },

    "POST /api/models": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, modelStore.save(body));
    },

    "POST /api/models/active": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, modelStore.activate(body.id));
    },

    "POST /api/models/remove": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, modelStore.remove(String(body.id || "")));
    },

    "POST /api/models/test": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      const reply = await pingModel(body.id);
      sendJson(res, 200, { reply });
    },

    "POST /api/config/llm": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      const baseUrl = String(body.baseUrl || "").trim();
      if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
        sendJson(res, 400, { error: "The model URL must start with http:// or https://." });
        return;
      }
      updateLlmEnv({
        LLM_BASE_URL: baseUrl,
        LLM_MODEL: String(body.model || "").trim(),
        LLM_API_KEY: String(body.apiKey || ""),
      });
      sendJson(res, 200, {
        configured: Boolean(llmApiKey()),
        baseUrl: llmBaseUrl(),
        model: llmModel(),
        keyHint: llmKeyHint(),
      });
    },

    "POST /api/config/llm/test": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const reply = await pingModel();
      sendJson(res, 200, { reply });
    },

    "POST /api/config/policy": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, writePolicy(body));
    },

    "GET /api/tools": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const tools = await listTools();
      sendJson(res, 200, {
        tools: tools.map(publicTool),
        policy: readPolicy(),
      });
    },

    "POST /api/workbench": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      const name = String(body.name || "");
      const args = body.arguments && typeof body.arguments === "object" ? body.arguments : {};
      const kind = toolKind(name);
      if (!name) {
        sendJson(res, 400, { error: "Choose a tool." });
        return;
      }
      if (NEEDS_CONFIRM.has(kind) && !body.confirm) {
        sendJson(res, 400, {
          error: "This tool can change NetSuite or is meant for a chat app. Check confirm to run it.",
        });
        return;
      }
      const started = Date.now();
      const result = await withSource("workbench", () => callTool(name, args));
      sendJson(res, 200, { name, kind, ms: Date.now() - started, result });
    },

    "POST /api/ask": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, await ask({ text: body.text, transcript: body.transcript }));
    },

    "POST /api/ask/confirm": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, await confirmAsk({ transcript: body.transcript, approved: Boolean(body.approved) }));
    },

    "GET /api/trace": async (req, res) => {
      if (!(await authorized(req, res))) return;
      sendJson(res, 200, { entries: listTrace() });
    },

    "GET /api/reports": async (req, res) => {
      if (!(await authorized(req, res))) return;
      sendJson(res, 200, await reportCatalog());
    },

    "POST /api/reports/run": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      const catalog = await reportCatalog();
      const report = catalog.reports.find((item) => Number(item.id) === Number(body.reportId));
      if (!report) {
        sendJson(res, 400, { error: "Choose a report this role can run." });
        return;
      }
      const dateTo = String(body.dateTo || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        sendJson(res, 400, { error: "dateTo is required as YYYY-MM-DD." });
        return;
      }
      const args = { reportId: Number(report.id), dateTo };
      const dateFrom = String(body.dateFrom || "").slice(0, 10);
      if (!report.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
        sendJson(res, 400, { error: "This report needs a start date." });
        return;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) args.dateFrom = dateFrom;
      if (report.subsidiary) {
        const subsidiaryId = Number(body.subsidiaryId);
        if (!Number.isFinite(subsidiaryId)) {
          sendJson(res, 400, { error: "This report needs a subsidiary." });
          return;
        }
        args.subsidiaryId = subsidiaryId;
      }
      const result = await withSource("reports", () => callTool("ns_runReport", args));
      const table = normalizeReport(result);
      const rows = table.rows.slice(0, 200);
      sendJson(res, 200, {
        title: report.title,
        summary: table.summary,
        columns: table.columns,
        rows,
        total: table.rows.length,
        truncated: table.rows.length > rows.length,
      });
    },
  };
}

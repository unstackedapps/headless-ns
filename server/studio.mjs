import { readJsonBody } from "./http.mjs";
import { toolKind } from "./kinds.mjs";
import { ask, confirmAsk, pingModel, skillListing } from "./llm.mjs";
import { modelStore } from "./models.mjs";
import { listModels } from "./providers.mjs";
import { callTool, listTools, osmcpIdentity, suiteqlOsmcp, withSource } from "./osmcp.mjs";
import { withNames } from "./searchnames.mjs";
import { readPolicy, writePolicy } from "./policy.mjs";
import { recordRoutes } from "./records.mjs";
import { flowRoutes } from "./workflows.mjs";
import { listTrace } from "./trace.mjs";
import { LIMITS, skillStore, unzipSkills } from "./skills.mjs";

const NEEDS_CONFIRM = new Set(["write", "internal", "app"]);

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
  const [reports, subsidiaries, books, contexts, nexuses] = await Promise.all([
    withSource("reports", () => callTool("ns_listAllReports", {})),
    withSource("reports", () => callTool("ns_getSubsidiaries", {})),
    withSource("reports", () => callTool("ns_getAccountingBooks", {})),
    withSource("reports", () => callTool("ns_getAccountingContexts", {})),
    withSource("reports", () => callTool("ns_getNexusIds", {})),
  ]);
  reportCache = {
    reports: (reports?.data || []).map((report) => ({
      id: report.id,
      title: String(report.title || "").replace(/\{#|#\}/g, ""),
      asOf: Boolean(report.as_of_format),
      subsidiary: Boolean(report.has_subsidiary_filter),
      book: Boolean(report.supports_book),
      book2: Boolean(report.supports_book2),
      context: Boolean(report.supports_accounting_context),
      nexus: Boolean(report.supports_nexus),
    })),
    subsidiaries: (subsidiaries?.data || []).map((row) => ({
      id: Number(row.id),
      name: row.name,
    })),
    books: namedRows(books),
    contexts: namedRows(contexts),
    nexuses: namedRows(nexuses),
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

function plainText(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function cabinetPath(value) {
  const path = String(value || "/").trim() || "/";
  if (path.length > 500 || /[\u0000-\u001f\\]/.test(path) || path.split("/").some((part) => part === "..")) {
    const error = new Error("That folder path is not valid.");
    error.status = 400;
    throw error;
  }
  return path.startsWith("/") ? path : `/${path}`;
}

export function fileUrlOf(result) {
  const found = [result?.url, result?.fileUrl, result?.href, result?.data?.url].find(
    (value) => typeof value === "string" && /^https:\/\//.test(value),
  );
  return found || "";
}

function namedRows(payload) {
  return (payload?.data || []).map((row) => ({ id: String(row.id), name: String(row.name || row.id) }));
}

function optionalId(value) {
  if (value == null || value === "") return null;
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

export function folderTail(path) {
  return String(path || "").split("/").filter(Boolean).pop() || "File";
}

function fileNameOf(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 199 || /[\\/\u0000-\u001f]/.test(name) || name === "." || name === "..") {
    const error = new Error("That file name is not valid.");
    error.status = 400;
    throw error;
  }
  return name;
}

export function joinCabinetFile(folder, name) {
  const dir = cabinetPath(folder);
  if (dir === "/") {
    const error = new Error("Pick a folder inside the cabinet. The top level cannot hold a file.");
    error.status = 400;
    throw error;
  }
  return `${dir.replace(/\/$/, "")}/${fileNameOf(name)}`;
}

export function classifyPreview(base64, mime = "") {
  const clean = String(base64 || "").replace(/\s/g, "");
  const bytes = Buffer.from(clean, "base64");
  if (!clean || bytes.length === 0) return { kind: "binary", note: "The file came back empty." };
  // shortcut: previews stop at 1.5 MB so a large cabinet file is not sent to the browser
  if (bytes.length > 1_500_000) return { kind: "binary", note: "This file is too large to show here." };
  const type = String(mime || "").toLowerCase();
  if (type.startsWith("image/") && type !== "image/svg+xml") return { kind: "image", image: `data:${type};base64,${clean}` };
  const textType = type.startsWith("text/") || /json|xml|csv|javascript/.test(type) || type === "image/svg+xml";
  if (textType || !bytes.includes(0)) return { kind: "text", text: bytes.toString("utf8") };
  return { kind: "binary", note: "Only text and pictures can be shown here." };
}

function fileBytes(result) {
  if (!result || typeof result !== "object") return { base64: "", mime: "", text: "" };
  const base64 = ["contentBase64", "content", "base64", "data"].find((key) => typeof result[key] === "string" && result[key].length > 0);
  return {
    base64: base64 ? result[base64] : "",
    mime: String(result.mimeType || result.mediaType || result.contentType || ""),
    text: typeof result.text === "string" ? result.text : "",
  };
}

function cabinetEntries(payload) {
  return (payload?.entries || []).map((entry) => ({
    id: String(entry.id ?? ""),
    kind: entry.kind === "folder" ? "folder" : "file",
    name: plainText(entry.name),
    path: String(entry.path || ""),
  }));
}

function listedSearches(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
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

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// The saved skills without their file lists, plus whether Ask sees shortened descriptions.
function skillsPayload(skills = skillStore) {
  const rows = skills.list();
  return {
    skills: rows.map(({ files, ...row }) => ({
      ...row,
      fileCount: files.length,
      size: files.reduce((sum, item) => sum + item.size, 0),
      scripts: files.filter((item) => /\.(py|sh)$/i.test(item.path)).length,
    })),
    shortened: skillListing(rows.filter((row) => row.enabled)).shortened,
  };
}

// A staged preview with a file count per skill, not the file list.
const slimPreview = (preview) => ({ ...preview, skills: preview.skills.map(({ files, ...skill }) => ({ ...skill, fileCount: files.length })) });

const base64Bytes = (value, label) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw badRequest(`${label} must be base64.`);
  return Buffer.from(value, "base64");
};

// Turns a stage request into files for the store. Folder uploads send [{ path, base64 }].
async function stageSkills(body, skills = skillStore) {
  const playbook = body.playbook && typeof body.playbook === "object" ? { name: String(body.playbook.name || ""), description: String(body.playbook.description || "") } : undefined;
  if (body.kind === "git") return skills.stageGit({ url: body.url, ref: body.ref, path: body.path });
  if (body.kind === "zip") {
    const unpacked = unzipSkills(base64Bytes(body.data, "The zip"));
    return skills.stage(unpacked.files, { kind: "zip" }, { skipped: unpacked.skipped, playbook });
  }
  if (body.kind === "markdown") {
    const name = String(body.fileName || "").split("/").pop();
    if (!/\.(md|mdc)$/i.test(name)) throw badRequest("Choose a .md or .mdc file.");
    return skills.stage([{ path: name, bytes: base64Bytes(body.data, "The file") }], { kind: "markdown" }, { playbook });
  }
  if (body.kind === "files") {
    if (!Array.isArray(body.files) || !body.files.length) throw badRequest("Choose a folder.");
    if (body.files.length > LIMITS.files) throw badRequest(`The folder has ${body.files.length} files. The limit is ${LIMITS.files}.`);
    const files = body.files.map((item) => ({ path: String(item?.path || ""), bytes: base64Bytes(item?.base64, String(item?.path || "A file")) }));
    return skills.stage(files, { kind: "folder" }, { playbook });
  }
  throw badRequest("Choose a folder, a zip, a Markdown file or a Git URL.");
}

export function skillRoutes({ sendJson, authorized, skills = skillStore }) {
  return {
    "GET /api/skills": async (req, res) => {
      if (!(await authorized(req, res))) return;
      sendJson(res, 200, skillsPayload(skills));
    },

    "POST /api/skills/stage": async (req, res) => {
      if (!(await authorized(req, res))) return;
      // Base64 adds a third, so 45 MB carries about 33 MB of files.
      const body = await readJsonBody(req, 45_000_000);
      sendJson(res, 200, slimPreview(await stageSkills(body, skills)));
    },

    "POST /api/skills/import": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      const result = skills.importStaged(body.stagedId, body.names, body.replace);
      sendJson(res, 200, { ...result, ...skillsPayload(skills) });
    },

    "POST /api/skills/update": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      const result = await skills.update(body.name);
      sendJson(res, 200, result.preview ? { ...result, preview: slimPreview(result.preview) } : result);
    },

    "POST /api/skills/toggle": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      skills.toggle(body.name, body.enabled === true);
      sendJson(res, 200, skillsPayload(skills));
    },

    "POST /api/skills/remove": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      skills.remove(body.name);
      sendJson(res, 200, skillsPayload(skills));
    },

    "POST /api/skills/file": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, skills.file(body.name, body.path));
    },
  };
}

export function studioRoutes({ sendJson, authorized }) {
  return {
    ...recordRoutes({ sendJson, authorized, readJsonBody }),
    ...flowRoutes({ sendJson, authorized }),
    ...skillRoutes({ sendJson, authorized }),
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
      sendJson(res, 200, modelStore.save(body, { activate: body.activate === true }));
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
      const reply = await pingModel(body.provider ? body : body.id);
      if (!reply) {
        sendJson(res, 400, { error: "The model answered with an empty reply. Pick another model." });
        return;
      }
      sendJson(res, 200, { reply });
    },

    "POST /api/models/list": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, { models: await listModels(modelStore.credentials(body)) });
    },

    "POST /api/config/policy": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, writePolicy(body));
    },

    "GET /api/searches": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const result = await withSource("searches", () => callTool("ns_listSavedSearches", {}));
      const rows = listedSearches(result)
        .map((row) => ({
          id: String(row.id || ""),
          title: plainText(row.title),
          recordType: plainText(row.recordtype),
          shared: Boolean(row.public),
        }))
        .filter((row) => row.id)
        .sort((a, b) => a.title.localeCompare(b.title));
      sendJson(res, 200, { rows });
    },

    "POST /api/searches/run": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      const searchId = String(body.id || "").trim();
      if (!searchId) {
        sendJson(res, 400, { error: "Choose a saved search." });
        return;
      }
      const result = await withSource("searches", () =>
        callTool("ns_runSavedSearch", { searchId, range_start: 0, range_end: 50 }),
      );
      const raw = listedSearches(result).slice(0, 50);
      const columns = raw[0] && typeof raw[0] === "object" ? Object.keys(raw[0]) : [];
      const data = await withNames(columns, raw, (sql) => withSource("searches", () => suiteqlOsmcp(sql, 100)).then((page) => page.items));
      sendJson(res, 200, { columns, rows: data, total: data.length });
    },

    "GET /api/files": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const path = cabinetPath(url.searchParams.get("path"));
      const cursor = url.searchParams.get("cursor");
      const result = await withSource("files", () =>
        callTool("ns_getFolderByPath", { path, pageSize: 100, ...(cursor ? { cursor } : {}) }),
      );
      sendJson(res, 200, {
        path: result?.path || path,
        entries: cabinetEntries(result),
        hasMore: Boolean(result?.hasMore),
        cursor: result?.nextCursor || null,
      });
    },

    "GET /api/files/search": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const search = String(url.searchParams.get("q") || "").trim();
      if (!search || search.length > 200) {
        sendJson(res, 400, { error: "Enter a file name to search." });
        return;
      }
      let cursor = url.searchParams.get("cursor");
      const entries = [];
      let hasMore = false;
      let next = null;
      for (let page = 0; page < 4 && entries.length < 40; page += 1) {
        const result = await withSource("files", () =>
          callTool("ns_searchFiles", { search, pageSize: 50, ...(cursor ? { cursor } : {}) }),
        );
        entries.push(...cabinetEntries(result));
        hasMore = Boolean(result?.hasMore);
        next = result?.nextCursor || null;
        if (!hasMore || !next) break;
        cursor = next;
      }
      sendJson(res, 200, { entries: entries.slice(0, 40), hasMore, cursor: next });
    },

    "POST /api/files/upload": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req, 12_000_000);
      const path = joinCabinetFile(body.folder, body.name);
      const contentBase64 = String(body.contentBase64 || "").replace(/\s/g, "");
      if (!contentBase64 || Buffer.from(contentBase64, "base64").length > 8_000_000) {
        sendJson(res, 400, { error: "That file is empty or too large to upload." });
        return;
      }
      await withSource("files", () => callTool("ns_uploadFile", { path, contentBase64, override: false }));
      sendJson(res, 200, { path });
    },

    "POST /api/files/lookup": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      const kind = body.kind === "file" || body.kind === "folder" ? body.kind : "";
      if (!kind) {
        sendJson(res, 400, { error: "Choose a file or a folder." });
        return;
      }
      if (body.path) {
        const path = cabinetPath(body.path);
        const result = await withSource("files", () => callTool("ns_getIdFromPath", { path, kind }));
        sendJson(res, 200, { id: result?.id ?? null, path: result?.path || path, kind });
        return;
      }
      const id = Number(body.id);
      if (!Number.isInteger(id) || id === 0) {
        sendJson(res, 400, { error: "Enter an internal id." });
        return;
      }
      const result = await withSource("files", () => callTool("ns_getPathFromId", { id, kind }));
      sendJson(res, 200, { id: result?.id ?? id, path: result?.path || "", kind: result?.kind || kind });
    },

    "POST /api/files/open": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      const path = cabinetPath(body.path);
      const result = await withSource("files", () => callTool("ns_getFileUrl", { path }));
      const url = fileUrlOf(result);
      // shortcut: only an https link is opened
      if (!url) {
        sendJson(res, 502, { error: "NetSuite did not return a link for that file." });
        return;
      }
      sendJson(res, 200, { url });
    },

    "POST /api/files/read": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      const path = cabinetPath(body.path);
      const result = await withSource("files", () => callTool("ns_getFile", { path }));
      const found = fileBytes(result);
      if (found.text && !found.base64) {
        sendJson(res, 200, { name: folderTail(path), path, kind: "text", text: found.text });
        return;
      }
      if (!found.base64) {
        sendJson(res, 502, { error: "NetSuite did not return the file contents." });
        return;
      }
      sendJson(res, 200, { name: folderTail(path), path, ...classifyPreview(found.base64, found.mime) });
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
        const why = {
          write: "This tool changes NetSuite.",
          app: "This tool draws a screen for chat apps, so it returns little here.",
          internal: "This tool works on the file cabinet.",
        }[kind];
        sendJson(res, 400, { error: `${why} Tick Confirm, then run it.` });
        return;
      }
      const started = Date.now();
      const result = await withSource("workbench", () => callTool(name, args));
      sendJson(res, 200, { name, kind, ms: Date.now() - started, result });
    },

    "POST /api/ask": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      // A closed tab or a cancel in the command line stops the model loop at its next turn.
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const result = await ask({ text: body.text, transcript: body.transcript, signal: controller.signal });
      if (!controller.signal.aborted) sendJson(res, 200, result);
    },

    "POST /api/ask/confirm": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, await confirmAsk({ id: body.id, approved: Boolean(body.approved) }));
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
        sendJson(res, 400, { error: "Enter the end date as YYYY-MM-DD." });
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
      if (report.book) {
        const book = optionalId(body.book);
        if (book != null) args.book = book;
      }
      if (report.book2) {
        const book2 = optionalId(body.book2);
        if (book2 != null) args.book2 = book2;
      }
      if (report.context) {
        const accountingContext = optionalId(body.accountingContext);
        if (accountingContext != null) args.accountingContext = accountingContext;
      }
      if (report.nexus) {
        const nexusId = optionalId(body.nexusId);
        if (nexusId != null) args.nexusId = nexusId;
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

import { callTool, withSource } from "./osmcp.mjs";

const SENSITIVE = /ssn|socialsecurity|birth|gender|ethnic|marital|visa|nationality|salary|compensation/i;
const SCALAR = new Set(["string", "number", "integer", "boolean"]);

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

export function isSensitive(name) {
  return SENSITIVE.test(String(name || ""));
}

export function scalarFields(properties) {
  const fields = [];
  for (const [id, spec] of Object.entries(properties || {})) {
    if (id === "id" || id === "password" || isSensitive(id)) continue;
    const type = spec?.type;
    if (!SCALAR.has(type)) continue;
    fields.push({ id, title: String(spec.title || id).replace(/\s+/g, " ").trim(), type: type === "integer" ? "number" : type });
  }
  fields.sort((a, b) => a.title.localeCompare(b.title));
  return fields;
}

export function recordScalars(data) {
  const rows = [];
  for (const [id, value] of Object.entries(data || {})) {
    if (isSensitive(id)) continue;
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      rows.push({ id, value: value == null ? "" : value });
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

export function cleanWrite(data) {
  const next = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return next;
  for (const [id, value] of Object.entries(data)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(id) || id === "id" || id === "password" || isSensitive(id)) continue;
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) next[id] = value;
    else if (typeof value === "string" && value.trim()) next[id] = value.trim();
  }
  // shortcut: a save sends at most 60 fields
  return Object.fromEntries(Object.entries(next).slice(0, 60));
}

export function typeNames(payload) {
  const items = payload?.metadata?.items || [];
  return items
    .map((item) => String(item?.name || ""))
    .filter((name) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))
    .sort((a, b) => a.localeCompare(b));
}

export function tableNames(payload) {
  const items = payload?.metadata?.items || [];
  return items
    .map((item) => ({ name: String(item?.name || ""), title: String(item?.title || item?.name || "") }))
    .filter((item) => item.name)
    .sort((a, b) => a.title.localeCompare(b.title));
}

function recordTypeOf(value) {
  const type = String(value || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(type)) fail("That record type is not valid.");
  return type;
}

function recordIdOf(value) {
  const id = String(value || "").trim();
  if (!/^[1-9]\d{0,11}$/.test(id)) fail("Enter the internal id of the record.");
  return id;
}

function confirmed(body) {
  if (body?.confirm === true) return;
  fail("Confirm the change before it runs.");
}

export function recordRoutes({ sendJson, authorized, readJsonBody }) {
  return {
    "GET /api/records/types": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const result = await withSource("records", () => callTool("ns_getRecordTypeMetadata", {}));
      sendJson(res, 200, { types: typeNames(result) });
    },

    "GET /api/records/fields": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const recordType = recordTypeOf(url.searchParams.get("type"));
      const result = await withSource("records", () => callTool("ns_getRecordTypeMetadata", { recordType }));
      // shortcut: object and list fields are left out of the form
      sendJson(res, 200, { type: recordType, fields: scalarFields(result?.metadata?.properties) });
    },

    "GET /api/records": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const recordType = recordTypeOf(url.searchParams.get("type"));
      const recordId = recordIdOf(url.searchParams.get("id"));
      const result = await withSource("records", () => callTool("ns_getRecord", { recordType, recordId }));
      sendJson(res, 200, { type: recordType, id: recordId, fields: recordScalars(result?.data) });
    },

    "POST /api/records": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      confirmed(body);
      const recordType = recordTypeOf(body.recordType);
      const data = cleanWrite(body.data);
      if (!Object.keys(data).length) fail("Nothing to save.");
      const recordId = body.recordId ? recordIdOf(body.recordId) : "";
      const result = await withSource("records", () =>
        callTool(recordId ? "ns_updateRecord" : "ns_createRecord", {
          recordType,
          ...(recordId ? { recordId } : {}),
          data: JSON.stringify(data),
        }),
      );
      sendJson(res, 200, { id: String(result?.data?.id || result?.id || recordId || ""), type: recordType });
    },

    "GET /api/records/actions": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const recordType = recordTypeOf(url.searchParams.get("type"));
      const recordId = url.searchParams.get("id");
      const args = { recordType, ...(recordId ? { recordId: recordIdOf(recordId) } : {}) };
      const result = await withSource("records", () => callTool("ns_getRecordActionMetadata", args));
      const actions = (result?.actions || [])
        .map((action) => ({ id: String(action.id || ""), label: String(action.label || action.id || "") }))
        .filter((action) => action.id);
      sendJson(res, 200, { actions });
    },

    "POST /api/records/action": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      confirmed(body);
      const recordType = recordTypeOf(body.recordType);
      const recordId = recordIdOf(body.recordId);
      const actionId = String(body.actionId || "").trim();
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(actionId)) fail("That action is not valid.");
      // shortcut: actions that need extra parameters are run without them
      await withSource("records", () => callTool("ns_executeRecordAction", { recordType, recordId, actionId }));
      sendJson(res, 200, { ok: true });
    },

    "GET /api/records/transforms": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const recordType = recordTypeOf(url.searchParams.get("type"));
      const result = await withSource("records", () =>
        callTool("ns_getRecordTransformMetadata", { sourceRecordTypeFilter: recordType }),
      );
      const targets = (result?.transformations?.items || [])
        .map((item) => String(item.target || ""))
        .filter((target) => target);
      sendJson(res, 200, { targets });
    },

    "POST /api/records/transform": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      confirmed(body);
      const sourceRecordType = recordTypeOf(body.sourceRecordType);
      const sourceRecordId = recordIdOf(body.sourceRecordId);
      const targetRecordType = recordTypeOf(body.targetRecordType);
      const result = await withSource("records", () =>
        callTool("ns_transformRecord", { sourceRecordType, sourceRecordId, targetRecordType }),
      );
      sendJson(res, 200, { id: String(result?.data?.id || result?.id || ""), type: targetRecordType });
    },

    "POST /api/records/file": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      confirmed(body);
      const recordType = recordTypeOf(body.recordType);
      const recordId = recordIdOf(body.recordId);
      const path = String(body.path || "").trim();
      if (!path || path.length > 500 || path === "/" || /[\u0000-\u001f\\]/.test(path) || path.split("/").includes("..")) {
        fail("Enter a file path inside the cabinet.");
      }
      await withSource("records", () =>
        callTool(body.detach ? "ns_detachFile" : "ns_attachFile", { path, recordType, recordId }),
      );
      sendJson(res, 200, { ok: true });
    },

    "GET /api/suiteql": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const recordType = String(url.searchParams.get("type") || "").trim();
      if (!recordType) {
        const result = await withSource("query", () => callTool("ns_getSuiteQLMetadata", {}));
        sendJson(res, 200, { tables: tableNames(result) });
        return;
      }
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(recordType)) fail("That table is not valid.");
      const result = await withSource("query", () => callTool("ns_getSuiteQLMetadata", { recordType }));
      sendJson(res, 200, { type: recordType, fields: scalarFields(result?.metadata?.properties) });
    },
  };
}

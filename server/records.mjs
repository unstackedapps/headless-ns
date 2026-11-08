import { randomUUID } from "node:crypto";
import { callTool, suiteqlOsmcp, withSource } from "./osmcp.mjs";
import { searchAnd } from "./netsuite.mjs";

const SENSITIVE = /ssn|socialsecurity|birth|gender|ethnic|marital|visa|nationality|salary|compensation/i;
const SCALAR = new Set(["string", "number", "integer", "boolean"]);
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// Internal ids are digits (negative for a few system records). Select fields use short codes like "B" or "Open".
const REF_ID = /^-?\d{1,12}$|^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const EXTERNAL_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const MAX_FIELDS = 60;
const MAX_LINES = 200;

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

export function isSensitive(name) {
  return SENSITIVE.test(String(name || ""));
}

function titleOf(id, spec) {
  if (spec?.title) return String(spec.title).replace(/\s+/g, " ").trim();
  return String(id).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function isRefSpec(spec) {
  return spec?.type === "object" && spec.properties?.id && !spec.properties?.items;
}

function sublistSpec(spec) {
  const line = spec?.type === "object" ? spec.properties?.items?.items : null;
  return line?.properties ? line.properties : null;
}

// Record types whose `entity` field points at a vendor or an employee rather than a customer.
const VENDOR_TYPES = new Set(["vendorbill", "purchaseorder", "vendorpayment", "vendorcredit", "itemreceipt", "vendorreturnauthorization"]);

export function refSource(recordType, fieldId) {
  const id = String(fieldId).toLowerCase();
  if (id === "entity") return VENDOR_TYPES.has(recordType) ? "vendor" : recordType === "expensereport" ? "employee" : "customer";
  const known = {
    customer: "customer",
    vendor: "vendor",
    employee: "employee",
    salesrep: "employee",
    item: "item",
    location: "location",
    subsidiary: "subsidiary",
    department: "department",
    class: "classification",
    currency: "currency",
    terms: "term",
    account: "account",
  };
  return known[id] || "";
}

function describe(recordType, id, spec) {
  if (id === "id" || id === "password" || isSensitive(id)) return null;
  if (SCALAR.has(spec?.type)) {
    return { id, title: titleOf(id, spec), type: spec.type === "integer" ? "number" : spec.type };
  }
  if (isRefSpec(spec)) {
    const options = Array.isArray(spec.properties.id.enum) ? spec.properties.id.enum.map(String) : null;
    if (options) return { id, title: titleOf(id, spec), type: "select", options };
    return { id, title: titleOf(id, spec), type: "ref", source: refSource(recordType, id) };
  }
  return null;
}

function byTitle(a, b) {
  return a.title.localeCompare(b.title);
}

// Kept for the SuiteQL table browser, which shows plain columns only.
export function scalarFields(properties) {
  return Object.entries(properties || {})
    .filter(([id, spec]) => SCALAR.has(spec?.type) && id !== "id" && id !== "password" && !isSensitive(id))
    .map(([id, spec]) => ({ id, title: titleOf(id, spec), type: spec.type === "integer" ? "number" : spec.type }))
    .sort(byTitle);
}

// Body fields (plain, reference and select) plus each sublist's line fields.
export function formShape(recordType, properties) {
  const fields = [];
  const sublists = [];
  for (const [id, spec] of Object.entries(properties || {})) {
    const line = sublistSpec(spec);
    if (line) {
      const lineFields = Object.entries(line)
        .map(([lineId, lineSpec]) => describe(recordType, lineId, lineSpec))
        .filter(Boolean);
      if (lineFields.length) sublists.push({ id, title: titleOf(id, spec), fields: lineFields });
      continue;
    }
    const field = describe(recordType, id, spec);
    if (field) fields.push(field);
  }
  fields.sort(byTitle);
  sublists.sort(byTitle);
  return { fields, sublists };
}

function readValue(value) {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { value: value == null ? "" : value };
  }
  if (typeof value === "object" && !Array.isArray(value) && "id" in value && !("items" in value)) {
    return { value: String(value.id ?? ""), refName: String(value.refName ?? "") };
  }
  return null;
}

function readFlat(data) {
  const rows = [];
  for (const [id, value] of Object.entries(data || {})) {
    if (isSensitive(id) || id === "links") continue;
    const read = readValue(value);
    if (read) rows.push({ id, ...read });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

// Turns ns_getRecord data into body fields and sublist lines. References keep refName for display.
export function readRecord(data) {
  const sublists = [];
  for (const [id, value] of Object.entries(data || {})) {
    if (value && typeof value === "object" && Array.isArray(value.items)) {
      sublists.push({ id, lines: value.items.slice(0, MAX_LINES).map((line) => Object.fromEntries(readFlat(line).map((row) => [row.id, row]))) });
    }
  }
  return { fields: readFlat(data), sublists };
}

function writeValue(value) {
  if (value === null) return { ok: true, value: null };
  if (typeof value === "boolean") return { ok: true, value };
  if (typeof value === "number" && Number.isFinite(value)) return { ok: true, value };
  if (typeof value === "string") {
    const text = value.trim();
    return text ? { ok: true, value: text.slice(0, 4000) } : { ok: false };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = String(value.id ?? "").trim();
    if (REF_ID.test(id)) return { ok: true, value: { id } };
  }
  return { ok: false };
}

function cleanFields(data, limit) {
  const next = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return next;
  for (const [id, value] of Object.entries(data)) {
    if (Object.keys(next).length >= limit) break;
    if (!NAME.test(id) || id === "id" || id === "password" || id === "externalId" || isSensitive(id)) continue;
    const written = writeValue(value);
    if (written.ok) next[id] = written.value;
  }
  return next;
}

// Body fields for create, update and transform. null clears a field, {id} sets a reference,
// an empty string is left out.
export function cleanWrite(data) {
  return cleanFields(data, MAX_FIELDS);
}

// Sublist lines as {item: {items: [...]}}. A line with `line` edits that line; a line without it is added.
export function cleanLines(sublists) {
  const out = {};
  if (!sublists || typeof sublists !== "object" || Array.isArray(sublists)) return out;
  for (const [id, lines] of Object.entries(sublists)) {
    if (!NAME.test(id) || isSensitive(id) || !Array.isArray(lines)) continue;
    const items = lines
      .slice(0, MAX_LINES)
      .map((line) => {
        const clean = cleanFields(line, 40);
        for (const key of ["line", "orderLine"]) {
          if (key in clean && !(Number.isInteger(clean[key]) && clean[key] >= 0)) delete clean[key];
        }
        return clean;
      })
      .filter((line) => Object.keys(line).length);
    if (items.length) out[id] = { items };
  }
  return out;
}

export function newExternalId(recordType) {
  return `hns-${recordType}-${randomUUID()}`;
}

function externalIdOf(value, recordType) {
  const given = String(value ?? "").trim();
  if (!given) return newExternalId(recordType);
  if (!EXTERNAL_ID.test(given)) fail("The external id can use letters, numbers, _ . : and -, up to 80 characters.");
  return given;
}

// Lines for a fulfillment or receipt made from an order. Lines left out of `lines` are not shipped.
export function fulfillData({ lines, shipStatus, clearShipMethod } = {}, targetType = "itemfulfillment") {
  const items = (Array.isArray(lines) ? lines : []).slice(0, MAX_LINES).flatMap((line) => {
    const orderLine = Number(line?.orderLine);
    if (!Number.isInteger(orderLine) || orderLine < 0) return [];
    const receive = line.receive === true;
    const quantity = Number(line.quantity);
    if (receive && !(Number.isFinite(quantity) && quantity > 0)) fail(`Enter a quantity above 0 for line ${orderLine}.`);
    return [receive ? { orderLine, itemReceive: true, quantity } : { orderLine, itemReceive: false }];
  });
  const data = {};
  if (items.length) {
    if (!items.some((line) => line.itemReceive)) fail("Pick at least one line.");
    data.item = { items };
  }
  if (targetType === "itemfulfillment") {
    // NetSuite tries to print a carrier label otherwise, which fails without a UPS or FedEx account.
    data.generateIntegratedShipperLabel = false;
    if (["A", "B", "C"].includes(shipStatus)) data.shipStatus = { id: shipStatus };
    if (clearShipMethod === true) data.shipMethod = null;
  }
  return data;
}

// The id of the record a create or transform made. The MCP tools answer {success, recordId}.
export function newRecordId(payload) {
  const id = String(payload?.recordId ?? payload?.data?.id ?? payload?.id ?? "");
  return /^\d{1,12}$/.test(id) ? id : "";
}

export function isTimeout(message) {
  return /maximum allowed response time|timed? ?out|ETIMEDOUT|socket hang up|aborted/i.test(String(message || ""));
}

const TRANSACTION_TYPES = new Set([
  "estimate", "salesorder", "itemfulfillment", "invoice", "cashsale", "customerpayment", "creditmemo",
  "returnauthorization", "customerrefund", "customerdeposit", "purchaseorder", "itemreceipt", "vendorbill",
  "vendorpayment", "vendorcredit", "journalentry", "transferorder", "inventoryadjustment", "fulfillmentrequest",
  "opportunity", "expensereport", "check", "deposit",
]);
const ITEM_TYPES = /item$/;

export function externalIdSql(recordType, externalId) {
  if (!EXTERNAL_ID.test(externalId)) fail("That external id is not valid.");
  const table = TRANSACTION_TYPES.has(recordType) ? "transaction" : ITEM_TYPES.test(recordType) ? "item" : recordTypeOf(recordType);
  return `SELECT id FROM ${table} WHERE externalid = '${externalId}'`;
}

// After a timeout NetSuite may still have saved the record. Look for it by external id, never retry.
async function findByExternalId(recordType, externalId) {
  try {
    const result = await withSource("records", () => suiteqlOsmcp(externalIdSql(recordType, externalId), 2));
    const id = String(result.items[0]?.id ?? "");
    return /^\d+$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

async function createOnce(tool, args, recordType, externalId) {
  try {
    const payload = await withSource("records", () => callTool(tool, args));
    const id = newRecordId(payload);
    if (!id) fail("NetSuite did not return the new record id.");
    return { id, type: recordType, externalId };
  } catch (error) {
    if (!isTimeout(error.message)) throw error;
    // NetSuite can finish the write a few seconds after the timeout.
    for (const wait of [5000, 15000]) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      const id = await findByExternalId(recordType, externalId);
      if (id) return { id, type: recordType, externalId, note: "NetSuite timed out, but it saved the record." };
    }
    const late = new Error(
      `NetSuite did not answer in time. The record may still appear. Search for external id ${externalId} before you try again.`,
    );
    late.status = 400;
    throw late;
  }
}

// SuiteQL lookups for reference pickers. Only these tables and columns can be searched.
const LOOKUPS = {
  customer: { table: "customer", label: "entityid || ' ' || NVL(companyname, '')", search: ["entityid", "companyname"], where: "isinactive = 'F'" },
  vendor: { table: "vendor", label: "entityid || ' ' || NVL(companyname, '')", search: ["entityid", "companyname"], where: "isinactive = 'F'" },
  employee: { table: "employee", label: "entityid", search: ["entityid", "firstname", "lastname"], where: "isinactive = 'F'" },
  item: { table: "item", label: "itemid || ' ' || NVL(displayname, '')", search: ["itemid", "displayname"], where: "isinactive = 'F'" },
  location: { table: "location", label: "name", search: ["name"], where: "isinactive = 'F'" },
  subsidiary: { table: "subsidiary", label: "name", search: ["name"], where: "isinactive = 'F'" },
  department: { table: "department", label: "name", search: ["name"], where: "isinactive = 'F'" },
  classification: { table: "classification", label: "name", search: ["name"], where: "isinactive = 'F'" },
  currency: { table: "currency", label: "name", search: ["name", "symbol"], where: "isinactive = 'F'" },
  term: { table: "term", label: "name", search: ["name"], where: "isinactive = 'F'" },
  account: { table: "account", label: "NVL(acctnumber || ' ', '') || fullname", search: ["acctnumber", "fullname"], where: "isinactive = 'F'" },
};

export function lookupSql(source, raw) {
  const spec = LOOKUPS[source];
  if (!spec) fail("That field cannot be searched.");
  const text = String(raw || "").trim();
  const byId = /^\d{1,12}$/.test(text) ? ` OR id = ${text}` : "";
  const match = searchAnd(spec.search, text);
  const where = byId && match ? `${spec.where} AND (${match.slice(5)}${byId})` : `${spec.where}${match}`;
  return `SELECT id, ${spec.label} AS label FROM ${spec.table} WHERE ${where} ORDER BY label FETCH FIRST 20 ROWS ONLY`;
}

export function typeNames(payload) {
  const items = payload?.metadata?.items || [];
  return items
    .map((item) => String(item?.name || ""))
    .filter((name) => NAME.test(name))
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
  if (!NAME.test(type)) fail("That record type is not valid.");
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

function actionParametersOf(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "object" || Array.isArray(value)) fail("Action parameters must be an object.");
  const clean = cleanFields(value, 20);
  return Object.keys(clean).length ? JSON.stringify(clean) : "";
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
      sendJson(res, 200, { type: recordType, ...formShape(recordType, result?.metadata?.properties) });
    },

    "GET /api/records": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const recordType = recordTypeOf(url.searchParams.get("type"));
      const recordId = recordIdOf(url.searchParams.get("id"));
      const result = await withSource("records", () => callTool("ns_getRecord", { recordType, recordId }));
      sendJson(res, 200, { type: recordType, id: recordId, ...readRecord(result?.data) });
    },

    "GET /api/records/lookup": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const sql = lookupSql(String(url.searchParams.get("source") || ""), url.searchParams.get("q"));
      const result = await withSource("records", () => suiteqlOsmcp(sql, 20));
      sendJson(res, 200, {
        options: result.items.map((row) => ({ id: String(row.id ?? ""), label: String(row.label ?? "").trim() })),
      });
    },

    "POST /api/records": async (req, res) => {
      if (!(await authorized(req, res))) return;
      const body = await readJsonBody(req);
      confirmed(body);
      const recordType = recordTypeOf(body.recordType);
      const data = { ...cleanWrite(body.data), ...cleanLines(body.sublists) };
      if (!Object.keys(data).length) fail("Nothing to save.");
      if (body.recordId) {
        const recordId = recordIdOf(body.recordId);
        await withSource("records", () => callTool("ns_updateRecord", { recordType, recordId, data: JSON.stringify(data) }));
        sendJson(res, 200, { id: recordId, type: recordType });
        return;
      }
      const externalId = externalIdOf(body.externalId, recordType);
      const created = await createOnce("ns_createRecord", { recordType, data: JSON.stringify({ ...data, externalId }) }, recordType, externalId);
      sendJson(res, 200, created);
    },

    "GET /api/records/actions": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const recordType = recordTypeOf(url.searchParams.get("type"));
      const recordId = url.searchParams.get("id");
      const args = { recordType, ...(recordId ? { recordId: recordIdOf(recordId) } : {}) };
      const result = await withSource("records", () => callTool("ns_getRecordActionMetadata", args));
      const actions = (result?.actions || [])
        .map((action) => ({
          id: String(action.id || ""),
          label: String(action.label || action.id || ""),
          parameters: Object.keys(action.parameters || {}).filter((name) => NAME.test(name)),
        }))
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
      if (!NAME.test(actionId)) fail("That action is not valid.");
      const actionParameters = actionParametersOf(body.actionParameters);
      await withSource("records", () =>
        callTool("ns_executeRecordAction", { recordType, recordId, actionId, ...(actionParameters ? { actionParameters } : {}) }),
      );
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
      const externalId = externalIdOf(body.externalId, targetRecordType);
      const shipping = targetRecordType === "itemfulfillment" || targetRecordType === "itemreceipt";
      const data = {
        ...cleanWrite(body.data),
        ...(shipping ? fulfillData(body.fulfill, targetRecordType) : {}),
        externalId,
      };
      const created = await createOnce(
        "ns_transformRecord",
        { sourceRecordType, sourceRecordId, targetRecordType, data: JSON.stringify(data) },
        targetRecordType,
        externalId,
      );
      sendJson(res, 200, created);
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
      if (!NAME.test(recordType)) fail("That table is not valid.");
      const result = await withSource("query", () => callTool("ns_getSuiteQLMetadata", { recordType }));
      sendJson(res, 200, { type: recordType, fields: scalarFields(result?.metadata?.properties) });
    },
  };
}

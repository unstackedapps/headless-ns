import { randomUUID } from "node:crypto";
import { cachedMeta, clearMeta } from "./metadata.mjs";
import { callTool, suiteqlOsmcp, withSource } from "./osmcp.mjs";
import { searchAnd } from "./netsuite.mjs";
import { ITEM_TYPES, itemRecordType } from "./lists.mjs";

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

function plain(error) {
  const next = new Error(plainError(error?.message));
  next.status = 400;
  return next;
}

// Runs a write tool and turns a NetSuite failure into a plain reason.
async function write(tool, args) {
  try {
    return await withSource("records", () => callTool(tool, args));
  } catch (error) {
    throw plain(error);
  }
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
// NetSuite names a line's item "<item code> <display name>", which repeats when the two are the same.
export function oneItemName(name) {
  const text = String(name ?? "");
  return /^(.+) \1$/.exec(text)?.[1] ?? text;
}

export function readRecord(data) {
  const sublists = [];
  for (const [id, value] of Object.entries(data || {})) {
    if (value && typeof value === "object" && Array.isArray(value.items)) {
      sublists.push({
        id,
        lines: value.items.slice(0, MAX_LINES).map((line) =>
          Object.fromEntries(readFlat(line).map((row) => [row.id, row.id === "item" && row.refName ? { ...row, refName: oneItemName(row.refName) } : row])),
        ),
      });
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

const LOT_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 _.\/-]{0,39}$/;

// Serial or lot numbers on one line, as [{id, quantity}] or [{number, quantity}]. A fulfillment ships numbers
// in stock (`id` from inventorynumber); a receipt names new ones (`number`). The quantities must add up to the line.
export function inventoryNumbers(raw, orderLine, quantity, targetType = "itemfulfillment") {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length > MAX_LINES) fail(`The serial or lot numbers for line ${orderLine} are not valid.`);
  if (!raw.length) return null;
  const receiving = targetType === "itemreceipt";
  const items = raw.map((entry) => {
    const count = Number(entry?.quantity);
    const valid = Number.isFinite(count) && count > 0;
    if (receiving) {
      const number = String(entry?.number ?? "").trim();
      if (!LOT_NUMBER.test(number) || !valid) fail(`The serial or lot numbers for line ${orderLine} are not valid. Use letters, numbers, spaces and . _ / -, up to 40 characters.`);
      return { receiptInventoryNumber: number, quantity: count };
    }
    const id = String(entry?.id ?? "");
    if (!/^[1-9]\d{0,11}$/.test(id) || !valid) fail(`The serial or lot numbers for line ${orderLine} are not valid.`);
    return { issueInventoryNumber: { id }, quantity: count };
  });
  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  const verb = receiving ? "receives" : "ships";
  if (Math.abs(total - quantity) > 1e-9) fail(`Line ${orderLine} ${verb} ${quantity}, but the numbers add up to ${total}.`);
  return items;
}

// Lines for a fulfillment or receipt made from an order. Lines left out of `lines` are not shipped.
export function fulfillData({ lines, shipStatus, clearShipMethod } = {}, targetType = "itemfulfillment") {
  const items = (Array.isArray(lines) ? lines : []).slice(0, MAX_LINES).flatMap((line) => {
    const orderLine = Number(line?.orderLine);
    if (!Number.isInteger(orderLine) || orderLine < 0) return [];
    const receive = line.receive === true;
    const quantity = Number(line.quantity);
    if (receive && !(Number.isFinite(quantity) && quantity > 0)) fail(`Enter a quantity above 0 for line ${orderLine}.`);
    if (!receive) return [{ orderLine, itemReceive: false }];
    const numbers = inventoryNumbers(line.numbers, orderLine, quantity, targetType);
    return [{ orderLine, itemReceive: true, quantity, ...(numbers ? { inventoryDetail: { inventoryAssignment: { items: numbers } } } : {}) }];
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

// Bill lines made from a purchase order: [{orderLine, quantity}]. Transforms keep every order line,
// so a line not to bill goes with quantity 0 and stays on the bill at 0.
export function billData({ lines } = {}) {
  const items = (Array.isArray(lines) ? lines : []).slice(0, MAX_LINES).flatMap((line) => {
    const orderLine = Number(line?.orderLine);
    if (!Number.isInteger(orderLine) || orderLine < 0) return [];
    const quantity = Number(line.quantity);
    if (!(Number.isFinite(quantity) && quantity >= 0)) fail(`Enter a quantity of 0 or more for line ${orderLine}.`);
    return [{ orderLine, quantity }];
  });
  if (!items.length) return {};
  if (!items.some((line) => line.quantity > 0)) fail("Bill at least one line.");
  return { item: { items } };
}

// Bills a payment pays, as [{doc, amount}]. The bill it was made from is unticked unless it is in the list.
export function applyData(lines, sourceId) {
  if (lines == null) return {};
  if (!Array.isArray(lines) || lines.length > MAX_LINES) fail("The bills to pay are not valid.");
  const seen = new Set();
  const items = lines.map((line) => {
    const doc = String(line?.doc ?? "");
    const amount = Number(line?.amount);
    if (!/^[1-9]\d{0,11}$/.test(doc) || seen.has(doc)) fail("The bills to pay are not valid.");
    if (!(Number.isFinite(amount) && amount > 0)) fail("Enter an amount above 0 for each bill you pay.");
    seen.add(doc);
    return { doc: { id: doc }, apply: true, amount: Math.round(amount * 100) / 100 };
  });
  if (!items.length) fail("Pick at least one bill to pay.");
  if (sourceId && !seen.has(String(sourceId))) items.push({ doc: { id: String(sourceId) }, apply: false });
  return { apply: { items } };
}

// The id of the record a create or transform made. The MCP tools answer {success, recordId}.
export function newRecordId(payload) {
  const id = String(payload?.recordId ?? payload?.data?.id ?? payload?.id ?? "");
  return /^\d{1,12}$/.test(id) ? id : "";
}

// NetSuite's own wording for common failures, turned into what to do next.
export function plainError(message) {
  const text = String(message || "");
  const detail = /configure the inventory detail in line (\d+)/i.exec(text);
  if (detail) return `Line ${detail[1]} is a serial or lot item. Pick or enter its serial or lot numbers, then try again.`;
  const field = /Invalid Field Value (\S+) for the following field: (\w+)/i.exec(text);
  if (field && /location/i.test(field[2])) return "That location is not in this customer's or vendor's subsidiary. Pick a location from the same subsidiary.";
  if (field) return `NetSuite does not accept ${field[1]} for ${field[2]}. Pick another value.`;
  if (/enter a value for Amount/i.test(text)) return "Every line needs a rate. This item has no base price in NetSuite, so enter one.";
  if (/at least one valid line item/i.test(text)) return "None of the chosen lines can be used. Check that each line has an open quantity and stock at its location.";
  return text;
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
const ITEM_RECORD = /item$/;

export function externalIdSql(recordType, externalId) {
  if (!EXTERNAL_ID.test(externalId)) fail("That external id is not valid.");
  const table = TRANSACTION_TYPES.has(recordType) ? "transaction" : ITEM_RECORD.test(recordType) ? "item" : recordTypeOf(recordType);
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
    if (!isTimeout(error.message)) throw plain(error);
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
  item: { table: "item", label: "CASE WHEN displayname IS NULL OR displayname = itemid THEN itemid ELSE itemid || ' ' || displayname END", search: ["itemid", "displayname"], where: "isinactive = 'F'" },
  location: { table: "location", label: "name", search: ["name"], where: "isinactive = 'F'" },
  subsidiary: { table: "subsidiary", label: "name", search: ["name"], where: "isinactive = 'F'" },
  department: { table: "department", label: "name", search: ["name"], where: "isinactive = 'F'" },
  classification: { table: "classification", label: "name", search: ["name"], where: "isinactive = 'F'" },
  currency: { table: "currency", label: "name", search: ["name", "symbol"], where: "isinactive = 'F'" },
  term: { table: "term", label: "name", search: ["name"], where: "isinactive = 'F'" },
  account: { table: "account", label: "NVL(acctnumber || ' ', '') || fullname", search: ["acctnumber", "fullname"], where: "isinactive = 'F'" },
};

// `scope` limits locations to the subsidiary of the chosen customer or vendor: {party: "customer", id: "341"}.
export function lookupSql(source, raw, scope = null) {
  if (!Object.hasOwn(LOOKUPS, String(source))) fail("That field cannot be searched.");
  const spec = LOOKUPS[source];
  const text = String(raw || "").trim();
  const byId = /^\d{1,12}$/.test(text) ? ` OR id = ${text}` : "";
  const match = searchAnd(spec.search, text);
  let base = spec.where;
  if (scope && source === "location") {
    if (!["customer", "vendor"].includes(scope.party) || !/^[1-9]\d{0,11}$/.test(String(scope.id))) fail("That customer or vendor is not valid.");
    // location.subsidiary is a text list; the map table holds one row per location and subsidiary.
    base += ` AND id IN (SELECT location FROM locationsubsidiarymap WHERE subsidiary = (SELECT subsidiary FROM ${scope.party} WHERE id = ${scope.id}))`;
  }
  const where = byId && match ? `${base} AND (${match.slice(5)}${byId})` : `${base}${match}`;
  return `SELECT id, ${spec.label} AS label FROM ${spec.table} WHERE ${where} ORDER BY label FETCH FIRST 20 ROWS ONLY`;
}

// One search across transactions, customers, vendors, employees and items, by number, name or email.
export function findSql(raw) {
  const text = String(raw || "").trim();
  if (text.length < 2) fail("Type at least two letters or digits.");
  const match = (columns) => searchAnd(columns, text).slice(5);
  const parts = [
    `SELECT id, tranid AS label, recordtype AS type, BUILTIN.DF(entity) AS detail, NULL AS sub FROM transaction WHERE ${match(["tranid", "transactionnumber"])}`,
    `SELECT id, entityid || ' ' || NVL(companyname, '') AS label, 'customer' AS type, email AS detail, NULL AS sub FROM customer WHERE ${match(["entityid", "companyname", "email"])}`,
    `SELECT id, entityid || ' ' || NVL(companyname, '') AS label, 'vendor' AS type, email AS detail, NULL AS sub FROM vendor WHERE ${match(["entityid", "companyname", "email"])}`,
    `SELECT id, entityid AS label, 'employee' AS type, email AS detail, NULL AS sub FROM employee WHERE ${match(["entityid", "email"])}`,
    `SELECT id, itemid AS label, itemtype AS type, displayname AS detail, subtype AS sub FROM item WHERE ${match(["itemid", "displayname"])}`,
  ];
  return `SELECT * FROM (${parts.join(" UNION ALL ")}) FETCH FIRST 30 ROWS ONLY`;
}

export function foundRows(items) {
  return items
    .map((row) => {
      const raw = String(row.type ?? "");
      const type = Object.hasOwn(ITEM_TYPES, raw) ? itemRecordType(raw, row.sub) : raw;
      return { id: String(row.id ?? ""), type, label: String(row.label ?? "").trim(), detail: String(row.detail ?? "").trim() };
    })
    .filter((row) => row.id && NAME.test(row.type));
}

// The 50 newest records of one type, so the person can pick one instead of typing an id.
export function latestSql(recordType) {
  const type = recordTypeOf(recordType);
  if (Object.hasOwn(LOOKUPS, type)) {
    const spec = LOOKUPS[type];
    return `SELECT id, ${spec.label} AS label, NULL AS detail FROM ${spec.table} WHERE ${spec.where} ORDER BY id DESC FETCH FIRST 50 ROWS ONLY`;
  }
  const itemType = Object.entries(ITEM_TYPES).find(([, spec]) => type.startsWith(spec.recordType))?.[0];
  if (itemType) {
    return `SELECT id, itemid AS label, displayname AS detail FROM item WHERE itemtype = '${itemType}' ORDER BY id DESC FETCH FIRST 50 ROWS ONLY`;
  }
  return `SELECT id, NVL(tranid, transactionnumber) AS label, BUILTIN.DF(entity) AS detail FROM transaction WHERE recordtype = '${type}' ORDER BY id DESC FETCH FIRST 50 ROWS ONLY`;
}

export function itemDefaultsSql(id) {
  const item = String(id ?? "");
  if (!/^[1-9]\d{0,11}$/.test(item)) fail("Pick an item.");
  return `SELECT i.description, i.purchasedescription, i.cost, i.lastpurchaseprice,
       (SELECT MAX(p.price) FROM itemprice p WHERE p.item = i.id AND p.pricelevel = 1) AS baseprice
FROM item i WHERE i.id = ${item}`;
}

// Sales lines take the base price and sales description; purchase lines the purchase price and description.
export function itemDefaults(row, side) {
  const number = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
  if (side === "purchase") {
    const rate = number(row?.cost) ?? (number(row?.lastpurchaseprice) || null);
    return { rate, description: String(row?.purchasedescription || row?.description || ""), rateLabel: "Purchase price" };
  }
  return { rate: number(row?.baseprice), description: String(row?.description || ""), rateLabel: "Base price" };
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
  if (!/^[1-9]\d{0,11}$/.test(id)) fail("Enter the record's internal ID.");
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

// ?fresh=1 comes from the Refresh button and skips the metadata cache.
function isFresh(url) {
  return url?.searchParams?.get("fresh") === "1";
}

export function recordTypes(fresh = false) {
  if (fresh) ["fields:", "transforms:"].forEach((prefix) => clearMeta(prefix));
  return cachedMeta("types", async () => typeNames(await withSource("records", () => callTool("ns_getRecordTypeMetadata", {}))), { fresh });
}

export function suiteqlTables(fresh = false) {
  if (fresh) clearMeta("columns:");
  return cachedMeta("tables", async () => tableNames(await withSource("query", () => callTool("ns_getSuiteQLMetadata", {}))), { fresh });
}

// Loads the two long lists in the background after sign-in, one call at a time, so the first
// visit to Records or Query is fast and the pages that load at sign-in keep the other call slots.
export async function prefetchMeta() {
  await recordTypes().catch(() => null);
  await suiteqlTables().catch(() => null);
}

export function recordRoutes({ sendJson, authorized, readJsonBody }) {
  return {
    "GET /api/records/types": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      sendJson(res, 200, { types: await recordTypes(isFresh(url)) });
    },

    "GET /api/records/fields": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const recordType = recordTypeOf(url.searchParams.get("type"));
      const shape = await cachedMeta(`fields:${recordType}`, async () => {
        const result = await withSource("records", () => callTool("ns_getRecordTypeMetadata", { recordType }));
        return formShape(recordType, result?.metadata?.properties);
      }, { fresh: isFresh(url) });
      sendJson(res, 200, { type: recordType, ...shape });
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
      const party = url.searchParams.get("party");
      const scope = party ? { party, id: url.searchParams.get("partyId") } : null;
      const sql = lookupSql(String(url.searchParams.get("source") || ""), url.searchParams.get("q"), scope);
      const result = await withSource("records", () => suiteqlOsmcp(sql, 20));
      sendJson(res, 200, {
        options: result.items.map((row) => ({ id: String(row.id ?? ""), label: String(row.label ?? "").trim() })),
      });
    },

    "GET /api/records/find": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const result = await withSource("records", () => suiteqlOsmcp(findSql(url.searchParams.get("q")), 30));
      sendJson(res, 200, { rows: foundRows(result.items) });
    },

    "GET /api/records/latest": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const sql = latestSql(url.searchParams.get("type"));
      // A type with no SuiteQL table of its own answers with an empty list; the id box still works.
      const result = await withSource("records", () => suiteqlOsmcp(sql, 50)).catch(() => ({ items: [] }));
      sendJson(res, 200, {
        rows: result.items.map((row) => ({ id: String(row.id ?? ""), label: String(row.label ?? "").trim(), detail: String(row.detail ?? "").trim() })),
      });
    },

    "GET /api/records/item-defaults": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const result = await withSource("records", () => suiteqlOsmcp(itemDefaultsSql(url.searchParams.get("id")), 1));
      sendJson(res, 200, itemDefaults(result.items[0], url.searchParams.get("side")));
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
        await write("ns_updateRecord", { recordType, recordId, data: JSON.stringify(data) });
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
      await write("ns_executeRecordAction", { recordType, recordId, actionId, ...(actionParameters ? { actionParameters } : {}) });
      sendJson(res, 200, { ok: true });
    },

    "GET /api/records/transforms": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const recordType = recordTypeOf(url.searchParams.get("type"));
      const targets = await cachedMeta(`transforms:${recordType}`, async () => {
        const result = await withSource("records", () =>
          callTool("ns_getRecordTransformMetadata", { sourceRecordTypeFilter: recordType }),
        );
        return (result?.transformations?.items || []).map((item) => String(item.target || "")).filter((target) => target);
      }, { fresh: isFresh(url) });
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
        ...(sourceRecordType === "purchaseorder" && targetRecordType === "vendorbill" ? billData(body.bill) : {}),
        ...(targetRecordType === "vendorpayment" ? applyData(body.apply, sourceRecordId) : {}),
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
        sendJson(res, 200, { tables: await suiteqlTables(isFresh(url)) });
        return;
      }
      if (!NAME.test(recordType)) fail("That table is not valid.");
      const fields = await cachedMeta(`columns:${recordType}`, async () => {
        const result = await withSource("query", () => callTool("ns_getSuiteQLMetadata", { recordType }));
        return scalarFields(result?.metadata?.properties);
      }, { fresh: isFresh(url) });
      sendJson(res, 200, { type: recordType, fields });
    },
  };
}

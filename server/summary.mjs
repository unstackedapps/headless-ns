// Plain summaries of the writes Ask proposes, shown before the person clicks Run.

const LABELS = {
  estimate: "quote",
  salesorder: "sales order",
  invoice: "invoice",
  itemfulfillment: "fulfillment",
  customerpayment: "customer payment",
  returnauthorization: "return",
  purchaseorder: "purchase order",
  itemreceipt: "item receipt",
  vendorbill: "bill",
  vendorpayment: "bill payment",
  cashsale: "cash sale",
  creditmemo: "credit memo",
  customer: "customer",
  vendor: "vendor",
};
const SHIP_STATUS = { A: "Picked", B: "Packed", C: "Shipped" };
const ID = /^\d{1,12}$/;

function label(type) {
  return LABELS[String(type || "").toLowerCase()] || String(type || "record");
}

function dataOf(args) {
  const raw = args?.data;
  if (raw && typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function refId(value) {
  const id = String(value?.id ?? value ?? "");
  return ID.test(id) ? id : "";
}

function linesOf(data) {
  return Array.isArray(data?.item?.items) ? data.item.items : [];
}

// The ids a summary needs names for, so the server can look them up in one pass.
export function summaryRefs(name, args) {
  const data = dataOf(args);
  const refs = { entity: new Set(), location: new Set(), item: new Set(), transaction: new Set() };
  const add = (kind, value) => {
    const id = refId(value);
    if (id) refs[kind].add(id);
  };
  add("entity", data.entity);
  add("location", data.location);
  for (const line of linesOf(data)) add("item", line.item);
  if (name === "ns_transformRecord") add("transaction", args?.sourceRecordId);
  if (name === "ns_updateRecord" || name === "ns_executeRecordAction") add("transaction", args?.recordId);
  return Object.fromEntries(Object.entries(refs).map(([kind, ids]) => [kind, [...ids]]));
}

// SuiteQL for each kind of id. Ids are digits only (refId), so they are safe to inline.
export function namesSql(kind, ids) {
  const list = ids.filter((id) => ID.test(id)).join(",");
  if (!list) return "";
  if (kind === "entity") return `SELECT id, entitytitle AS name FROM entity WHERE id IN (${list})`;
  if (kind === "location") return `SELECT id, name FROM location WHERE id IN (${list})`;
  if (kind === "item") return `SELECT id, itemid AS name FROM item WHERE id IN (${list})`;
  if (kind === "transaction") return `SELECT id, NVL(tranid, transactionnumber) AS name FROM transaction WHERE id IN (${list})`;
  return "";
}

function money(value) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// names: {entity: {id: name}, location: {...}, item: {...}, transaction: {...}}. Missing names fall back to the id.
export function describeWrite(name, args = {}, names = {}) {
  const data = dataOf(args);
  const nameOf = (kind, value) => {
    const id = refId(value);
    return id ? names[kind]?.[id] || `#${id}` : "";
  };
  const lines = linesOf(data);
  const details = [];
  const parts = [];

  if (name === "ns_createRecord") {
    const entity = nameOf("entity", data.entity);
    const head = `Create ${label(args.recordType)}${entity ? ` for ${entity}` : ""}`;
    if (lines.length) parts.push(plural(lines.length, "line"));
    const location = nameOf("location", data.location);
    if (location) parts.push(location);
    const priced = lines.filter((line) => Number.isFinite(Number(line.quantity)) && Number.isFinite(Number(line.rate)));
    if (lines.length && priced.length === lines.length) {
      parts.push(`total ${money(priced.reduce((sum, line) => sum + Number(line.quantity) * Number(line.rate), 0))}`);
    } else if (lines.length) {
      parts.push("total set by NetSuite prices");
    }
    for (const line of lines) {
      const rate = Number.isFinite(Number(line.rate)) ? ` at ${money(Number(line.rate))}` : "";
      details.push(`${line.quantity ?? "?"} × ${nameOf("item", line.item) || "item"}${rate}`);
    }
    if (data.memo) details.push(`Memo: ${data.memo}`);
    if (data.externalId) details.push(`External id: ${data.externalId}`);
    return { title: parts.length ? `${head}: ${parts.join(", ")}` : head, details };
  }

  if (name === "ns_transformRecord") {
    const source = `${label(args.sourceRecordType)} ${nameOf("transaction", args.sourceRecordId)}`.trim();
    const head = `Turn ${source} into a ${label(args.targetRecordType)}`;
    const shipped = lines.filter((line) => line.itemReceive !== false);
    if (lines.length) {
      const units = shipped.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
      parts.push(`${plural(shipped.length, "line")}, ${plural(units, "unit")}`);
    }
    const status = SHIP_STATUS[String(data.shipStatus?.id ?? data.shipStatus ?? "")];
    if (status) parts.push(`status ${status}`);
    for (const line of lines) {
      details.push(
        line.itemReceive === false ? `Order line ${line.orderLine}: skip` : `Order line ${line.orderLine}: ${line.quantity ?? "all"}`,
      );
    }
    if (data.generateIntegratedShipperLabel === false) details.push("No carrier label");
    if (Object.hasOwn(data, "shipMethod") && data.shipMethod === null) details.push("Clears the ship method");
    if (data.memo) details.push(`Memo: ${data.memo}`);
    if (data.externalId) details.push(`External id: ${data.externalId}`);
    return { title: parts.length ? `${head}: ${parts.join(", ")}` : head, details };
  }

  if (name === "ns_updateRecord") {
    const target = `${label(args.recordType)} ${nameOf("transaction", args.recordId)}`.trim();
    const fields = Object.keys(data);
    return { title: `Update ${target}${fields.length ? `: ${fields.join(", ")}` : ""}`, details: [] };
  }

  if (name === "ns_executeRecordAction") {
    const target = `${label(args.recordType)} ${nameOf("transaction", args.recordId)}`.trim();
    return { title: `Run ${args.actionId || args.action || "an action"} on ${target}`, details: [] };
  }

  return { title: `Run ${name}`, details: [] };
}

// Looks up the names a set of pending calls mention. `query(sql)` returns rows of {id, name}.
export async function describeWrites(calls, query) {
  const wanted = { entity: new Set(), location: new Set(), item: new Set(), transaction: new Set() };
  for (const call of calls) {
    for (const [kind, ids] of Object.entries(summaryRefs(call.name, call.arguments))) for (const id of ids) wanted[kind].add(id);
  }
  const names = {};
  await Promise.all(
    Object.entries(wanted).map(async ([kind, ids]) => {
      const sql = namesSql(kind, [...ids]);
      if (!sql) return;
      try {
        const rows = await query(sql);
        names[kind] = Object.fromEntries(rows.map((row) => [String(row.id), String(row.name ?? "")]).filter(([, value]) => value));
      } catch {
        names[kind] = {};
      }
    }),
  );
  return calls.map((call) => ({ ...call, summary: describeWrite(call.name, call.arguments, names) }));
}

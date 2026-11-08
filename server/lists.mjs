import { likeTerm, searchAnd } from "./netsuite.mjs";

export const PAGE_SIZE = 100;

// Transaction lists. `statuses` are SuiteQL status letters; filter with the bare letter, not 'SalesOrd:B'.
// `open` is the default filter. Types without statuses (receipts, bill payments) have no filter.
export const TX_LISTS = {
  orders: {
    type: "SalesOrd",
    recordType: "salesorder",
    party: "customer",
    statuses: { A: "Pending approval", B: "Pending fulfillment", D: "Partially fulfilled", E: "Pending billing, partially fulfilled", F: "Pending billing", G: "Billed", H: "Closed", C: "Cancelled" },
    open: ["A", "B", "D", "E", "F"],
  },
  quotes: {
    type: "Estimate",
    recordType: "estimate",
    party: "customer",
    statuses: { A: "Open", B: "Processed", C: "Closed", X: "Expired", V: "Voided" },
    open: ["A"],
  },
  invoices: {
    type: "CustInvc",
    recordType: "invoice",
    party: "customer",
    statuses: { A: "Open", B: "Paid in full" },
    open: ["A"],
  },
  fulfillments: {
    type: "ItemShip",
    recordType: "itemfulfillment",
    party: "customer",
    statuses: { A: "Picked", B: "Packed", C: "Shipped" },
    open: ["A", "B"],
  },
  payments: {
    type: "CustPymt",
    recordType: "customerpayment",
    party: "customer",
    statuses: { A: "Unapproved", B: "Not deposited", C: "Deposited" },
    open: ["A", "B"],
  },
  returns: {
    type: "RtnAuth",
    recordType: "returnauthorization",
    party: "customer",
    statuses: { A: "Pending approval", B: "Pending receipt", D: "Partially received", E: "Pending refund, partially received", F: "Pending refund", G: "Refunded", H: "Closed", C: "Cancelled" },
    open: ["A", "B", "D", "E", "F"],
  },
  purchaseorders: {
    type: "PurchOrd",
    recordType: "purchaseorder",
    party: "vendor",
    statuses: { A: "Pending approval", B: "Pending receipt", D: "Partially received", E: "Pending billing, partially received", F: "Pending bill", G: "Fully billed", H: "Closed", C: "Rejected", P: "Planned" },
    open: ["A", "B", "D", "E", "F"],
  },
  receipts: { type: "ItemRcpt", recordType: "itemreceipt", party: "vendor" },
  bills: {
    type: "VendBill",
    recordType: "vendorbill",
    party: "vendor",
    statuses: { A: "Open", D: "Pending approval", B: "Paid in full", E: "Rejected", C: "Cancelled" },
    open: ["A", "D"],
  },
  billpayments: { type: "VendPymt", recordType: "vendorpayment", party: "vendor" },
};

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

export function pageOf(raw) {
  const page = Number(raw ?? 0);
  return Number.isInteger(page) && page >= 0 && page <= 500 ? page : 0;
}

// "open" (default), "all", or one status letter from the list's own set.
export function statusWhere(spec, raw) {
  if (!spec.statuses) return "";
  const status = String(raw || "open");
  if (status === "all") return "";
  const letters = status === "open" ? spec.open : Object.hasOwn(spec.statuses, status) ? [status] : null;
  if (!letters) fail("That status is not on this list.");
  return ` AND t.status IN (${letters.map((letter) => `'${letter}'`).join(", ")})`;
}

// Matches the number, or the customer or vendor by name.
export function partyMatch(party, raw) {
  const term = likeTerm(raw);
  if (!term) return "";
  const table = party === "vendor" ? "vendor" : "customer";
  return ` AND (LOWER(t.tranid) LIKE '%${term}%' OR t.entity IN (SELECT id FROM ${table} WHERE LOWER(entityid) LIKE '%${term}%' OR LOWER(companyname) LIKE '%${term}%'))`;
}

export function txListSql(name, { status, q, entity } = {}) {
  if (!Object.hasOwn(TX_LISTS, String(name))) fail("That list does not exist.");
  const spec = TX_LISTS[name];
  const who = entity == null ? "" : /^[1-9]\d{0,11}$/.test(String(entity)) ? ` AND t.entity = ${entity}` : fail("That id is not valid.");
  return `SELECT t.id, t.tranid, t.trandate, t.duedate, BUILTIN.DF(t.entity) AS entity, t.status AS statusid, BUILTIN.DF(t.status) AS status,
       BUILTIN.DF(t.currency) AS currency, ABS(t.foreigntotal) AS amount, t.foreignamountunpaid AS unpaid
FROM transaction t
WHERE t.type = '${spec.type}' AND NVL(t.voided, 'F') = 'F'${statusWhere(spec, status)}${who}${partyMatch(spec.party, q)}
ORDER BY t.trandate DESC, t.id DESC`;
}

export function vendorListSql(q) {
  return `SELECT v.id, v.entityid, v.companyname, v.email, v.phone, BUILTIN.DF(v.subsidiary) AS subsidiary
FROM vendor v
WHERE v.isinactive = 'F'${searchAnd(["v.entityid", "v.companyname", "v.email"], q)}
ORDER BY v.entityid`;
}

// SuiteQL item types and the record type the Records screen opens them as.
export const ITEM_TYPES = {
  InvtPart: { label: "Inventory", recordType: "inventoryitem" },
  NonInvtPart: { label: "Non-inventory", recordType: "noninventory" },
  Service: { label: "Service", recordType: "service" },
  OthCharge: { label: "Other charge", recordType: "othercharge" },
  Assembly: { label: "Assembly", recordType: "assemblyitem" },
  Kit: { label: "Kit", recordType: "kititem" },
  Group: { label: "Item group", recordType: "itemgroup" },
  Discount: { label: "Discount", recordType: "discountitem" },
  Markup: { label: "Markup", recordType: "markupitem" },
  Payment: { label: "Payment", recordType: "paymentitem" },
  Subtotal: { label: "Subtotal", recordType: "subtotalitem" },
  Description: { label: "Description", recordType: "descriptionitem" },
  GiftCert: { label: "Gift certificate", recordType: "giftcertificateitem" },
};

// Non-inventory, service and other charge records split by subtype: noninventorysaleitem and so on.
export function itemRecordType(itemType, subtype) {
  const base = ITEM_TYPES[itemType]?.recordType || "";
  if (!["noninventory", "service", "othercharge"].includes(base)) return base;
  const sub = { Sale: "sale", Resale: "resale", Purchase: "purchase" }[subtype] || "sale";
  return `${base}${sub}item`;
}

export function itemListSql({ type, q } = {}) {
  const kind = String(type || "all");
  if (kind !== "all" && !Object.hasOwn(ITEM_TYPES, kind)) fail("That item type is not valid.");
  const where = kind === "all" ? "" : ` AND itemtype = '${kind}'`;
  return `SELECT id, itemid, displayname, itemtype, subtype
FROM item
WHERE isinactive = 'F'${where}${searchAnd(["itemid", "displayname"], q)}
ORDER BY itemid`;
}

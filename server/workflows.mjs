import { callTool, suiteqlOsmcp, withSource } from "./osmcp.mjs";
import { readRecord } from "./records.mjs";

// Record types the transaction page knows, and their SuiteQL transaction type codes.
export const FLOW_TYPES = {
  estimate: "Estimate",
  salesorder: "SalesOrd",
  invoice: "CustInvc",
  itemfulfillment: "ItemShip",
  customerpayment: "CustPymt",
  returnauthorization: "RtnAuth",
  purchaseorder: "PurchOrd",
  itemreceipt: "ItemRcpt",
  vendorbill: "VendBill",
  vendorpayment: "VendPymt",
};

const RECORD_TYPE = {
  ...Object.fromEntries(Object.entries(FLOW_TYPES).map(([type, code]) => [code, type])),
  CashSale: "cashsale",
  CustCred: "creditmemo",
  VendCred: "vendorcredit",
  VendAuth: "vendorreturnauthorization",
};

export function recordTypeOfCode(code) {
  const key = String(code || "");
  return Object.hasOwn(RECORD_TYPE, key) ? RECORD_TYPE[key] : "";
}

const ORDER_OPEN = ["A", "B", "D", "E", "F"];

// The next steps that fit a transaction's status. Status ids are NetSuite's one-letter codes
// (sales order B = Pending Fulfillment, purchase order B = Pending Receipt, and so on).
// `lines` are {closed, remaining}; `approvalStatus` is the approvalstatus id ("1" pending, "2" approved).
export function nextSteps(recordType, status, lines = [], { approvalStatus = "" } = {}) {
  const s = String(status || "");
  const open = lines.filter((line) => !line.closed);
  const toShip = open.some((line) => Number(line.remaining) > 0);
  // Received or fulfilled units not billed yet.
  const toBill = open.some((line) => Number(line.done) > Number(line.billed));
  const steps = [];
  const close = { id: "close", label: "Close lines", kind: "close" };
  switch (recordType) {
    case "estimate":
      if (s === "A") steps.push({ id: "convert", label: "Convert to sales order", kind: "transform", target: "salesorder" });
      break;
    case "salesorder":
      // td3138390 answers "The approve api is not available to your company" to the approve action.
      // Setting orderStatus to B (Pending Fulfillment) approves the order.
      if (s === "A") steps.push({ id: "approve", label: "Approve", kind: "update", data: { orderStatus: { id: "B" } } });
      if (["B", "D", "E"].includes(s) && toShip) steps.push({ id: "fulfill", label: "Fulfill", kind: "ship", target: "itemfulfillment" });
      if (["E", "F"].includes(s)) steps.push({ id: "bill", label: "Bill", kind: "transform", target: "invoice" });
      if (ORDER_OPEN.includes(s) && open.length) steps.push(close);
      break;
    case "invoice":
      if (s === "A") steps.push({ id: "pay", label: "Receive payment", kind: "pay", target: "customerpayment" });
      break;
    case "itemfulfillment":
      if (s === "A") steps.push({ id: "pack", label: "Mark packed", kind: "update", data: { shipStatus: { id: "B" } } });
      if (s === "A" || s === "B") steps.push({ id: "ship", label: "Mark shipped", kind: "update", data: { shipStatus: { id: "C" } } });
      break;
    case "purchaseorder":
      if (s === "A" || String(approvalStatus) === "1") {
        steps.push({ id: "approve", label: "Approve", kind: "update", data: { approvalStatus: { id: "2" } } });
        break;
      }
      if (["B", "D", "E"].includes(s) && toShip) steps.push({ id: "receive", label: "Receive", kind: "ship", target: "itemreceipt" });
      if (["E", "F"].includes(s) || (s === "D" && toBill)) steps.push({ id: "bill", label: "Bill", kind: "transform", target: "vendorbill" });
      if (ORDER_OPEN.includes(s) && open.length) steps.push(close);
      break;
    case "vendorbill":
      if (s === "D" || String(approvalStatus) === "1") {
        steps.push({ id: "approve", label: "Approve", kind: "update", data: { approvalStatus: { id: "2" } } });
        break;
      }
      if (s === "A") steps.push({ id: "pay", label: "Pay bill", kind: "pay", target: "vendorpayment" });
      break;
    default:
      break;
  }
  return steps;
}

function checkedId(id) {
  const text = String(id ?? "");
  if (!/^[1-9]\d{0,11}$/.test(text)) {
    const error = new Error("Enter the internal id of the record.");
    error.status = 400;
    throw error;
  }
  return text;
}

// Shipped or received and billed quantities per line. They are not on the record itself.
export function lineQuantitySql(id) {
  return `SELECT id, quantityshiprecv, quantitypicked, quantitybilled, location, BUILTIN.DF(location) AS locationname FROM transactionline WHERE transaction = ${checkedId(id)} AND mainline = 'F'`;
}

function idList(ids) {
  const list = [...new Set((ids || []).map(String))].filter((id) => /^[1-9]\d{0,11}$/.test(id)).slice(0, 200);
  if (!list.length) {
    const error = new Error("No items to look up.");
    error.status = 400;
    throw error;
  }
  return list.join(", ");
}

// Serial and lot flags, and available stock by location, for the items on an order.
export function itemFactsSql(ids) {
  return `SELECT id, isserialitem, islotitem FROM item WHERE id IN (${idList(ids)})`;
}

export function stockSql(ids) {
  return `SELECT ib.item, ib.location, BUILTIN.DF(ib.location) AS name, SUM(ib.quantityavailable) AS available
FROM inventorybalance ib WHERE ib.item IN (${idList(ids)})
GROUP BY ib.item, ib.location, BUILTIN.DF(ib.location)`;
}

// Serial or lot numbers of one item that can ship from one location.
export function numbersSql(item, location) {
  return `SELECT n.id, n.inventorynumber, inl.quantityavailable AS available
FROM inventorynumber n JOIN inventorynumberlocation inl ON inl.inventorynumber = n.id
WHERE n.item = ${checkedId(item)} AND inl.location = ${checkedId(location)} AND inl.quantityavailable > 0
ORDER BY n.inventorynumber`;
}

// Open inventory lines of a sales order, with the line's location or else the order's (on the mainline row).
export function shipLinesSql(id) {
  return `SELECT tl.id AS line, tl.item, BUILTIN.DF(tl.item) AS itemname, tl.location, BUILTIN.DF(tl.location) AS locationname,
       h.location AS headlocation, BUILTIN.DF(h.location) AS headlocationname,
       ABS(tl.quantity) AS quantity, ABS(NVL(tl.quantityshiprecv, 0)) AS done, ABS(NVL(tl.quantitypicked, 0)) AS picked
FROM transactionline tl JOIN transactionline h ON h.transaction = tl.transaction AND h.mainline = 'T'
WHERE tl.transaction = ${checkedId(id)} AND tl.mainline = 'F' AND tl.itemtype IN ('InvtPart', 'Assembly') AND tl.isclosed = 'F'`;
}

// Why a fulfillment of these lines would fail for lack of stock or location, one sentence per line, or [].
// `ship` maps order line to the quantity a payload ships; without it every open line ships what is open.
export function stockProblems(lineRows, stockRows, ship = null) {
  const problems = [];
  for (const row of lineRows || []) {
    const line = Number(row.line);
    const open = Math.max(Number(row.quantity) - Math.max(Number(row.done) || 0, Number(row.picked) || 0), 0);
    const quantity = ship ? (ship.get(line) ?? 0) : open;
    if (!(quantity > 0)) continue;
    const location = row.location ?? row.headlocation;
    const locationName = row.location != null ? row.locationname : row.headlocationname;
    const stock = (stockRows || []).filter((item) => String(item.item) === String(row.item) && Number(item.available) > 0);
    const here = location == null ? 0 : Number(stock.find((item) => String(item.location) === String(location))?.available ?? 0);
    if (location != null && here >= quantity) continue;
    const elsewhere = stock
      .filter((item) => String(item.location) !== String(location) && Number(item.available) >= quantity)
      .map((item) => `${item.name} (location id ${item.location}) has ${Number(item.available)}`);
    const where = location == null ? "The order has no location, so NetSuite cannot ship it." : `Only ${here} available at ${locationName}.`;
    const fix = elsewhere.length
      ? ` ${elsewhere.join("; ")}. Set that location on the sales order with ns_updateRecord {"location":{"id":"<id>"}}, then fulfill.`
      : " No location has enough.";
    problems.push(`Line ${line} (${row.itemname}) ships ${quantity}. ${where}${fix}`);
  }
  return problems;
}

// Serial and lot lines a fulfillment ships without numbers, with the numbers in stock to pick from.
// `numbers` maps order line to [{id, inventorynumber, available}] at that line's location.
export function numberProblems(lineRows, factRows, items, numbers = new Map()) {
  const tracked = new Map((factRows || []).filter((row) => row.isserialitem === "T" || row.islotitem === "T").map((row) => [String(row.id), row.isserialitem === "T" ? "serial" : "lot"]));
  const sent = new Map((items || []).map((line) => [Number(line.orderLine), line]));
  const problems = [];
  for (const row of lineRows || []) {
    const kind = tracked.get(String(row.item));
    const line = Number(row.line);
    const payload = sent.get(line);
    if (!kind || (items && (!payload || payload.itemReceive === false))) continue;
    if (payload?.inventoryDetail?.inventoryAssignment?.items?.length) continue;
    const inStock = (numbers.get(line) || []).slice(0, 10).map((entry) => `${entry.inventorynumber} (id ${entry.id}, ${Number(entry.available)} available)`);
    problems.push(
      `Line ${line} (${row.itemname}) is a ${kind} item and needs ${kind} numbers on its fulfillment line: {"orderLine":${line},"itemReceive":true,"quantity":<n>,"inventoryDetail":{"inventoryAssignment":{"items":[{"issueInventoryNumber":{"id":"<id>"},"quantity":1}]}}}. ${
        inStock.length ? `In stock there: ${inStock.join(", ")}.` : "None are in stock there."
      }`,
    );
  }
  return problems;
}

// Checks stock before Ask proposes a sales order fulfillment. Returns a reason to tell the person, or "".
export async function fulfillmentCheck(name, args, query) {
  if (name !== "ns_transformRecord" || args?.sourceRecordType !== "salesorder" || args?.targetRecordType !== "itemfulfillment") return "";
  let data = args.data ?? {};
  if (typeof data === "string") {
    try {
      data = JSON.parse(data || "{}");
    } catch {
      data = {};
    }
  }
  const items = Array.isArray(data?.item?.items) ? data.item.items : null;
  const ship = items ? new Map(items.filter((line) => line.itemReceive !== false).map((line) => [Number(line.orderLine), Number(line.quantity) || 0])) : null;
  const lines = await query(shipLinesSql(args.sourceRecordId));
  const ids = lines.map((row) => String(row.item));
  const stock = ids.length ? await query(stockSql(ids)) : [];
  const problems = stockProblems(lines, stock, ship);
  if (!problems.length && ids.length) {
    const facts = await query(itemFactsSql(ids));
    const numbers = new Map();
    for (const row of lines) {
      const location = row.location ?? row.headlocation;
      const fact = facts.find((item) => String(item.id) === String(row.item));
      if (location != null && (fact?.isserialitem === "T" || fact?.islotitem === "T")) numbers.set(Number(row.line), await query(numbersSql(row.item, location)));
    }
    problems.push(...numberProblems(lines, facts, items, numbers));
  }
  return problems.length ? `Not fulfilled, nothing was written. ${problems.join(" ")} Tell the person before you change anything.` : "";
}

// Adds where each line ships from, how much is available there and elsewhere, and serial or lot tracking.
export function addStock(lines, factRows, stockRows, { stock: withStock = true } = {}) {
  const facts = new Map((factRows || []).map((row) => [String(row.id), row]));
  return lines.map((line) => {
    const id = line.item?.id || "";
    const fact = facts.get(id);
    const stock = (stockRows || [])
      .filter((row) => String(row.item) === id && Number(row.available) > 0)
      .map((row) => ({ id: String(row.location), name: String(row.name || row.location), available: Number(row.available) }))
      .sort((a, b) => b.available - a.available);
    const tracking = fact?.isserialitem === "T" ? "serial" : fact?.islotitem === "T" ? "lot" : "";
    if (!withStock) return { ...line, tracking };
    return {
      ...line,
      tracking,
      stock,
      available: line.location ? (stock.find((row) => row.id === line.location.id)?.available ?? 0) : null,
    };
  });
}

// Status letter, open amount and approval status. The record's own status id is not always the letter. this one was made from or turned into.
export function headerSql(id) {
  return `SELECT NVL(tranid, transactionnumber) AS docnumber, status, BUILTIN.DF(status) AS statusname, foreignamountunpaid AS unpaid, approvalstatus FROM transaction WHERE id = ${checkedId(id)}`;
}

// Records this one was made from or turned into.
export function linkedSql(id) {
  const tx = checkedId(id);
  return `SELECT DISTINCT t.id, t.type, NVL(t.tranid, t.transactionnumber) AS tranid, t.trandate, BUILTIN.DF(t.status) AS status,
       CASE WHEN l.previousdoc = ${tx} THEN 'next' ELSE 'previous' END AS direction
FROM NextTransactionLineLink l
JOIN transaction t ON t.id = CASE WHEN l.previousdoc = ${tx} THEN l.nextdoc ELSE l.previousdoc END
WHERE l.previousdoc = ${tx} OR l.nextdoc = ${tx}`;
}

function num(value) {
  const n = Number(value);
  return value == null || value === "" || !Number.isFinite(n) ? null : n;
}

function cellValue(cell) {
  return cell ? cell.value : "";
}

function refOf(cell) {
  return cell && cell.value !== "" ? { id: String(cell.value), name: String(cell.refName || cell.value) } : null;
}

// Lines from ns_getRecord merged with SuiteQL quantities by line id.
export function mergeLines(itemLines, quantityRows) {
  const byLine = new Map((quantityRows || []).map((row) => [String(row.id), row]));
  return (itemLines || [])
    .map((cells) => {
      const line = cells.line ? Number(cells.line.value) : NaN;
      if (!Number.isInteger(line)) return null;
      const quantity = Math.abs(num(cellValue(cells.quantity)) ?? 0);
      const row = byLine.get(String(line));
      const done = Math.abs(num(row?.quantityshiprecv) ?? 0);
      // Units on a fulfillment that is picked or packed but not shipped yet. They are no longer open.
      const picked = Math.max(Math.abs(num(row?.quantitypicked) ?? 0) - done, 0);
      const location = row?.location == null || row.location === "" ? null : { id: String(row.location), name: String(row.locationname || row.location) };
      const billed = Math.abs(num(row?.quantitybilled) ?? 0);
      return {
        line,
        orderLine: num(cellValue(cells.orderLine)),
        item: refOf(cells.item),
        description: String(cellValue(cells.description) || ""),
        quantity,
        rate: num(cellValue(cells.rate)),
        amount: num(cellValue(cells.amount)),
        closed: cellValue(cells.isClosed) === true,
        location,
        done,
        picked,
        billed,
        remaining: Math.max(0, quantity - done - picked),
      };
    })
    .filter(Boolean);
}

const HEADER = ["tranId", "tranDate", "memo", "total", "currency", "entity", "customer", "location", "createdFrom", "shipStatus", "shipMethod", "subsidiary"];

export function flowRoutes({ sendJson, authorized }) {
  return {
    "GET /api/flow/numbers": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const sql = numbersSql(url.searchParams.get("item"), url.searchParams.get("location"));
      const result = await withSource("flow", () => suiteqlOsmcp(sql, 200));
      sendJson(res, 200, {
        numbers: result.items.map((row) => ({ id: String(row.id), number: String(row.inventorynumber || row.id), available: Number(row.available) || 0 })),
      });
    },

    "GET /api/flow": async (req, res, url) => {
      if (!(await authorized(req, res))) return;
      const type = String(url.searchParams.get("type") || "");
      if (!Object.hasOwn(FLOW_TYPES, type)) {
        sendJson(res, 400, { error: "This page opens quotes, orders, invoices, fulfillments, payments, purchase orders, receipts and bills." });
        return;
      }
      const id = checkedId(url.searchParams.get("id"));
      const [record, quantities] = await withSource("flow", () =>
        Promise.all([callTool("ns_getRecord", { recordType: type, recordId: id }), suiteqlOsmcp(lineQuantitySql(id), 500)]),
      );
      const [head, linked] = await withSource("flow", () => Promise.all([suiteqlOsmcp(headerSql(id), 1), suiteqlOsmcp(linkedSql(id), 50)]));
      const read = readRecord(record?.data);
      const cells = Object.fromEntries(read.fields.map((cell) => [cell.id, cell]));
      const header = Object.fromEntries(HEADER.filter((key) => cells[key]).map((key) => [key, cells[key]]));
      // Customer payments name the customer in `customer`, not `entity`.
      if (!header.entity && header.customer) header.entity = header.customer;
      delete header.customer;
      const items = read.sublists.find((sublist) => sublist.id === "item")?.lines || [];
      let lines = mergeLines(items, quantities.items);
      const itemIds = lines.map((line) => line.item?.id).filter(Boolean);
      // Orders need serial or lot tracking per line; sales orders also need stock by location.
      if ((type === "salesorder" || type === "purchaseorder") && itemIds.length) {
        const [facts, stock] = await withSource("flow", () =>
          Promise.all([suiteqlOsmcp(itemFactsSql(itemIds), 200), type === "salesorder" ? suiteqlOsmcp(stockSql(itemIds), 1000) : null]),
        );
        lines = addStock(lines, facts.items, stock?.items, { stock: type === "salesorder" });
      }
      const top = head.items[0] || {};
      // Receipts and bill payments read "Undefined": they have no status.
      const status = top.status && !/undefined$/i.test(String(top.statusname)) ? { id: String(top.status), name: String(top.statusname || "").replace(/^[^:]*:\s*/, "") } : null;
      const approvalStatus = String(top.approvalstatus ?? "");
      sendJson(res, 200, {
        type,
        id,
        status,
        approvalStatus,
        header,
        number: String(top.docnumber || cells.tranId?.value || ""),
        unpaid: num(top.unpaid),
        lines,
        linked: linked.items
          .map((row) => ({
            id: String(row.id),
            type: recordTypeOfCode(row.type),
            number: String(row.tranid || row.id),
            date: String(row.trandate || ""),
            status: /undefined$/i.test(String(row.status)) ? "" : String(row.status || ""),
            direction: row.direction === "next" ? "next" : "previous",
          }))
          .filter((row) => row.type),
        steps: nextSteps(type, status?.id, lines, { approvalStatus }),
      });
    },
  };
}

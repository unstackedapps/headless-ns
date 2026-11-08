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
  const steps = [];
  const close = { id: "close", label: "Close lines", kind: "close" };
  switch (recordType) {
    case "estimate":
      if (s === "A") steps.push({ id: "convert", label: "Convert to sales order", kind: "transform", target: "salesorder" });
      break;
    case "salesorder":
      if (s === "A") steps.push({ id: "approve", label: "Approve", kind: "action", action: "approve" });
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
      if (["E", "F"].includes(s)) steps.push({ id: "bill", label: "Bill", kind: "transform", target: "vendorbill" });
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

// Adds where each line ships from, how much is available there and elsewhere, and serial or lot tracking.
export function addStock(lines, factRows, stockRows) {
  const facts = new Map((factRows || []).map((row) => [String(row.id), row]));
  return lines.map((line) => {
    const id = line.item?.id || "";
    const fact = facts.get(id);
    const stock = (stockRows || [])
      .filter((row) => String(row.item) === id && Number(row.available) > 0)
      .map((row) => ({ id: String(row.location), name: String(row.name || row.location), available: Number(row.available) }))
      .sort((a, b) => b.available - a.available);
    return {
      ...line,
      tracking: fact?.isserialitem === "T" ? "serial" : fact?.islotitem === "T" ? "lot" : "",
      stock,
      available: line.location ? (stock.find((row) => row.id === line.location.id)?.available ?? 0) : null,
    };
  });
}

// Status letter, open amount and approval status. The record's own status id is not always the letter. this one was made from or turned into.
export function headerSql(id) {
  return `SELECT status, BUILTIN.DF(status) AS statusname, foreignamountunpaid AS unpaid, approvalstatus FROM transaction WHERE id = ${checkedId(id)}`;
}

// Records this one was made from or turned into.
export function linkedSql(id) {
  const tx = checkedId(id);
  return `SELECT DISTINCT t.id, t.type, t.tranid, t.trandate, BUILTIN.DF(t.status) AS status,
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
      if (type === "salesorder" && itemIds.length) {
        const [facts, stock] = await withSource("flow", () => Promise.all([suiteqlOsmcp(itemFactsSql(itemIds), 200), suiteqlOsmcp(stockSql(itemIds), 1000)]));
        lines = addStock(lines, facts.items, stock.items);
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

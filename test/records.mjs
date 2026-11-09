import assert from "node:assert/strict";
import test from "node:test";
import {
  applyData,
  billData,
  cleanLines,
  cleanWrite,
  externalIdSql,
  formShape,
  fulfillData,
  inventoryNumbers,
  isTimeout,
  itemDefaults,
  itemDefaultsSql,
  plainError,
  lookupSql,
  newRecordId,
  readRecord,
  scalarFields,
} from "../server/records.mjs";
import { toolFailure } from "../server/osmcp.mjs";

test("record forms keep plain fields and drop sensitive ones", () => {
  const fields = scalarFields({
    companyName: { title: "Company", type: "string" },
    socialsecuritynumber: { title: "SSN", type: "string" },
    password: { title: "Password", type: "string" },
    addressBook: { title: "Address", type: "object" },
    balance: { title: "Balance", type: "number" },
  });
  assert.deepEqual(
    fields.map((field) => field.id),
    ["balance", "companyName"],
  );
});

test("form shape finds references, selects and sublist lines", () => {
  const ref = { type: "object", properties: { id: { type: "string" }, refName: { type: "string" } } };
  const shape = formShape("estimate", {
    memo: { title: "Memo", type: "string" },
    entity: ref,
    status: { type: "object", properties: { id: { type: "string", enum: ["A", "B"] }, refName: { type: "string" } } },
    item: { type: "object", properties: { items: { type: "array", items: { properties: { item: ref, quantity: { title: "Quantity", type: "number" } } } } } },
  });
  assert.deepEqual(shape.fields.find((field) => field.id === "entity"), { id: "entity", title: "Entity", type: "ref", source: "customer" });
  assert.deepEqual(shape.fields.find((field) => field.id === "status")?.options, ["A", "B"]);
  assert.deepEqual(shape.sublists[0].fields.map((field) => field.id), ["item", "quantity"]);
  assert.equal(formShape("vendorbill", { entity: ref }).fields[0].source, "vendor");
});

test("a read record keeps refName and returns sublist lines", () => {
  const read = readRecord({
    entity: { id: "341", refName: "124 Quinu LLP" },
    memo: "x",
    gender: "x",
    item: { items: [{ line: 1, item: { id: "248", refName: "SPC002 Spices" }, quantity: 2, inventoryDetail: { a: 1 } }] },
  });
  assert.deepEqual(read.fields, [
    { id: "entity", value: "341", refName: "124 Quinu LLP" },
    { id: "memo", value: "x" },
  ]);
  assert.deepEqual(read.sublists[0].id, "item");
  assert.deepEqual(read.sublists[0].lines[0].item, { id: "item", value: "248", refName: "SPC002 Spices" });
  assert.equal(read.sublists[0].lines[0].inventoryDetail, undefined);
});

test("a write sends filled values, references as {id}, and null to clear", () => {
  assert.deepEqual(
    cleanWrite({
      companyName: " Acme ",
      phone: "",
      birthdate: "2000-01-01",
      id: "3",
      externalId: "x",
      note: { text: "x" },
      entity: { id: "341", refName: "ignored" },
      shipMethod: null,
      bad: { id: "1; DROP" },
    }),
    { companyName: "Acme", entity: { id: "341" }, shipMethod: null },
  );
});

test("sublist lines are wrapped as items, with line numbers kept only when valid", () => {
  assert.deepEqual(
    cleanLines({
      item: [
        { item: { id: "248" }, quantity: 2, rate: 10 },
        { line: 5, isClosed: true },
        { line: -1, quantity: 3 },
        {},
      ],
      "bad name": [{ quantity: 1 }],
    }),
    { item: { items: [{ item: { id: "248" }, quantity: 2, rate: 10 }, { line: 5, isClosed: true }, { quantity: 3 }] } },
  );
});

test("a fulfillment ships only the picked lines and skips the carrier label", () => {
  assert.deepEqual(
    fulfillData({
      lines: [
        { orderLine: 1, receive: true, quantity: 2 },
        { orderLine: 2, receive: false, quantity: 3 },
      ],
      shipStatus: "C",
      clearShipMethod: true,
    }),
    {
      item: { items: [{ orderLine: 1, itemReceive: true, quantity: 2 }, { orderLine: 2, itemReceive: false }] },
      generateIntegratedShipperLabel: false,
      shipStatus: { id: "C" },
      shipMethod: null,
    },
  );
  assert.throws(() => fulfillData({ lines: [{ orderLine: 1, receive: false }] }), /at least one line/);
  assert.throws(() => fulfillData({ lines: [{ orderLine: 1, receive: true, quantity: 0 }] }), /quantity/);
  assert.deepEqual(fulfillData({ shipStatus: "Z" }, "itemreceipt"), {});
});

test("tool results give the new id and a readable failure", () => {
  assert.equal(newRecordId({ success: true, recordId: "16189" }), "16189");
  assert.equal(newRecordId({ success: true, recordId: "x" }), "");
  assert.equal(
    toolFailure({ success: false, error: 'HTTP 400: {"o:errorDetails":[{"detail":"Error while accessing a resource. No UPS registration was found."}]}' }),
    "No UPS registration was found.",
  );
  assert.equal(isTimeout("The host you are trying to connect to has exceeded the maximum allowed response time."), true);
  assert.equal(isTimeout("No UPS registration"), false);
});

test("lookups and external id checks keep user text inside the quotes", () => {
  const sql = lookupSql("customer", "o'brien' OR 1=1 --");
  assert.match(sql, /LIKE '%o''brien'' or 11 --%'/);
  assert.match(lookupSql("item", "248"), /OR id = 248\)/);
  assert.throws(() => lookupSql("customer; drop", "x"), /cannot be searched/);
  assert.equal(externalIdSql("salesorder", "hns-salesorder-1"), "SELECT id FROM transaction WHERE externalid = 'hns-salesorder-1'");
  assert.equal(externalIdSql("inventoryitem", "a"), "SELECT id FROM item WHERE externalid = 'a'");
  assert.throws(() => externalIdSql("salesorder", "x' OR '1'='1"), /not valid/);
});

test("fulfillment lines carry serial or lot numbers that add up to the quantity", () => {
  const data = fulfillData({ lines: [{ orderLine: 1, receive: true, quantity: 1, numbers: [{ id: "6152", quantity: 1 }] }] });
  assert.deepEqual(data.item.items[0].inventoryDetail, { inventoryAssignment: { items: [{ issueInventoryNumber: { id: "6152" }, quantity: 1 }] } });
  assert.equal(inventoryNumbers([], 1, 1), null);
  assert.equal(inventoryNumbers(undefined, 1, 1), null);
  assert.throws(() => inventoryNumbers([{ id: "6152", quantity: 1 }], 1, 2), /ships 2, but the numbers add up to 1/);
  assert.throws(() => inventoryNumbers([{ id: "1 OR 1=1", quantity: 1 }], 1, 1), /not valid/);
  assert.throws(() => inventoryNumbers([{ id: "5", quantity: -1 }], 1, -1), /not valid/);
  assert.throws(() => inventoryNumbers("6152", 1, 1), /not valid/);
});

test("NetSuite errors become a reason the user can act on", () => {
  assert.match(plainError("Please configure the inventory detail in line 1 of the item list."), /Line 1 is a serial or lot item/);
  assert.match(plainError("You have entered an Invalid Field Value 6 for the following field: location."), /subsidiary/);
  assert.match(plainError("Please enter a value for Amount."), /needs a rate/);
  assert.match(plainError("You must have at least one valid line item for this transaction."), /stock at its location/);
  assert.equal(plainError("Something else."), "Something else.");
});

test("locations can be limited to a customer's or vendor's subsidiary", () => {
  assert.match(lookupSql("location", "lon", { party: "customer", id: "341" }), /locationsubsidiarymap WHERE subsidiary = \(SELECT subsidiary FROM customer WHERE id = 341\)/);
  assert.doesNotMatch(lookupSql("item", "x", { party: "customer", id: "341" }), /subsidiary/);
  assert.throws(() => lookupSql("location", "", { party: "employee", id: "1" }), /not valid/);
  assert.throws(() => lookupSql("location", "", { party: "customer", id: "1 OR 1=1" }), /not valid/);
  assert.throws(() => lookupSql("__proto__", ""), /cannot be searched/);
});

test("item defaults follow the side of the transaction", () => {
  assert.match(itemDefaultsSql("5"), /WHERE i\.id = 5$/);
  assert.throws(() => itemDefaultsSql("5 OR 1=1"), /Pick an item/);
  const row = { description: "Server", purchasedescription: "Server, bought", cost: 4637, lastpurchaseprice: null, baseprice: 7995 };
  assert.deepEqual(itemDefaults(row, "sale"), { rate: 7995, description: "Server", rateLabel: "Base price" });
  assert.deepEqual(itemDefaults(row, "purchase"), { rate: 4637, description: "Server, bought", rateLabel: "Purchase price" });
  assert.equal(itemDefaults({ description: "Spices", baseprice: null }, "sale").rate, null);
  assert.equal(itemDefaults({ cost: null, lastpurchaseprice: 0 }, "purchase").rate, null);
});

test("receipts name new serial or lot numbers", () => {
  const data = fulfillData(
    { lines: [{ orderLine: 1, receive: true, quantity: 3, numbers: [{ number: "HNS-P4-LOT-A", quantity: 2 }, { number: "HNS-P4-LOT-B", quantity: 1 }] }] },
    "itemreceipt",
  );
  assert.deepEqual(data.item.items[0].inventoryDetail.inventoryAssignment.items, [
    { receiptInventoryNumber: "HNS-P4-LOT-A", quantity: 2 },
    { receiptInventoryNumber: "HNS-P4-LOT-B", quantity: 1 },
  ]);
  assert.throws(() => inventoryNumbers([{ number: "A", quantity: 1 }], 1, 2, "itemreceipt"), /receives 2, but the numbers add up to 1/);
  assert.throws(() => inventoryNumbers([{ number: "A'; DROP", quantity: 1 }], 1, 1, "itemreceipt"), /not valid/);
  // A fulfillment never takes a typed number, only one in stock.
  assert.throws(() => inventoryNumbers([{ number: "A", quantity: 1 }], 1, 1), /not valid/);
});

test("a purchase order bill sends a quantity for each order line", () => {
  assert.deepEqual(billData({ lines: [{ orderLine: 1, quantity: 3 }, { orderLine: 2, quantity: 0 }] }), {
    item: { items: [{ orderLine: 1, quantity: 3 }, { orderLine: 2, quantity: 0 }] },
  });
  assert.deepEqual(billData(undefined), {});
  assert.throws(() => billData({ lines: [{ orderLine: 1, quantity: 0 }] }), /at least one line/);
  assert.throws(() => billData({ lines: [{ orderLine: 1, quantity: -1 }] }), /0 or more/);
});

test("a bill payment pays the chosen bills and unticks the source bill when left out", () => {
  assert.deepEqual(applyData([{ doc: "17091", amount: 5 }, { doc: "17093", amount: 1.2 }], "17091"), {
    apply: { items: [{ doc: { id: "17091" }, apply: true, amount: 5 }, { doc: { id: "17093" }, apply: true, amount: 1.2 }] },
  });
  assert.deepEqual(applyData([{ doc: "17093", amount: 3.004 }], "17091").apply.items, [
    { doc: { id: "17093" }, apply: true, amount: 3 },
    { doc: { id: "17091" }, apply: false },
  ]);
  assert.deepEqual(applyData(undefined, "1"), {});
  assert.throws(() => applyData([], "1"), /at least one bill/);
  assert.throws(() => applyData([{ doc: "1", amount: 0 }], "1"), /above 0/);
  assert.throws(() => applyData([{ doc: "1 OR 1", amount: 2 }], "1"), /not valid/);
  assert.throws(() => applyData([{ doc: "1", amount: 2 }, { doc: "1", amount: 2 }], "1"), /not valid/);
});

test("record search covers five tables, keeps the term inside its quotes, and needs two characters", async () => {
  const { findSql } = await import("../server/records.mjs");
  const sql = findSql("O'Neil");
  assert.equal((sql.match(/UNION ALL/g) || []).length, 4);
  assert.match(sql, /LIKE '%o''neil%'/);
  assert.throws(() => findSql("a"), /two letters/);
});

test("search rows turn item types into record types and drop bad ones", async () => {
  const { foundRows } = await import("../server/records.mjs");
  const rows = foundRows([
    { id: 248, label: "SPC002", type: "InvtPart", detail: "Spice", sub: null },
    { id: 9, label: "Install", type: "Service", detail: "", sub: "Sale" },
    { id: 341, label: "124 Quinu LLP ", type: "customer", detail: "info@quinu.com" },
    { id: 1, label: "bad", type: "x; drop", detail: "" },
  ]);
  assert.deepEqual(rows.map((row) => `${row.type}:${row.id}:${row.label}`), ["inventoryitem:248:SPC002", "servicesaleitem:9:Install", "customer:341:124 Quinu LLP"]);
});

test("the pick list reads the right table for lists, items and transactions", async () => {
  const { latestSql } = await import("../server/records.mjs");
  assert.match(latestSql("customer"), /FROM customer WHERE isinactive = 'F' ORDER BY id DESC/);
  assert.match(latestSql("inventoryitem"), /FROM item WHERE itemtype = 'InvtPart'/);
  assert.match(latestSql("vendorbill"), /NVL\(tranid, transactionnumber\).*recordtype = 'vendorbill'/);
  assert.throws(() => latestSql("x'; drop"), /not valid/);
});

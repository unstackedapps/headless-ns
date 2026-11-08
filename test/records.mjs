import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanLines,
  cleanWrite,
  externalIdSql,
  formShape,
  fulfillData,
  isTimeout,
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

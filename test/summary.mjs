import assert from "node:assert/strict";
import test from "node:test";
import { describeWrite, namesSql, summaryRefs } from "../server/summary.mjs";

const names = { transaction: { 16190: "SO626", 16189: "QUO98" }, item: { 248: "SPC002" } };

test("a fulfillment transform names the order, lines, units and status", () => {
  const args = {
    sourceRecordType: "salesorder",
    sourceRecordId: "16190",
    targetRecordType: "itemfulfillment",
    data: JSON.stringify({
      generateIntegratedShipperLabel: false,
      shipMethod: null,
      shipStatus: { id: "C" },
      item: { items: [{ orderLine: 1, itemReceive: true, quantity: 2 }, { orderLine: 2, itemReceive: false }] },
    }),
  };
  const summary = describeWrite("ns_transformRecord", args, names);
  assert.equal(summary.title, "Turn sales order SO626 into a fulfillment: 1 line, 2 units, status Shipped");
  assert.deepEqual(summary.details, ["Order line 1: 2", "Order line 2: skip", "No carrier label", "Clears the ship method"]);
});

test("a quote to order transform with no data still reads", () => {
  const summary = describeWrite("ns_transformRecord", { sourceRecordType: "estimate", sourceRecordId: "16189", targetRecordType: "salesorder" }, names);
  assert.equal(summary.title, "Turn quote QUO98 into a sales order");
});

test("unknown names fall back to the id and missing rates say so", () => {
  const data = { entity: { id: "9" }, item: { items: [{ item: { id: "248" }, quantity: 1 }] } };
  const summary = describeWrite("ns_createRecord", { recordType: "salesorder", data }, names);
  assert.equal(summary.title, "Create sales order for #9: 1 line, total set by NetSuite prices");
  assert.deepEqual(summary.details, ["1 × SPC002"]);
});

test("an update lists the fields it changes", () => {
  const summary = describeWrite("ns_updateRecord", { recordType: "salesorder", recordId: "16190", data: '{"memo":"x","location":{"id":"2"}}' }, names);
  assert.equal(summary.title, "Update sales order SO626: memo, location");
});

test("only digit ids reach the name lookup SQL", () => {
  const refs = summaryRefs("ns_createRecord", { data: { entity: { id: "1 OR 1=1" }, location: { id: "2" } } });
  assert.deepEqual(refs.entity, []);
  assert.equal(namesSql("location", refs.location), "SELECT id, name FROM location WHERE id IN (2)");
  assert.equal(namesSql("entity", ["1); DROP"]), "");
});

test("totals use the customer's currency, or the record's own currency when it sets one", () => {
  const data = { entity: { id: "1194" }, item: { items: [{ item: { id: "248" }, quantity: 2, rate: 10 }] } };
  const priced = { ...names, currency: { 4: "Euro" }, currencies: { entity: { 1194: "British pound" } } };
  const summary = describeWrite("ns_createRecord", { recordType: "estimate", data }, priced);
  assert.equal(summary.title, "Create quote for #1194: 1 line, total 20.00 British pound");
  assert.deepEqual(summary.details, ["2 × SPC002 at 10.00 British pound"]);
  const euro = describeWrite("ns_createRecord", { recordType: "estimate", data: { ...data, currency: { id: "4" } } }, priced);
  assert.equal(euro.title, "Create quote for #1194: 1 line, total 20.00 Euro");
  // No currency found: the figure stands alone instead of a guessed "$".
  assert.equal(describeWrite("ns_createRecord", { recordType: "estimate", data }, names).title, "Create quote for #1194: 1 line, total 20.00");
});

test("fulfillment lines show their serial or lot numbers", () => {
  const line = (items) => ({ orderLine: 1, itemReceive: true, quantity: 3, inventoryDetail: { inventoryAssignment: { items } } });
  const data = { item: { items: [line([{ issueInventoryNumber: { id: "6148" }, quantity: 2 }, { issueInventoryNumber: { id: "6149" }, quantity: 1 }])] } };
  const args = { sourceRecordType: "salesorder", sourceRecordId: "16190", targetRecordType: "itemfulfillment", data };
  assert.deepEqual(summaryRefs("ns_transformRecord", args).number, ["6148", "6149"]);
  const summary = describeWrite("ns_transformRecord", args, { ...names, number: { 6148: "LOT-DEMO-A" } });
  assert.deepEqual(summary.details, ["Order line 1: 3 (LOT-DEMO-A × 2, #6149)"]);
  assert.equal(namesSql("number", ["6148"]), "SELECT id, inventorynumber AS name FROM inventorynumber WHERE id IN (6148)");
});

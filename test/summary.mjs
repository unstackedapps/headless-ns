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

import assert from "node:assert/strict";
import test from "node:test";
import { ITEM_TYPES, TX_LISTS, itemListSql, itemRecordType, pageOf, partyMatch, statusWhere, txListSql, vendorListSql } from "../server/lists.mjs";

const attacks = ["x' OR 1=1 --", "'; DROP TABLE customer; --", "o'brien", "%' UNION SELECT password FROM employee --", "x'".repeat(40)];

// Every quote in the SQL must be part of a '' pair or open and close a literal with no ; or -- outside.
function outsideLiterals(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

test("each list filters by its own type and the open statuses by default", () => {
  assert.match(txListSql("orders"), /t\.type = 'SalesOrd'/);
  assert.match(txListSql("orders"), /t\.status IN \('A', 'B', 'D', 'E', 'F'\)/);
  assert.match(txListSql("quotes"), /t\.status IN \('A'\)/);
  assert.match(txListSql("bills"), /t\.type = 'VendBill' .*t\.status IN \('A', 'D'\)/s);
  assert.match(txListSql("purchaseorders"), /ABS\(t\.foreigntotal\)/);
});

test("status filters take open, all, or a letter from the list", () => {
  assert.equal(statusWhere(TX_LISTS.orders, "all"), "");
  assert.equal(statusWhere(TX_LISTS.orders, "G"), " AND t.status IN ('G')");
  assert.equal(statusWhere(TX_LISTS.receipts, "G"), "");
  assert.equal(statusWhere(TX_LISTS.payments, "open"), "");
  assert.equal(statusWhere(TX_LISTS.payments, "C"), " AND t.status IN ('C')");
  for (const bad of ["Z", "SalesOrd:G", "G') OR ('1'='1", "constructor", "toString", "__proto__"]) {
    assert.throws(() => statusWhere(TX_LISTS.orders, bad), /status/, bad);
  }
});

test("unknown lists and bad entity ids are refused", () => {
  assert.throws(() => txListSql("employees"), /list/);
  assert.throws(() => txListSql("__proto__"), /list/);
  assert.match(txListSql("bills", { entity: "628" }), /t\.entity = 628/);
  for (const bad of ["0", "1 OR 1=1", "-5", "12a"]) assert.throws(() => txListSql("bills", { entity: bad }), /id/);
});

test("search text stays inside its literals", () => {
  for (const attack of attacks) {
    for (const sql of [txListSql("orders", { q: attack }), partyMatch("vendor", attack), vendorListSql(attack), itemListSql({ q: attack })]) {
      const code = outsideLiterals(sql);
      assert.ok(!/;|--|UNION|DROP/i.test(code), sql);
    }
  }
  assert.equal(partyMatch("customer", ""), "");
  assert.match(partyMatch("vendor", "core"), /FROM vendor WHERE/);
});

test("page numbers are whole and bounded", () => {
  assert.equal(pageOf("2"), 2);
  assert.equal(pageOf(null), 0);
  for (const bad of ["-1", "1.5", "x", "501", "1e3"]) assert.equal(pageOf(bad), 0, bad);
});

test("items filter by a known type or none", () => {
  assert.doesNotMatch(itemListSql(), /itemtype =/);
  assert.match(itemListSql({ type: "Service" }), /itemtype = 'Service'/);
  assert.throws(() => itemListSql({ type: "Service' OR '1'='1" }), /item type/);
  assert.throws(() => itemListSql({ type: "constructor" }), /item type/);
  assert.equal(Object.keys(ITEM_TYPES).length, 13);
});

test("item types map to the record type the Records screen opens", () => {
  assert.equal(itemRecordType("InvtPart", null), "inventoryitem");
  assert.equal(itemRecordType("NonInvtPart", "Resale"), "noninventoryresaleitem");
  assert.equal(itemRecordType("Service", null), "servicesaleitem");
  assert.equal(itemRecordType("OthCharge", "Purchase"), "otherchargepurchaseitem");
  assert.equal(itemRecordType("Nope", null), "");
});

import assert from "node:assert/strict";
import test from "node:test";
import { addColumn, isMissingLabel, toCsv } from "../src/sql.ts";

test("a column click starts a SELECT, then adds to it, and a new table starts over", () => {
  let sql = addColumn("", "customer", "entityid");
  assert.equal(sql, "SELECT entityid\nFROM customer");
  sql = addColumn(sql, "customer", "email");
  assert.equal(sql, "SELECT entityid, email\nFROM customer");
  assert.equal(addColumn(sql, "customer", "EMAIL"), sql);
  assert.equal(addColumn("select * from customer where isinactive = 'F'", "customer", "id"), "SELECT id\nFROM customer where isinactive = 'F'");
  assert.equal(addColumn(sql, "vendor", "id"), "SELECT id\nFROM vendor");
});

test("CSV quotes commas, quotes and line breaks", () => {
  assert.equal(toCsv(["a", "b"], [{ a: 'say "hi"', b: "x,y" }, { a: null, b: 2 }]), 'a,b\r\n"say ""hi""","x,y"\r\n,2');
});

test("NetSuite's unlabeled tables are spotted", () => {
  assert.equal(isMissingLabel("[Missing Label:AccountsReceivableAging]"), true);
  assert.equal(isMissingLabel("Customer"), false);
});

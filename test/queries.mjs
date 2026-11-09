import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertReadQuery, deleteQuery, findQuery, queryPage, readQueries, saveQuery } from "../server/queries.mjs";

const dir = mkdtempSync(join(tmpdir(), "hn-queries-"));
const file = join(dir, "queries.json");
test.after(() => rmSync(dir, { recursive: true, force: true }));

test("only one SELECT or WITH runs", () => {
  assert.equal(assertReadQuery(" select 1 from dual; "), "select 1 from dual");
  assert.throws(() => assertReadQuery("delete from customer"), /Only a SELECT/);
  assert.throws(() => assertReadQuery("select 1; select 2"), /one statement/);
  assert.throws(() => assertReadQuery(""), /Write a SELECT/);
});

test("pages stop at NetSuite's 5,000-row limit", () => {
  assert.deepEqual(queryPage({}), { page: 0, size: 40 });
  assert.deepEqual(queryPage({ page: 4, pageSize: 1000 }), { page: 4, size: 1000 });
  assert.deepEqual(queryPage({ pageSize: 99999 }), { page: 0, size: 1000 });
  assert.throws(() => queryPage({ page: 5, pageSize: 1000 }), /5,000 rows/);
});

test("saved queries replace by name without case, sort by name, and delete", () => {
  saveQuery({ name: "Open orders", sql: "select id from transaction" }, file);
  saveQuery({ name: "big bills", sql: "select id from transaction where type = 'VendBill'" }, file);
  saveQuery({ name: "open ORDERS", sql: "select tranid from transaction" }, file);
  assert.deepEqual(readQueries(file).map((row) => row.name), ["big bills", "open ORDERS"]);
  assert.equal(findQuery("Open Orders", file).sql, "select tranid from transaction");
  assert.throws(() => saveQuery({ name: "x", sql: "drop table x" }, file), /Only a SELECT/);
  assert.throws(() => saveQuery({ name: "../etc", sql: "select 1" }, file), /Name the query/);
  deleteQuery("BIG BILLS", file);
  assert.deepEqual(readQueries(file).map((row) => row.name), ["open ORDERS"]);
});

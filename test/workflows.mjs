import assert from "node:assert/strict";
import test from "node:test";
import { headerSql, lineQuantitySql, linkedSql, mergeLines, nextSteps, recordTypeOfCode } from "../server/workflows.mjs";

const ids = (steps) => steps.map((step) => step.id);
const open = [{ closed: false, remaining: 2 }];
const shipped = [{ closed: false, remaining: 0 }];

test("a quote converts only while open", () => {
  assert.deepEqual(ids(nextSteps("estimate", "A")), ["convert"]);
  assert.equal(nextSteps("estimate", "A")[0].target, "salesorder");
  assert.deepEqual(ids(nextSteps("estimate", "B")), []);
  assert.deepEqual(ids(nextSteps("estimate", "X")), []);
});

test("sales order steps follow status and open quantities", () => {
  assert.deepEqual(ids(nextSteps("salesorder", "A", open)), ["approve", "close"]);
  assert.deepEqual(ids(nextSteps("salesorder", "B", open)), ["fulfill", "close"]);
  assert.deepEqual(ids(nextSteps("salesorder", "E", open)), ["fulfill", "bill", "close"]);
  assert.deepEqual(ids(nextSteps("salesorder", "F", shipped)), ["bill", "close"]);
  assert.deepEqual(ids(nextSteps("salesorder", "B", shipped)), ["close"]);
  assert.deepEqual(ids(nextSteps("salesorder", "G", open)), []);
  assert.deepEqual(ids(nextSteps("salesorder", "H", open)), []);
  assert.deepEqual(ids(nextSteps("salesorder", "B", [{ closed: true, remaining: 2 }])), []);
});

test("invoices and bills take payment while open", () => {
  assert.deepEqual(ids(nextSteps("invoice", "A")), ["pay"]);
  assert.equal(nextSteps("invoice", "A")[0].target, "customerpayment");
  assert.deepEqual(ids(nextSteps("invoice", "B")), []);
  assert.deepEqual(ids(nextSteps("vendorbill", "A")), ["pay"]);
  assert.equal(nextSteps("vendorbill", "A")[0].target, "vendorpayment");
  assert.deepEqual(ids(nextSteps("vendorbill", "B")), []);
  assert.deepEqual(ids(nextSteps("vendorbill", "D")), ["approve"]);
  assert.deepEqual(ids(nextSteps("vendorbill", "A", [], { approvalStatus: "1" })), ["approve"]);
});

test("fulfillments move from picked to packed to shipped", () => {
  assert.deepEqual(ids(nextSteps("itemfulfillment", "A")), ["pack", "ship"]);
  assert.deepEqual(nextSteps("itemfulfillment", "B")[0].data, { shipStatus: { id: "C" } });
  assert.deepEqual(ids(nextSteps("itemfulfillment", "C")), []);
});

test("purchase orders approve first, then receive and bill", () => {
  assert.deepEqual(ids(nextSteps("purchaseorder", "A", open)), ["approve"]);
  assert.deepEqual(nextSteps("purchaseorder", "A", open)[0].data, { approvalStatus: { id: "2" } });
  assert.deepEqual(ids(nextSteps("purchaseorder", "B", open, { approvalStatus: "1" })), ["approve"]);
  assert.deepEqual(ids(nextSteps("purchaseorder", "B", open)), ["receive", "close"]);
  assert.deepEqual(ids(nextSteps("purchaseorder", "E", open)), ["receive", "bill", "close"]);
  assert.deepEqual(ids(nextSteps("purchaseorder", "F", shipped)), ["bill", "close"]);
  assert.deepEqual(ids(nextSteps("purchaseorder", "G", shipped)), []);
});

test("unknown types and statuses have no steps", () => {
  assert.deepEqual(nextSteps("journalentry", "A"), []);
  assert.deepEqual(nextSteps("salesorder", ""), []);
  assert.deepEqual(nextSteps("salesorder", undefined), []);
});

test("flow SQL takes only a positive internal id", () => {
  assert.equal(lineQuantitySql("16290"), "SELECT id, quantityshiprecv, quantitybilled FROM transactionline WHERE transaction = 16290 AND mainline = 'F'");
  assert.match(headerSql(12), /WHERE id = 12$/);
  assert.match(linkedSql("7"), /l\.previousdoc = 7 OR l\.nextdoc = 7/);
  for (const bad of ["0", "-1", "1 OR 1=1", "1;", "", null, "12a", "1".repeat(13)]) {
    assert.throws(() => lineQuantitySql(bad), /internal id/);
    assert.throws(() => headerSql(bad), /internal id/);
    assert.throws(() => linkedSql(bad), /internal id/);
  }
});

test("lines merge record cells with SuiteQL quantities by line id", () => {
  const cells = [
    { line: { value: 1 }, item: { value: "248", refName: "SPC002" }, quantity: { value: 2 }, rate: { value: 10 }, isClosed: { value: false } },
    { line: { value: 2 }, item: { value: "243", refName: "GAR002" }, quantity: { value: 3 }, isClosed: { value: true } },
    { item: { value: "1" } },
  ];
  const rows = [
    { id: 1, quantityshiprecv: 2, quantitybilled: 1 },
    { id: 2, quantityshiprecv: -1, quantitybilled: 0 },
  ];
  const lines = mergeLines(cells, rows);
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((line) => [line.line, line.item.name, line.quantity, line.done, line.billed, line.remaining, line.closed]),
    [
      [1, "SPC002", 2, 2, 1, 0, false],
      [2, "GAR002", 3, 1, 0, 2, true],
    ],
  );
});

test("transaction type codes map to record types", () => {
  assert.equal(recordTypeOfCode("SalesOrd"), "salesorder");
  assert.equal(recordTypeOfCode("VendPymt"), "vendorpayment");
  assert.equal(recordTypeOfCode("CustCred"), "creditmemo");
  assert.equal(recordTypeOfCode("Nope"), "");
});

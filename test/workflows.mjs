import assert from "node:assert/strict";
import test from "node:test";
import { addStock, headerSql, itemFactsSql, lineQuantitySql, linkedSql, mergeLines, nextSteps, numbersSql, recordTypeOfCode, shipLinesSql, stockProblems, stockSql } from "../server/workflows.mjs";

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
  assert.match(lineQuantitySql("16290"), /FROM transactionline WHERE transaction = 16290 AND mainline = 'F'$/);
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
    { id: 2, quantityshiprecv: -1, quantitypicked: 2, quantitybilled: 0 },
  ];
  const lines = mergeLines(cells, rows);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].picked, 1);
  assert.deepEqual(
    lines.map((line) => [line.line, line.item.name, line.quantity, line.done, line.billed, line.remaining, line.closed]),
    [
      [1, "SPC002", 2, 2, 1, 0, false],
      [2, "GAR002", 3, 1, 0, 1, true],
    ],
  );
});

test("transaction type codes map to record types", () => {
  assert.equal(recordTypeOfCode("SalesOrd"), "salesorder");
  assert.equal(recordTypeOfCode("VendPymt"), "vendorpayment");
  assert.equal(recordTypeOfCode("CustCred"), "creditmemo");
  assert.equal(recordTypeOfCode("Nope"), "");
});

test("prototype names are not type codes", () => {
  assert.equal(recordTypeOfCode("__proto__"), "");
  assert.equal(recordTypeOfCode("constructor"), "");
});

test("stock and serial SQL take only internal ids", () => {
  assert.match(itemFactsSql(["760", "248", "760"]), /WHERE id IN \(760, 248\)$/);
  assert.match(stockSql(["760", "1 OR 1=1", "-3"]), /ib\.item IN \(760\)/);
  assert.throws(() => stockSql(["x'; --"]), /No items/);
  assert.match(numbersSql("760", "2"), /n\.item = 760 AND inl\.location = 2 /);
  assert.throws(() => numbersSql("760", "2 OR 1=1"), /internal id/);
  assert.throws(() => numbersSql("0", "2"), /internal id/);
});

test("lines learn their stock, location availability and tracking", () => {
  const lines = [
    { line: 1, item: { id: "760", name: "Breville" }, location: { id: "1", name: "Boston" } },
    { line: 2, item: { id: "248", name: "Spices" }, location: { id: "2", name: "San Francisco" } },
  ];
  const facts = [
    { id: 760, isserialitem: "T", islotitem: "F" },
    { id: 248, isserialitem: "F", islotitem: "F" },
  ];
  const stock = [
    { item: 760, location: 2, name: "San Francisco", available: 2 },
    { item: 248, location: 2, name: "San Francisco", available: 30 },
    { item: 248, location: 1, name: "Boston", available: 0 },
  ];
  const [espresso, spices] = addStock(lines, facts, stock);
  assert.equal(espresso.tracking, "serial");
  assert.equal(espresso.available, 0);
  assert.deepEqual(espresso.stock, [{ id: "2", name: "San Francisco", available: 2 }]);
  assert.equal(spices.tracking, "");
  assert.equal(spices.available, 30);
  assert.equal(spices.stock.length, 1);
});

test("a partly received purchase order offers Bill only while received units are unbilled", () => {
  const ids = (steps) => steps.map((step) => step.id);
  const unbilled = [{ closed: false, remaining: 2, done: 3, billed: 0 }];
  const billed = [{ closed: false, remaining: 2, done: 3, billed: 3 }];
  assert.deepEqual(ids(nextSteps("purchaseorder", "D", unbilled)), ["receive", "bill", "close"]);
  assert.deepEqual(ids(nextSteps("purchaseorder", "D", billed)), ["receive", "close"]);
});

test("purchase order lines get serial or lot tracking without stock", () => {
  const [line] = addStock([{ line: 1, item: { id: "693" }, location: { id: "2" } }], [{ id: 693, isserialitem: "F", islotitem: "T" }], null, { stock: false });
  assert.equal(line.tracking, "lot");
  assert.equal("available" in line, false);
});

test("approving a sales order sets it to Pending Fulfillment", () => {
  const [approve] = nextSteps("salesorder", "A", [{ closed: false, remaining: 1 }]);
  assert.deepEqual(approve, { id: "approve", label: "Approve", kind: "update", data: { orderStatus: { id: "B" } } });
});

test("stock problems name the short line and where stock is", () => {
  const line = { line: 1, item: 761, itemname: "Oral-B iO", location: null, locationname: null, headlocation: null, headlocationname: null, quantity: 2, done: 0, picked: 0 };
  const stock = [
    { item: 761, location: 2, name: "San Francisco", available: 3 },
    { item: 761, location: 1, name: "Boston", available: 1 },
  ];
  assert.deepEqual(stockProblems([line], stock), [
    'Line 1 (Oral-B iO) ships 2. The order has no location, so NetSuite cannot ship it. San Francisco (location id 2) has 3. Set that location on the sales order with ns_updateRecord {"location":{"id":"<id>"}}, then fulfill.',
  ]);
  const boston = { ...line, headlocation: 1, headlocationname: "Boston" };
  assert.match(stockProblems([boston], stock)[0], /Only 1 available at Boston\. San Francisco/);
  // Shipping only 1, which Boston has, is fine. A line the payload skips is not checked.
  assert.deepEqual(stockProblems([boston], stock, new Map([[1, 1]])), []);
  assert.deepEqual(stockProblems([boston], [], new Map([[2, 1]])), []);
  assert.match(stockProblems([{ ...boston, quantity: 9 }], stock)[0], /No location has enough\./);
  assert.match(shipLinesSql("17389"), /tl\.transaction = 17389 AND tl\.mainline = 'F'/);
  assert.throws(() => shipLinesSql("1 OR 1=1"), /internal id/);
});

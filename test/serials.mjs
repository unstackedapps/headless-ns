import assert from "node:assert/strict";
import test from "node:test";
import { editRow, numbersProblem, pickedTotal, pickSerial, serialFull, serialRows } from "../src/serials.ts";

const one = (id) => ({ id, quantity: 1 });

test("with one unit, a new serial replaces the old one", () => {
  assert.deepEqual(pickSerial([one("6153")], "6154", true, 1), [one("6154")]);
  assert.deepEqual(pickSerial([], "6153", true, 1), [one("6153")]);
});

test("with more units, picking stops at the quantity", () => {
  let picked = pickSerial([], "a", true, 2);
  picked = pickSerial(picked, "b", true, 2);
  assert.equal(serialFull(picked, 2), true);
  assert.deepEqual(pickSerial(picked, "c", true, 2), picked);
  assert.deepEqual(pickSerial(picked, "a", false, 2), [one("b")]);
  assert.equal(serialFull([one("b")], 2), false);
});

test("picking the same serial twice keeps one", () => {
  assert.deepEqual(pickSerial([one("a")], "a", true, 3), [one("a")]);
});

test("receiving serial items gives one box per unit and keeps what was typed", () => {
  assert.deepEqual(serialRows([{ number: "S1", quantity: 1 }], 2), [
    { number: "S1", quantity: 1 },
    { number: "", quantity: 1 },
  ]);
  assert.deepEqual(serialRows([], 0), []);
});

test("a tracked line is ready only when its numbers are named and add up", () => {
  assert.equal(numbersProblem([{ number: "A", quantity: 2 }, { number: "B", quantity: 1 }], 3, "lot", 1, true), "");
  assert.match(numbersProblem([{ number: "A", quantity: 2 }], 3, "lot", 1, true), /receives 3, but its lot quantities add up to 2/);
  assert.match(numbersProblem([{ number: " ", quantity: 1 }], 1, "serial", 2, true), /Line 2 needs every serial number filled in/);
  assert.match(numbersProblem([{ number: "A", quantity: 1 }, { number: "A", quantity: 1 }], 2, "serial", 1, true), /same serial number twice/);
  assert.match(numbersProblem([], 1, "lot", 1, false), /needs its lot number picked/);
  assert.equal(numbersProblem([{ id: "6148", quantity: 2 }, { id: "6149", quantity: 1 }], 3, "lot", 1, false), "");
  assert.equal(pickedTotal(editRow([{ quantity: 1 }, { quantity: 1 }], 1, { quantity: 4 })), 5);
});

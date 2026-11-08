import assert from "node:assert/strict";
import test from "node:test";
import { pickSerial, serialFull } from "../src/serials.ts";

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

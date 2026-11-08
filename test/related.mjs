import assert from "node:assert/strict";
import test from "node:test";
import { walkRelated } from "../server/related.mjs";

const pairs = [
  ["1", "2"],
  ["2", "3"],
  ["3", "4"],
  ["4", "5"],
  ["5", "6"],
  ["6", "7"],
  ["7", "8"],
  ["8", "9"],
  ["99", "100"],
];

function lookup(frontier) {
  const front = new Set(frontier);
  return pairs
    .filter(([prev, dest]) => front.has(prev) || front.has(dest))
    .map(([previousdoc, nextdoc]) => ({ previousdoc, nextdoc }));
}

test("a transaction walk goes six steps either way and ignores the rest", async () => {
  const forward = await walkRelated("1", lookup, 6);
  assert.deepEqual(forward.ids, ["1", "2", "3", "4", "5", "6", "7"]);
  assert.equal(forward.ids.includes("8"), false);
  assert.equal(forward.ids.includes("99"), false);

  const backward = await walkRelated("7", lookup, 6);
  assert.equal(backward.ids.includes("1"), true);
  assert.equal(backward.ids.includes("9"), true);
  assert.equal(backward.ids.includes("99"), false);
});

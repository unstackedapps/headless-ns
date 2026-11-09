import assert from "node:assert/strict";
import test from "node:test";
import { validAccountId } from "../server/env.mjs";

test("accepts NetSuite account ids", () => {
  for (const id of ["1234567", "1234567_SB1", "TSTDRV123456", "TD3138390", "1234567-sb1"]) {
    assert.equal(validAccountId(id), true, id);
  }
});

test("rejects empty, long, or host-like values", () => {
  for (const id of ["", "1234567.app", "evil.com/x", "a b", "x".repeat(41), null, undefined]) {
    assert.equal(validAccountId(id), false, String(id));
  }
});

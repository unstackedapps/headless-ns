import assert from "node:assert/strict";
import test from "node:test";
import { moveMenu, readMenu, setHidden } from "../src/menu.ts";

test("the menu keeps a saved order and a hidden item", () => {
  const menu = readMenu([
    { id: "orders", hidden: false },
    { id: "quotes", hidden: true },
    { id: "nope", hidden: false },
  ]);
  assert.equal(menu[0].id, "orders");
  assert.equal(menu[1].id, "quotes");
  assert.equal(menu[1].hidden, true);
  assert.equal(menu.some((item) => item.id === "customers"), true);
  assert.equal(menu.some((item) => item.id === "nope"), false);
  const moved = moveMenu(menu, "orders", 1);
  assert.equal(moved[0].id, "quotes");
  assert.equal(moved[1].id, "orders");
  const fresh = readMenu(null);
  const blocked = moveMenu(fresh, "files", 1);
  assert.equal(blocked.findIndex((item) => item.id === "records"), fresh.findIndex((item) => item.id === "records"));
  assert.equal(setHidden(menu, "quotes", false).find((item) => item.id === "quotes")?.hidden, false);
});

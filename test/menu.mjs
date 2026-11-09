import assert from "node:assert/strict";
import test from "node:test";
import { groupOf, moveMenu, readGroups, readMenu, saveMenu, setHidden } from "../src/menu.ts";

test("the default menu pins Overview first and Settings last, with Quotes above Orders", () => {
  const menu = readMenu(null);
  assert.equal(menu[0].id, "overview");
  assert.equal(menu.at(-1).id, "settings");
  const ids = menu.map((item) => item.id);
  assert.ok(ids.indexOf("quotes") < ids.indexOf("orders"));
  assert.deepEqual([...new Set(menu.map((item) => item.group))], ["Top", "Sales", "Purchasing", "Company", "Data", "Tools", "Bottom"]);
});

test("the menu keeps a saved order and a hidden item, and drops unknown ids", () => {
  const menu = readMenu(saveMenu(moveMenu(setHidden(readMenu(null), "quotes", true), "quotes", 1)));
  const ids = menu.map((item) => item.id);
  assert.ok(ids.indexOf("orders") < ids.indexOf("quotes"));
  assert.equal(menu.find((item) => item.id === "quotes")?.hidden, true);
  assert.equal(readMenu({ v: 2, items: [{ id: "nope" }] }).some((item) => item.id === "nope"), false);
  assert.equal(setHidden(menu, "quotes", false).find((item) => item.id === "quotes")?.hidden, false);
});

test("a menu saved before the groups keeps what was hidden, takes the new order, and its group comes from the defaults", () => {
  const old = [
    { id: "orders", hidden: false, group: "Ledger" },
    { id: "quotes", hidden: true, group: "Ledger" },
    { id: "records", hidden: false, group: "Studio" },
  ];
  const menu = readMenu(old);
  const ids = menu.map((item) => item.id);
  assert.ok(ids.indexOf("quotes") < ids.indexOf("orders"));
  assert.equal(menu.find((item) => item.id === "quotes")?.hidden, true);
  assert.equal(menu.find((item) => item.id === "records")?.group, "Data");
});

test("items move only inside their group", () => {
  const fresh = readMenu(null);
  const blocked = moveMenu(fresh, "returns", 1);
  assert.deepEqual(blocked.map((item) => item.id), fresh.map((item) => item.id));
});

test("group open state falls back to the defaults, and the kicker is the group", () => {
  assert.deepEqual(readGroups({ Company: true, Sales: "x" }), { Sales: true, Purchasing: true, Company: true, Data: false, Tools: false });
  assert.equal(groupOf("query"), "Data");
  assert.equal(groupOf("overview"), "");
});

import assert from "node:assert/strict";
import test from "node:test";
import { lookupPlan, statusLabel, withNames } from "../server/searchnames.mjs";

const columns = ["Date", "Period", "Document Number", "Name", "Currency", "Amount", "Status", "Amount (Foreign Currency)"];
const rows = [
  { Date: "1/2/2026", Period: "275", "Document Number": "SO252", Name: "479", Currency: "1", Amount: "4790.40", Status: "pendingFulfillment", "Amount (Foreign Currency)": "4790.40" },
  { Date: "1/4/2026", Period: "275", "Document Number": "SO258", Name: "483", Currency: "1", Amount: "7185.60", Status: "pendingFulfillment", "Amount (Foreign Currency)": "7185.60" },
];

test("status codes read as words; other text stays as it is", () => {
  assert.equal(statusLabel("pendingFulfillment"), "Pending fulfillment");
  assert.equal(statusLabel("fullyBilled"), "Fully billed");
  assert.equal(statusLabel("Paid In Full"), "Paid In Full");
  assert.equal(statusLabel("shipped"), "shipped");
});

test("only id columns with a known label get a lookup, once per distinct id", () => {
  const plan = lookupPlan(columns, rows);
  assert.deepEqual(plan.map((step) => step.column), ["Period", "Name", "Currency"]);
  assert.match(plan.find((step) => step.column === "Name").sql, /FROM entity WHERE id IN \(479, 483\)$/);
  assert.match(plan.find((step) => step.column === "Period").sql, /BUILTIN\.DF\(postingperiod\)/);
  // A Name column that holds text, or an id mixed with text, is left alone.
  assert.deepEqual(lookupPlan(["Name"], [{ Name: "Acme" }, { Name: "12" }]), []);
});

test("withNames swaps ids for names and labels statuses", async () => {
  const names = {
    entity: [{ id: 479, name: "262 Premium Victualers Supply" }, { id: 483, name: "266 Restaurant Wholesale Inc" }],
    transaction: [{ id: 275, name: "Jan 2026" }],
    currency: [{ id: 1, name: "US Dollar" }],
  };
  const seen = [];
  const out = await withNames(columns, rows, async (sql) => {
    seen.push(sql);
    return names[sql.match(/FROM (\w+)/)[1]];
  });
  assert.equal(seen.length, 3);
  assert.deepEqual(out[1], {
    ...rows[1],
    Period: "Jan 2026",
    Name: "266 Restaurant Wholesale Inc",
    Currency: "US Dollar",
    Status: "Pending fulfillment",
  });
  assert.equal(rows[1].Name, "483");
});

test("a lookup that fails or misses an id leaves the id in place", async () => {
  const out = await withNames(["Name", "Currency"], [{ Name: "479", Currency: "9" }], async (sql) => {
    if (sql.includes("entity")) throw new Error("No permission");
    return [];
  });
  assert.deepEqual(out, [{ Name: "479", Currency: "9" }]);
});

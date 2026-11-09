import { expect, test } from "@playwright/test";
import { mockApi, session } from "./mock";

const order = {
  id: "17489",
  fields: [
    { id: "tranId", value: "SO640" },
    { id: "memo", value: "Rush" },
  ],
  sublists: [],
};

test("Records finds a record by name, lists the newest of a type, and remembers what was opened", async ({ page }) => {
  const writes: string[] = [];
  await mockApi(page, {
    "/api/session": session,
    "/api/records/types": { types: ["advintercompanyjournalentry", "customer", "salesorder"] },
    "/api/records/fields": { type: "salesorder", fields: [{ id: "memo", title: "Memo", type: "string" }], sublists: [] },
    "/api/records/transforms": { targets: [] },
    "/api/records/actions": { actions: [] },
    "/api/records/find": (_request: unknown, url: URL) => {
      writes.push(url.searchParams.get("q") || "");
      return { rows: [{ id: "17489", type: "salesorder", label: "SO640", detail: "124 Quinu LLP" }] };
    },
    "/api/records/latest": { rows: [{ id: "17489", label: "SO640", detail: "124 Quinu LLP" }, { id: "17408", label: "SO639", detail: "" }] },
    "/api/records": order,
  });
  await page.goto("/#/records");
  const rail = page.locator(".split-rail");
  await expect(rail.locator(".tool").nth(0)).toContainText("Customer");
  await expect(rail.locator(".tool").nth(1)).toContainText("Sales order");
  await expect(rail.locator(".tool").nth(2)).toContainText("advintercompanyjournalentry");

  await rail.getByRole("button", { name: /Sales order/ }).click();
  const latest = page.getByRole("table", { name: "Newest Sales order records" });
  await expect(latest.getByRole("button", { name: "SO639" })).toBeVisible();
  await page.screenshot({ path: "e2e/shots/6b-records.png" });
  await latest.getByRole("button", { name: "SO640" }).click();
  await expect(page.locator(".pane-head strong")).toHaveText("Sales order SO640");
  await expect(page.getByText("Rush")).toBeVisible();

  await page.reload();
  const recent = page.getByRole("navigation", { name: "Recent records" });
  await expect(recent.getByRole("button", { name: "Sales order SO640" })).toBeVisible();

  await page.getByLabel("Find a record").fill("quinu");
  const results = page.getByRole("table", { name: "Search results" });
  await expect(results.getByRole("cell", { name: "124 Quinu LLP" })).toBeVisible();
  await expect(results.getByRole("cell", { name: "Sales order" })).toBeVisible();
  expect(writes).toEqual(["quinu"]);
  await results.getByRole("button", { name: "SO640" }).click();
  await expect(page).toHaveURL(/#\/records\?type=salesorder&id=17489/);
  await expect(page.locator(".pane-head strong")).toHaveText("Sales order SO640");
});

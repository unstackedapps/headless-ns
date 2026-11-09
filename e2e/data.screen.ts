import { expect, test } from "@playwright/test";
import { mockApi, session } from "./mock";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const manyTables = Array.from({ length: 1705 }, (_, index) => ({ name: `table${index}`, title: `Table ${String(index).padStart(4, "0")}` }));

test("Query shows a loader for the tables, draws 100 of them, and a loader for a table's columns", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/queries": { queries: [] },
    "/api/suiteql": async (_request: unknown, url: URL) => {
      const type = url.searchParams.get("type");
      if (!type) {
        await wait(800);
        return { tables: manyTables };
      }
      await wait(1000);
      return { type, fields: [{ id: `${type}_col`, title: `${type} column`, type: "string" }] };
    },
  });
  await page.goto("/#/query");
  await expect(page.locator(".split-rail [role=status]")).toBeVisible();
  await expect(page.locator(".split-rail .tool")).toHaveCount(100);
  await expect(page.getByText("Showing 100 of 1,705. Type to narrow the list.")).toBeVisible();
  await page.getByLabel("Filter tables").fill("Table 1704");
  await expect(page.locator(".split-rail .tool")).toHaveCount(1);
  await page.getByLabel("Filter tables").fill("");
  await page.getByRole("button", { name: /Table 0001/ }).click();
  await expect(page.locator(".split-rail [role=status]")).toBeVisible();
  await expect(page.getByRole("button", { name: /table1 column/ })).toBeVisible();
});

test("Records shows a loader for the types and for the fields of the type you pick", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/records/types": async () => {
      await wait(800);
      return { types: ["customer", "salesorder"] };
    },
    "/api/records/fields": async () => {
      await wait(1200);
      return { type: "salesorder", fields: [{ id: "memo", title: "Memo", type: "string" }], sublists: [] };
    },
    "/api/records/transforms": { targets: [] },
  });
  await page.goto("/#/records");
  await expect(page.locator(".split-rail [role=status]")).toBeVisible();
  await page.getByRole("button", { name: "salesorder" }).click();
  await expect(page.getByRole("status", { name: "Loading record" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading record" })).toBeHidden();
});

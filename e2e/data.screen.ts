import { expect, test } from "@playwright/test";
import { mockApi, session } from "./mock";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const manyTables = Array.from({ length: 1705 }, (_, index) => ({ name: `table${index}`, title: `Table ${String(index).padStart(4, "0")}` }));

test("Query shows a loader for the tables, draws 100 of them, and clears old columns when you pick another", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/suiteql": async (_request: unknown, url: URL) => {
      const type = url.searchParams.get("type");
      if (!type) {
        await wait(800);
        return { tables: manyTables };
      }
      if (type === "table1") await wait(1500);
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
  await page.getByRole("button", { name: /Table 0000/ }).click();
  await expect(page.getByText("table0 column")).toBeVisible();
  await page.getByRole("button", { name: /Table 0001/ }).click();
  await expect(page.getByText("table0 column")).toBeHidden();
  await expect(page.locator(".split-main [role=status]")).toBeVisible();
  await expect(page.getByText("table1 column")).toBeVisible();
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

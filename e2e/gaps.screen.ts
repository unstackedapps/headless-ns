import { expect, test, type Page } from "@playwright/test";
import { mockApi, session } from "./mock";

// Whatever sits directly above a table, its search box or its Filters row, leaves the same gap before it.
const cases: [string, string, (page: Page) => Promise<void>, string][] = [
  ["Searches", "/#/searches", async (page) => {
    await page.getByRole("button", { name: /Open orders/ }).click();
    await page.getByRole("table").waitFor();
  }, ".split-main"],
  ["Records", "/#/records", async (page) => {
    await page.getByLabel("Find a record").fill("quinu");
    await page.getByRole("table", { name: "Search results" }).waitFor();
  }, ".finder"],
];

for (const [name, url, ready, pane] of cases) {
  test(`${name}: the row above the table keeps a 10 px gap`, async ({ page }) => {
    await mockApi(page, {
      "/api/session": session,
      "/api/searches": { rows: [{ id: "s1", title: "Open orders", recordType: "Transaction", shared: false }] },
      "/api/searches/run": { columns: ["Number", "Status"], rows: [{ Number: "SO1", Status: "Open" }], total: 1 },
      "/api/records/types": { types: ["salesorder"] },
      "/api/records/find": { rows: [{ id: "17489", type: "salesorder", label: "SO640", detail: "124 Quinu LLP" }] },
    });
    await page.goto(url);
    await ready(page);
    const gap = await page.evaluate((selector) => {
      const table = document.querySelector(`${selector} .table-wrap`)!;
      return table.getBoundingClientRect().top - table.previousElementSibling!.getBoundingClientRect().bottom;
    }, pane);
    expect(gap).toBe(10);
  });
}

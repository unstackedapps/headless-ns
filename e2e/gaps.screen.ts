import { expect, test, type Page } from "@playwright/test";
import { mockApi, session } from "./mock";

// Every search box that sits directly above a table leaves the same gap before it.
const cases: [string, string, (page: Page) => Promise<void>, string][] = [
  ["Searches", "/#/searches", async (page) => {
    await page.getByRole("button", { name: /Open orders/ }).click();
    await page.getByRole("table").waitFor();
  }, ".split-main > .search-field"],
  ["Records", "/#/records", async (page) => {
    await page.getByLabel("Find a record").fill("quinu");
    await page.getByRole("table", { name: "Search results" }).waitFor();
  }, ".finder > .search-field"],
];

for (const [name, url, ready, field] of cases) {
  test(`${name}: the search box keeps a gap above its table`, async ({ page }) => {
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
      const box = document.querySelector(selector)!;
      const table = box.nextElementSibling!.closest(".table-wrap") || box.parentElement!.querySelector(".table-wrap")!;
      return table.getBoundingClientRect().top - box.getBoundingClientRect().bottom;
    }, field);
    expect(gap).toBe(10);
  });
}

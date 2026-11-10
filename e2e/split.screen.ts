import { expect, test, type Page } from "@playwright/test";
import { mockApi, session } from "./mock";

const order = { id: "17489", fields: [{ id: "tranId", value: "SO640" }, { id: "memo", value: "Rush" }], sublists: [] };

const pages: [string, string, (page: Page) => Promise<void>][] = [
  ["Searches", "/#/searches", async (page) => {
    await page.getByRole("button", { name: /Open orders/ }).click();
    await page.getByPlaceholder("Search these rows").waitFor();
  }],
  ["Query", "/#/query", (page) => page.getByRole("button", { name: "Overdue invoices" }).waitFor()],
  ["Records", "/#/records?type=salesorder&id=17489", (page) => page.getByText("Rush").waitFor()],
  ["Workbench", "/#/workbench", (page) => page.getByRole("heading", { name: "ns_getRecord" }).waitFor()],
  ["Files", "/#/files", (page) => page.locator(".split-main .pane-head").waitFor()],
];

for (const [name, url, ready] of pages) {
  test(`${name}: both panes start their first row on the same line and inset`, async ({ page }) => {
    await mockApi(page, {
      "/api/session": session,
      "/api/searches": { rows: [{ id: "s1", title: "Open orders", recordType: "Transaction", shared: false }] },
      "/api/searches/run": { columns: ["Number", "Status"], rows: [{ Number: "SO1", Status: "Open" }], total: 1 },
      "/api/suiteql": { tables: [{ name: "transaction", title: "Transaction" }] },
      "/api/queries": { queries: [] },
      "/api/records/types": { types: ["salesorder"] },
      "/api/records/fields": { type: "salesorder", fields: [{ id: "memo", title: "Memo", type: "string" }], sublists: [] },
      "/api/records/transforms": { targets: [] },
      "/api/records/actions": { actions: [] },
      "/api/records": order,
      "/api/tools": { tools: [{ name: "ns_getRecord", description: "Reads a record", schema: { properties: {} } }] },
      "/api/files": { path: "/", entries: [{ id: "1", kind: "folder", name: "SuiteScripts", path: "/SuiteScripts" }] },
    });
    await page.goto(url);
    await ready(page);
    const rows = await page.evaluate(() => {
      // The side list wraps its search in a div, so step into it; the Files tree starts with a row.
      const first = (pane: Element) => {
        const child = [...pane.children].find((el) => (el as HTMLElement).offsetParent)!;
        return child.matches(".split-rail > div:not(.tree-row)") ? child.firstElementChild! : child;
      };
      const offset = (pane: Element) => {
        const box = first(pane).getBoundingClientRect();
        const frame = pane.getBoundingClientRect();
        return { top: box.top - frame.top, left: box.left - frame.left };
      };
      return { rail: offset(document.querySelector(".split-rail")!), main: offset(document.querySelector(".split-main")!) };
    });
    expect(Math.abs(rows.rail.top - rows.main.top)).toBeLessThanOrEqual(1);
    if (name !== "Files") expect(Math.abs(rows.rail.left - rows.main.left)).toBeLessThanOrEqual(1);
  });
}

import { expect, test } from "@playwright/test";
import { mockApi, session } from "./mock";

// Every list page keeps pills, row links, dates and amounts on one line at 1280 and 1440 px wide,
// with and without the Ask drawer. A table too wide for the space scrolls sideways inside its frame.
const base = { fetchedAt: new Date().toISOString(), tokenExpiresAt: null, source: "NetSuite MCP", hasMore: false, total: 3, page: 0 };
const party = "6 Duis Elementum Industries Industries International Holdings";
const tx = Array.from({ length: 3 }, (_, index) => ({
  id: String(16200 + index),
  number: `SO64${index}`,
  date: "2026-11-08",
  due: "2026-12-08",
  name: party,
  status: "Pending billing/partially fulfilled",
  currency: "US Dollar",
  amount: 1200.5,
  unpaid: 1200.5,
  href: "https://example.com/tx",
}));
const people = [{ id: "1", name: "Jordan Alexandria Montgomery-Whitfield", title: "Senior Accounts Receivable Specialist", subsidiary: "Honeycomb Mfg. International", email: "jordan.montgomery-whitfield@honeycomb-manufacturing.example.com", hireDate: "2021-04-01", salesRep: "No", href: "https://example.com/e" }];
const entities = [{ id: "7", name: party, company: party, subsidiary: "Honeycomb Mfg. International", email: "accounts.payable@duis-elementum-industries.example.com", phone: "+1 (555) 010-2030", href: "https://example.com/c" }];
const items = [{ id: "760", name: "Breville Bambino Plus BES500BSS Espresso Machine Brushed Stainless", displayName: "Breville Bambino Plus BES500BSS Espresso Machine", type: "Inventory", recordType: "inventoryitem", onHand: 12345, available: 12000, href: "https://example.com/i" }];

const pages = ["orders", "quotes", "invoices", "fulfillments", "payments", "returns", "purchaseorders", "receipts", "bills", "billpayments", "customers", "vendors", "items", "people"];

for (const view of pages) {
  for (const width of [1280, 1440]) {
    for (const ask of [false, true]) {
      test(`${view} at ${width} px ${ask ? "with" : "without"} the Ask drawer keeps short values on one line`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await mockApi(page, {
          "/api/session": session,
          "/api/config": { llm: { id: "m", configured: true, model: "gemma" }, models: { connections: [], activeId: "m" } },
          "/api/tx": { ...base, rows: tx, statuses: [{ id: "A", label: "Open" }], hasOpen: true },
          "/api/customers": { ...base, rows: entities },
          "/api/vendors": { ...base, rows: entities },
          "/api/employees": { ...base, rows: people },
          "/api/items": { ...base, rows: items, types: [] },
        });
        await page.goto(`/#/${view}`);
        if (ask) await page.getByRole("button", { name: "Ask", exact: true }).click();
        const wrap = page.locator("main .table-wrap");
        await expect(wrap.getByRole("row")).not.toHaveCount(0);
        await page.waitForTimeout(250);
        const short = wrap.locator(".pill, .row-actions, td.num, td.nowrap");
        expect(await short.count()).toBeGreaterThan(0);
        // A value wrapped when its text boxes sit on more than one line.
        const wrapped = await short.evaluateAll((els) =>
          els
            .filter((el) => {
              const range = document.createRange();
              range.selectNodeContents(el);
              const tops = [...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => rect.top);
              return Math.max(...tops) - Math.min(...tops) > 8;
            })
            .map((el) => el.textContent),
        );
        expect(wrapped, `${view} wraps these values`).toEqual([]);
        // The page itself never scrolls sideways. Only the table frame does.
        const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(pageWidth).toBeLessThanOrEqual(0);
        if (view === "orders" && ask) await page.screenshot({ path: `e2e/shots/fit-orders-${width}.png` });
      });
    }
  }
}

test("each order row has Related, Details and Open links, each with its own label", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/tx": { ...base, rows: tx, statuses: [{ id: "A", label: "Open" }], hasOpen: true },
  });
  await page.goto("/#/orders");
  const actions = page.locator("main .row-actions").first();
  await expect(actions).toHaveText(/Related\s*Details\s*Open/);
  await expect(actions.getByRole("button", { name: "Related records for SO640", exact: true })).toBeVisible();
  await expect(actions.getByRole("link", { name: "Details for SO640", exact: true })).toHaveAttribute("href", /records/);
  await expect(actions.getByRole("link", { name: "Open SO640 in NetSuite", exact: true })).toBeVisible();
});

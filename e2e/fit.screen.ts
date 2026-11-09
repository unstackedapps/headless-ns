import { expect, test } from "@playwright/test";
import { mockApi, session } from "./mock";

// Every list page fits beside the open Ask drawer at 1440 x 900, with long names and amounts.
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
  test(`${view} fits beside the Ask drawer`, async ({ page }) => {
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
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const wrap = page.locator("main .table-wrap");
    await expect(wrap.getByRole("row")).not.toHaveCount(0);
    await page.waitForTimeout(250);
    const { scroll, client } = await wrap.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(scroll, `${view} table is ${scroll - client}px too wide`).toBeLessThanOrEqual(client + 1);
    if (view === "orders") await page.screenshot({ path: "e2e/shots/6b-fit-orders.png" });
  });
}

import { expect, test } from "@playwright/test";
import { emptyList, mockApi, session } from "./mock";

const vendor = { id: "7", name: "Bean Supply", company: "Bean Supply Co.", subsidiary: "", email: "", phone: "", href: "https://example.com/7" };

test("the vendor drawer traps focus, closes on Escape and on a click outside, and keeps the page", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/tx": emptyList,
    "/api/vendors": { fetchedAt: new Date().toISOString(), tokenExpiresAt: null, source: "x", rows: [vendor], hasMore: false, total: 1, page: 0 },
    "/api/vendors/7": {
      vendor,
      balance: [],
      orders: [{ id: "451", number: "PO451", date: "2026-11-01", status: "Pending Receipt", amount: 30, currency: "USD" }],
      bills: [],
    },
  });
  await page.goto("/#/vendors");
  await page.getByRole("button", { name: "Bean Supply" }).click();
  const drawer = page.getByRole("dialog", { name: "Bean Supply" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("table", { name: "Open purchase orders" })).toBeVisible();
  await expect(drawer.getByText("No open bills.")).toBeVisible();
  for (let i = 0; i < 12; i += 1) await page.keyboard.press("Tab");
  expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await drawer.screenshot({ path: "e2e/shots/6b-drawer.png" });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { name: "Vendors" })).toBeVisible();
  await page.getByRole("button", { name: "Bean Supply" }).click();
  await expect(drawer).toBeVisible();
  await page.mouse.click(20, 450);
  await expect(drawer).toBeHidden();
});

test("Related opens over a drawer, and Escape closes only the top one", async ({ page }) => {
  const customer = { id: "341", name: "Acme Supply", company: "Acme", subsidiary: "", email: "", phone: "", href: "https://example.com/341" };
  await mockApi(page, {
    "/api/session": session,
    "/api/customers": { fetchedAt: new Date().toISOString(), tokenExpiresAt: null, source: "x", rows: [customer], hasMore: false, total: 1 },
    "/api/customers/341": { customer, balance: [], orders: [], invoices: [] },
    "/api/related": { nodes: [{ id: "c", label: "Acme Supply", detail: "", focus: true, kind: "customer", recordId: "341" }], edges: [] },
  });
  await page.goto("/#/customers");
  await page.getByRole("button", { name: "Acme Supply" }).click();
  const file = page.getByRole("dialog", { name: "Acme Supply" }).first();
  await file.getByRole("button", { name: "Related" }).click();
  await expect(page.getByText("Nothing else is linked to this record.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Nothing else is linked to this record.")).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

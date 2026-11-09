import { expect, test } from "@playwright/test";
import { mockApi, session } from "./mock";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const customer = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  company: "",
  subsidiary: "Honeycomb Mfg.",
  email: `${name.toLowerCase().replace(/\s+/g, "")}@example.com`,
  phone: "",
  href: `https://example.com/${id}`,
  ...extra,
});

test("a list shows a skeleton first, then rows with blank cells marked, then one empty row for no matches", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/customers": async (_request: unknown, url: URL) => {
      await wait(700);
      const q = url.searchParams.get("q");
      const rows = q ? [] : [customer("1", "Acme Supply", { company: "Acme Supply Co." }), customer("2", "Jane Holt")];
      return { fetchedAt: new Date().toISOString(), tokenExpiresAt: null, source: "NetSuite MCP", rows, hasMore: false, total: rows.length };
    },
  });
  await page.goto("/#/customers");
  await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
  const table = page.getByRole("table", { name: "Customers" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByRole("row", { name: /Jane Holt/ }).getByRole("cell").nth(1)).toHaveText("—");
  await page.screenshot({ path: "e2e/shots/6b-list.png" });
  await page.getByLabel("Search customers").fill("zzz");
  await expect(table.getByRole("cell", { name: "No customers matched." })).toBeVisible();
});

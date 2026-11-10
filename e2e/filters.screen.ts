import { expect, test } from "@playwright/test";
import { mockApi, session } from "./mock";

const runRows = [
  { Date: "1/4/2026", "Document Number": "SO258", Customer: "266 Restaurant Wholesale Inc", Amount: "7185.60", Status: "Pending fulfillment" },
  { Date: "1/16/2026", "Document Number": "SO274", Customer: "266 Restaurant Wholesale Inc", Amount: "8383.20", Status: "Pending fulfillment" },
  { Date: "3/2/2026", "Document Number": "SO301", Customer: "124 Quinu LLP", Amount: "500.00", Status: "Billed" },
  { Date: "11/9/2026", "Document Number": "SO660", Customer: "266 Restaurant Wholesale Inc", Amount: "1870.00", Status: "Billed" },
];

async function openSearch(page: import("@playwright/test").Page) {
  await mockApi(page, {
    "/api/session": session,
    "/api/searches": { rows: [{ id: "s1", title: "Sales Orders to Fulfill", recordType: "Transaction", shared: false }] },
    "/api/searches/run": { columns: Object.keys(runRows[0]), rows: runRows, total: runRows.length },
  });
  await page.goto("/#/searches");
  await page.getByRole("button", { name: /Sales Orders to Fulfill/ }).click();
  const table = page.getByRole("table", { name: "Sales Orders to Fulfill" });
  await expect(table.locator("tbody tr")).toHaveCount(4);
  return table;
}

test("the Filters panel picks a control per column and filters the rows", async ({ page }) => {
  const table = await openSearch(page);
  await expect(page.getByPlaceholder("Filter", { exact: true })).toHaveCount(0);
  const button = page.getByRole("button", { name: "Filters", exact: true });

  await button.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Filters" });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Date from")).toHaveAttribute("type", "date");
  await expect(panel.getByLabel("Amount minimum")).toHaveAttribute("type", "number");
  await expect(panel.getByLabel("Document Number contains")).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: "Billed" })).toBeVisible();
  await expect(panel.getByText("Filters the 4 rows shown.")).toBeVisible();
  const overflow = await panel.evaluate((el) => {
    const edge = el.getBoundingClientRect().right;
    return [...el.querySelectorAll("input")].filter((input) => input.getBoundingClientRect().right > edge).length;
  });
  expect(overflow).toBe(0);

  await panel.getByRole("checkbox", { name: "266 Restaurant Wholesale Inc" }).check();
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await panel.getByRole("checkbox", { name: "Pending fulfillment" }).check();
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await panel.getByLabel("Date from").fill("2026-01-10");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.getByText("SO274")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  const active = page.getByRole("button", { name: "Filters, 3 on" });
  await expect(active).toBeFocused();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
});

test("amount ranges, Clear all and the no-match row", async ({ page }) => {
  const table = await openSearch(page);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Filters" });
  await panel.getByLabel("Amount minimum").fill("1000");
  await panel.getByLabel("Amount maximum").fill("8000");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await panel.getByLabel("Amount minimum").fill("9000");
  await expect(table.getByText("No rows match the filters.")).toBeVisible();
  await panel.getByRole("button", { name: "Clear all" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel).toBeHidden();
});

test("list pages and Query results get the Filters button too", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/tx": {
      fetchedAt: new Date().toISOString(),
      rows: [
        { id: "1", number: "QUO1", date: "2026-11-08", name: "124 Quinu LLP", status: "Open", currency: "USD", amount: 20 },
        { id: "2", number: "QUO2", date: "2026-11-09", name: "266 Restaurant Wholesale Inc", status: "Open", currency: "USD", amount: 1870 },
      ],
      hasMore: false,
      total: 2,
      page: 0,
      statuses: [{ id: "A", label: "Open" }],
      hasOpen: true,
    },
    "/api/suiteql": { tables: [] },
    "/api/queries": { queries: [] },
    "/api/query": { columns: ["id", "entityid"], rows: [{ id: 1, entityid: "Quinu" }, { id: 2, entityid: "Restaurant" }], page: 0, total: 2, hasMore: false },
  });
  await page.goto("/#/quotes");
  await expect(page.getByRole("link", { name: "QUO2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("dialog", { name: "Filters" }).getByLabel("Customer contains").fill("restaurant");
  await expect(page.getByRole("link", { name: "QUO1", exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "QUO2", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/#/query");
  await page.getByLabel("SQL").fill("SELECT id, entityid FROM customer");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("table", { name: "Query results" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
});

// The Filters button joins the row that already holds the search box; it never gets a row of its own.
async function sameRow(page: import("@playwright/test").Page, search: import("@playwright/test").Locator) {
  const button = page.getByRole("button", { name: /^Filters/ });
  const [a, b] = [(await search.boundingBox())!, (await button.boundingBox())!];
  expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))).toBeLessThanOrEqual(2);
  expect(b.x).toBeGreaterThan(a.x + a.width);
  const lonely = await page.locator(".table-tools").evaluateAll((rows) => rows.filter((row) => !row.querySelector(".search-field")).length);
  expect(lonely).toBe(0);
}

test("the Filters button sits next to the search box on every page that has one", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/searches": { rows: [{ id: "s1", title: "Sales Orders to Fulfill", recordType: "Transaction", shared: false }] },
    "/api/searches/run": { columns: Object.keys(runRows[0]), rows: runRows, total: runRows.length },
    "/api/tx": {
      fetchedAt: new Date().toISOString(),
      rows: [{ id: "1", number: "BILL1", date: "2026-11-08", name: "Acme Supply", status: "Open", currency: "USD", amount: 20 }],
      hasMore: false,
      total: 1,
      page: 0,
      statuses: [{ id: "A", label: "Open" }],
      hasOpen: true,
    },
    "/api/records/types": { types: ["salesorder"] },
    "/api/records/find": { rows: [{ id: "17489", type: "salesorder", label: "SO640", detail: "124 Quinu LLP" }] },
    "/api/files": { path: "/", entries: [{ id: "1", kind: "folder", name: "SuiteScripts", path: "/SuiteScripts" }] },
  });
  await page.goto("/#/searches");
  await page.getByRole("button", { name: /Sales Orders to Fulfill/ }).click();
  await sameRow(page, page.getByPlaceholder("Search these rows"));

  await page.goto("/#/bills");
  await expect(page.getByRole("link", { name: "BILL1", exact: true })).toBeVisible();
  await sameRow(page, page.getByLabel("Search bills"));

  await page.goto("/#/records");
  await page.getByLabel("Find a record").fill("quinu");
  await expect(page.getByRole("table", { name: "Search results" })).toBeVisible();
  await sameRow(page, page.getByLabel("Find a record"));

  await page.goto("/#/files");
  await expect(page.getByRole("table")).toBeVisible();
  await sameRow(page, page.getByLabel("Search file names"));
});

test("a table with no toolbar puts the Filters button in its header row", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/records/types": { types: ["salesorder"] },
    "/api/records/fields": { type: "salesorder", fields: [], sublists: [] },
    "/api/records/latest": { rows: [{ id: "17489", label: "SO640", detail: "124 Quinu LLP" }, { id: "17408", label: "SO639", detail: "8 Ntags" }] },
  });
  await page.goto("/#/records?type=salesorder");
  const table = page.getByRole("table", { name: "Newest Sales order records" });
  await expect(table).toBeVisible();
  const button = table.locator("thead").getByRole("button", { name: "Filters", exact: true });
  await expect(button).toBeVisible();
  const lonely = await page.locator(".table-tools").evaluateAll((rows) => rows.filter((row) => !row.querySelector(".search-field")).length);
  expect(lonely).toBe(0);
  await button.click();
  await page.getByRole("dialog", { name: "Filters" }).getByLabel("Detail contains").fill("quinu");
  await expect(table.locator("tbody tr")).toHaveCount(1);
});

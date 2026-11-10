import { expect, test } from "@playwright/test";
import { emptyList, mockApi, session } from "./mock";

test.beforeEach(async ({ page }) => {
  await mockApi(page, { "/api/session": session, "/api/tx": emptyList, "/api/searches": { searches: [] }, "/api/suiteql": { tables: [] } });
});

test("the rail pins Overview and Settings, folds its groups, and fits a 900 px window with no scrollbar", async ({ page }) => {
  await page.goto("/#/payments");
  const nav = page.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
  for (const group of ["Sales", "Purchasing", "Company", "Data", "Tools"]) await expect(nav.getByText(group, { exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Payments", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Query" })).toBeHidden();
  const links = nav.locator(".nav-links");
  expect(await links.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  const sales = await nav.locator("details", { hasText: "Sales" }).locator("a").allInnerTexts();
  expect(sales.indexOf("Quotes")).toBeLessThan(sales.indexOf("Orders"));
  await nav.screenshot({ path: "e2e/shots/6b-rail.png" });

  await nav.getByText("Data", { exact: true }).click();
  await expect(nav.getByRole("link", { name: "Query" })).toBeVisible();
  await page.reload();
  await expect(nav.getByRole("link", { name: "Query" })).toBeVisible();
  await nav.getByText("Sales", { exact: true }).click();
  await expect(nav.getByRole("link", { name: "Payments", exact: true })).toBeHidden();
});

test("the header names the app and says it works over MCP", async ({ page }) => {
  await page.goto("/#/payments");
  await expect(page.locator(".brand")).toHaveText("headless-nsNetSuite over MCP");
});

test("each page's kicker is its menu group", async ({ page }) => {
  await page.goto("/#/payments");
  await expect(page.locator(".page-head .kicker")).toHaveText("Sales");
  await page.goto("/#/query");
  await expect(page.locator(".page-head .kicker")).toHaveText("Data");
  await page.goto("/#/searches");
  await expect(page.locator(".page-head .kicker")).toHaveText("Data");
});

test("opening a page in a folded group opens that group", async ({ page }) => {
  await page.goto("/#/payments");
  const nav = page.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("link", { name: "Searches" })).toBeHidden();
  await page.goto("/#/searches");
  await expect(nav.getByRole("link", { name: "Searches" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Searches" })).toHaveAttribute("aria-current", "page");
});

test("the icon-only rail lists every icon, with Settings still at the bottom", async ({ page }) => {
  await page.goto("/#/payments");
  const nav = page.getByRole("navigation", { name: "Sections" });
  await nav.getByRole("button", { name: "Hide menu" }).click();
  await expect(nav.locator("a")).toHaveCount(23);
  await expect(nav.locator(".nav-bottom a")).toHaveAttribute("aria-label", "Settings");
});

test("the icon-only rail lines every icon up in one column, with groups open or folded", async ({ page }) => {
  await page.goto("/#/payments");
  const nav = page.getByRole("navigation", { name: "Sections" });
  const centers = () =>
    nav.evaluate((el) =>
      [...el.querySelectorAll("a, button")]
        .filter((item) => (item as HTMLElement).offsetParent && item.getBoundingClientRect().width > 0)
        .map((item) => {
          const box = (item.querySelector("svg") || item).getBoundingClientRect();
          return box.left + box.width / 2;
        }),
    );
  for (const folded of [false, true]) {
    if (folded) await nav.getByText("Sales", { exact: true }).click();
    await nav.getByRole("button", { name: "Hide menu" }).click();
    const xs = await centers();
    expect(xs.length).toBe(24);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(1);
    await nav.getByRole("button", { name: "Show menu" }).click();
  }
});

test("Arrange opens every group and moves an item only inside its group", async ({ page }) => {
  await page.goto("/#/payments");
  const nav = page.getByRole("navigation", { name: "Sections" });
  await nav.getByRole("button", { name: "Arrange" }).click();
  await expect(nav.getByRole("link", { name: "Trace" })).toBeVisible();
  await nav.getByRole("button", { name: "Move Quotes down" }).click();
  const sales = await nav.locator("details", { hasText: "Sales" }).locator("a").allInnerTexts();
  expect(sales.indexOf("Orders")).toBeLessThan(sales.indexOf("Quotes"));
  await nav.getByRole("button", { name: "Done" }).click();
});

test("at phone width the menu links get their own row, each at least 32 px wide and reachable by scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/#/payments");
  const nav = page.getByRole("navigation", { name: "Sections" });
  const row = nav.locator(".nav-links");
  await expect(row.getByRole("link", { name: "Payments", exact: true })).toBeVisible();
  expect((await row.boundingBox())!.width).toBeGreaterThanOrEqual(300);
  const links = nav.locator("a");
  for (let i = 0; i < (await links.count()); i++) {
    const link = links.nth(i);
    await link.scrollIntoViewIfNeeded();
    const box = (await link.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
});

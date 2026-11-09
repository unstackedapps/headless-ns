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

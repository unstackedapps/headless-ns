import { expect, test } from "@playwright/test";
import { signIn } from "./session";

// Read-only tour of the Phase 6b screens against the live account. Ask and the command line
// get questions that only read. Screenshots go to e2e/shots/6b-live-*.png, and the README
// picture, the Orders list at 1440 x 900 with Ask closed, to docs/orders.png.
test("tour the polished screens", async ({ page, context }) => {
  test.setTimeout(10 * 60_000);
  await signIn(context);
  const shot = (name: string) => page.screenshot({ path: `e2e/shots/6b-live-${name}.png` });

  await page.goto("/#/orders");
  const orders = page.getByRole("table", { name: "Orders" });
  await expect(orders.getByRole("row").nth(1)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("navigation", { name: "Sections" }).screenshot({ path: "e2e/shots/6b-live-rail.png" });
  await shot("list");
  await page.screenshot({ path: "docs/orders.png" });

  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "Ask" });
  await drawer.getByLabel("Question").fill("How many open sales orders are there?");
  await drawer.getByLabel("Question").press("Enter");
  await expect(drawer.getByText("Looking that up.")).toBeHidden({ timeout: 300_000 });
  await expect(drawer.locator(".bubble:not(.user)").last()).toContainText(/\d/);
  // With Ask open, a wide list scrolls sideways inside its frame. The page itself does not.
  for (const view of ["orders", "customers", "bills"]) {
    await page.goto(`/#/${view}`);
    const wrap = page.locator("main .table-wrap");
    await expect(wrap.getByRole("row").nth(1)).toBeVisible({ timeout: 60_000 });
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(pageWidth, `${view} page scrolls sideways`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `e2e/shots/6b-live-fit-${view}.png` });
  }
  await drawer.getByRole("button", { name: "Close" }).click();

  await page.goto("/#/records");
  await page.getByLabel("Find a record").fill("quinu");
  await expect(page.getByRole("table", { name: "Search results" }).getByRole("row").nth(1)).toBeVisible({ timeout: 60_000 });
  await shot("records-search");
  await page.getByLabel("Find a record").fill("");
  await page.locator(".split-rail").getByRole("button", { name: /^Sales order/ }).click();
  await expect(page.getByRole("table", { name: "Newest Sales order records" }).getByRole("row").nth(1)).toBeVisible({ timeout: 60_000 });
  await shot("records");

  await page.goto("/#/query");
  await page.getByRole("button", { name: "Open sales orders" }).click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("table", { name: "Query results" }).getByRole("row").nth(1)).toBeVisible({ timeout: 60_000 });
  await shot("query");

  await page.getByRole("button", { name: "Command line" }).click();
  const command = page.getByLabel("Command", { exact: true });
  await command.fill("ask how many active customers are there?");
  await command.press("Enter");
  const cli = page.getByRole("region", { name: "Command line" });
  await expect(cli.getByRole("status")).toContainText(/Thinking \d+s/);
  await cli.screenshot({ path: "e2e/shots/6b-live-cli-thinking.png" });
  await expect(cli.getByText(/Done in \d+s/)).toBeVisible({ timeout: 300_000 });
  await cli.screenshot({ path: "e2e/shots/6b-live-cli.png" });
});

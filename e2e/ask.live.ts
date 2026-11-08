import { expect, test, type Locator } from "@playwright/test";
import { signIn } from "./session";

// Writes to NetSuite through Ask: a quote, a sales order and a fulfillment, each confirmed with Run.
// Memo "headless-ns ask test". Screenshots of each write summary go to e2e/shots/ask-*.png.
const REQUEST =
  "Create a quote for customer id 341 at location id 2 with 2 units of item id 248 at rate 10, memo \"headless-ns ask test\". " +
  "After it is created, turn that quote into a sales order, then fulfill the sales order as shipped.";

async function settle(drawer: Locator) {
  await expect(drawer.getByText("Looking that up.")).toBeHidden({ timeout: 300_000 });
}

test("Ask creates a quote, a sales order and a fulfillment", async ({ page, context }) => {
  test.setTimeout(20 * 60_000);
  await signIn(context);
  await page.goto("/#/ask");
  const drawer = page.getByRole("complementary", { name: "Ask" });
  await drawer.getByLabel("Question").fill(REQUEST);
  await drawer.getByLabel("Question").press("Enter");
  await expect(drawer.getByText("Looking that up.")).toBeVisible();
  await settle(drawer);

  const titles: string[] = [];
  const run = drawer.getByRole("button", { name: "Run on NetSuite" });
  for (let write = 1; write <= 6 && (await run.isVisible()); write += 1) {
    const title = await drawer.locator("section.panel strong").first().innerText();
    titles.push(title);
    console.log(`write ${write}: ${title}`);
    await drawer.locator("section.panel").screenshot({ path: `e2e/shots/ask-${write}.png` });
    await run.click();
    await settle(drawer);
  }
  const answer = await drawer.locator(".bubble").last().innerText();
  console.log(`answer: ${answer}`);
  await page.screenshot({ path: "e2e/shots/ask-done.png", fullPage: true });
  expect(titles.some((title) => /^Create quote/.test(title))).toBe(true);
  expect(titles.some((title) => /into a sales order/.test(title))).toBe(true);
  expect(titles.some((title) => /into a fulfillment/.test(title))).toBe(true);
});

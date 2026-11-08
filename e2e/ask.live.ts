import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./session";

// Writes to NetSuite through Ask, each write confirmed with Run. Memo "headless-ns ask test".
// Screenshots of each write summary go to e2e/shots/<prefix>-*.png.
const MEMO = 'memo "headless-ns ask test"';

// Waits for the spinner to show (React may not have drawn it yet right after a click), then to go.
async function settle(drawer: Locator) {
  await expect(drawer.getByText("Looking that up."))
    .toBeVisible({ timeout: 5_000 })
    .catch(() => undefined);
  await expect(drawer.getByText("Looking that up.")).toBeHidden({ timeout: 300_000 });
}

type Write = { title: string; details: string[] };

// Sends one request and clicks Run on every write Ask proposes, up to `limit`, or Cancel when `run` says no.
async function askAndRun(page: Page, request: string, prefix: string, run: (write: Write) => boolean = () => true, limit = 6) {
  await page.goto("/#/ask");
  const drawer = page.getByRole("complementary", { name: "Ask" });
  await drawer.getByLabel("Question").fill(request);
  await drawer.getByLabel("Question").press("Enter");
  await expect(drawer.getByText("Looking that up.")).toBeVisible();
  await settle(drawer);

  const writes: Write[] = [];
  const button = drawer.getByRole("button", { name: "Run on NetSuite" });
  for (let at = 1; at <= limit && (await button.isVisible()); at += 1) {
    const panel = drawer.locator("section.panel");
    const write = { title: await panel.locator("strong").first().innerText(), details: await panel.locator("ul.steps li").allInnerTexts() };
    writes.push(write);
    console.log(`write ${at}: ${write.title} | ${write.details.join(" | ")}`);
    await panel.screenshot({ path: `e2e/shots/${prefix}-${at}.png` });
    if (!run(write)) {
      await drawer.getByRole("button", { name: "Cancel" }).click();
      break;
    }
    await button.click();
    await settle(drawer);
  }
  const bubbles = await drawer.locator(".bubble").allInnerTexts();
  for (const bubble of bubbles) console.log(`bubble: ${bubble.replace(/\s+/g, " ").slice(0, 400)}`);
  const answer = (await drawer.locator(".bubble:not(.user)").allInnerTexts()).at(-1) ?? "";
  await page.screenshot({ path: `e2e/shots/${prefix}-done.png`, fullPage: true });
  return { writes, answer };
}

test("Ask creates a quote, a sales order and a fulfillment", async ({ page, context }) => {
  test.setTimeout(20 * 60_000);
  await signIn(context);
  const { writes } = await askAndRun(
    page,
    `Create a quote for customer id 341 at location id 2 with 2 units of item id 248 at rate 10, ${MEMO}. ` +
      "After it is created, turn that quote into a sales order, then fulfill the sales order as shipped.",
    "ask",
  );
  const titles = writes.map((write) => write.title);
  expect(titles.some((title) => /^Create quote/.test(title))).toBe(true);
  expect(titles.some((title) => /into a sales order/.test(title))).toBe(true);
  expect(titles.some((title) => /into a fulfillment/.test(title))).toBe(true);
});

test("Ask fulfills a serial item with a serial number in stock", async ({ page, context }) => {
  test.setTimeout(20 * 60_000);
  await signIn(context);
  const { writes } = await askAndRun(
    page,
    `Create a quote for customer id 341 at location id 2 with 1 unit of item id 761 at rate 50, ${MEMO}. ` +
      "After it is created, turn that quote into a sales order, then fulfill the sales order as shipped. The item is serialized, so pick a serial number in stock.",
    "ask-serial",
  );
  const fulfill = writes.find((write) => /into a fulfillment/.test(write.title));
  expect(fulfill, "Ask proposed a fulfillment").toBeTruthy();
  // The detail names the serial number, such as "Order line 1: 1 (ORALB-...)".
  expect(fulfill?.details.some((detail) => /^Order line \d+: 1 \([^#?]/.test(detail))).toBe(true);
});

test("Ask does not fulfill an order whose location has no stock", async ({ page, context }) => {
  test.setTimeout(20 * 60_000);
  await signIn(context);
  // Item 761 has stock only at San Francisco (location 2). Boston is location 1.
  const { writes, answer } = await askAndRun(
    page,
    `Create a sales order for customer id 341 at location id 1 with 1 unit of item id 761 at rate 50, ${MEMO}. After it is created, fulfill it as shipped.`,
    "ask-nostock",
  );
  expect(writes.some((write) => /^Create sales order/.test(write.title))).toBe(true);
  expect(writes.some((write) => /into a fulfillment/.test(write.title))).toBe(false);
  expect(answer).toMatch(/San Francisco|available|stock/i);
});

test("Ask shows a British pound customer's total in pounds", async ({ page, context }) => {
  test.setTimeout(10 * 60_000);
  await signIn(context);
  // Customer 1194 "388 United Kingdom (buys from US)" uses British pound. The quote is cancelled, nothing is written.
  const { writes } = await askAndRun(page, `Create a quote for customer id 1194 at location id 2 with 2 units of item id 248 at rate 10, ${MEMO}.`, "ask-gbp", () => false, 1);
  expect(writes[0]?.title).toMatch(/^Create quote for 388 United Kingdom.*total 20\.00 British pound$/);
});

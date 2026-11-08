import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session";

// Writes to NetSuite: one quote, sales order, fulfillment, invoice and payment.
// Every record gets the memo "headless-ns workflow test". Screenshots go to e2e/shots/o2c-*.png.
const MEMO = "headless-ns workflow test";

async function pick(page: Page, label: string, text: string, option: string | RegExp) {
  const box = page.getByRole("combobox", { name: label });
  await box.click();
  await box.fill(text);
  await page.getByRole("option", { name: option }).first().click();
}

async function runStep(page: Page, step: string, button: string, kicker: string) {
  await page.getByRole("button", { name: step, exact: true }).click();
  const memo = page.getByLabel("Memo");
  if (await memo.count()) await memo.fill(MEMO);
  await page.getByLabel(/I mean to run this/).check();
  await page.getByRole("button", { name: button }).click();
  await expect(page.locator(".kicker", { hasText: kicker })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("heading", { name: "Next steps" }).waitFor();
}

test("quote to paid invoice through the screens", async ({ page, context }) => {
  await signIn(context);
  const shot = (name: string) => page.screenshot({ path: `e2e/shots/o2c-${name}.png`, fullPage: true });

  await page.goto("/#/quotes");
  await page.getByRole("link", { name: "New quote" }).click();
  await pick(page, "Customer", "quinu", /Quinu/);
  await pick(page, "Location", "san", "San Francisco");
  await page.getByLabel("Memo").fill(MEMO);
  await pick(page, "Item", "spc002", /SPC002/);
  await expect(page.getByRole("spinbutton", { name: "Quantity" })).toHaveValue("1");
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("2");
  await page.getByRole("spinbutton", { name: "Rate" }).fill("10");
  await page.getByLabel(/I mean to run this/).check();
  await shot("1-new-quote");
  await page.getByRole("button", { name: "Create quote" }).click();
  await expect(page.getByRole("heading", { name: /^QUO\d+/ })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("heading", { name: "Next steps" }).waitFor();
  await shot("2-quote");

  await runStep(page, "Convert to sales order", "Create sales order", "Sales order");
  await shot("3-sales-order");

  await page.getByRole("button", { name: "Fulfill", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Fulfillment status" })).toContainText("Shipped");
  await page.getByLabel("Memo").fill(MEMO);
  await page.getByLabel(/I mean to run this/).check();
  await shot("4-fulfill-form");
  await page.getByRole("button", { name: "Create fulfillment" }).click();
  await expect(page.locator(".kicker", { hasText: "Fulfillment" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("heading", { name: "Lines" }).waitFor();
  await shot("5-fulfillment");

  await page.getByRole("link", { name: /^SO\d+/ }).click();
  await expect(page.getByRole("button", { name: "Bill", exact: true })).toBeVisible();
  await runStep(page, "Bill", "Create invoice", "Invoice");
  await shot("6-invoice");

  await page.getByRole("button", { name: "Receive payment" }).click();
  await shot("7-payment-form");
  await page.getByLabel("Memo").fill(MEMO);
  await page.getByLabel(/I mean to run this/).check();
  await page.getByRole("button", { name: "Create customer payment" }).click();
  await expect(page.locator(".kicker", { hasText: "Customer payment" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("heading", { name: "Lines" }).waitFor();
  await shot("8-payment");

  await page.getByRole("link", { name: /^INV\d+/ }).click();
  await expect(page.locator(".kicker", { hasText: "Invoice" })).toBeVisible();
  await expect(page.locator(".page-tools .pill", { hasText: "Paid In Full" })).toBeVisible();
  await shot("9-invoice-paid");
});

import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session";

// Writes to NetSuite (td3138390), memo "headless-ns phase4 test". Screenshots go to e2e/shots/gaps-*.png.
// 1. A lot item PO, received 3 of 5 into two new lots, billed for the 3 received.
// 2. That bill paid in part, together with part of another open bill of the same vendor.
// 3. A sales order for a lot item, fulfilled from two lots.
const MEMO = "headless-ns phase4 test";
const RUN = Date.now().toString(36).toUpperCase();

async function pick(page: Page, label: string, text: string, option: string | RegExp) {
  const box = page.getByRole("combobox", { name: label });
  await box.click();
  await box.fill(text);
  await page.getByRole("option", { name: option }).first().click();
}

async function landed(page: Page, kicker: string) {
  await expect(page.locator(".kicker", { hasText: kicker })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("heading", { name: "Next steps" }).waitFor();
}

async function submit(page: Page, button: string, kicker: string) {
  await page.getByLabel("Memo").fill(MEMO);
  await page.getByLabel(/I mean to run this/).check();
  await page.getByRole("button", { name: button }).click();
  await landed(page, kicker);
}

test("lot receipt, bill for the received quantity and a partial payment", async ({ page, context }) => {
  await signIn(context);
  const shot = (name: string) => page.screenshot({ path: `e2e/shots/gaps-${name}.png`, fullPage: true });

  await page.goto("/#/transaction?type=purchaseorder&new=1");
  await pick(page, "Vendor", "core4", "Core4Solutions");
  await pick(page, "Location", "san", "San Francisco");
  await page.getByLabel("Memo").fill(MEMO);
  await pick(page, "Item", "gar002l", /GAR002L/);
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("5");
  await page.getByRole("spinbutton", { name: "Rate" }).fill("2");
  await page.getByLabel(/I mean to run this/).check();
  await page.getByRole("button", { name: "Create purchase order" }).click();
  await landed(page, "Purchase order");

  await page.getByRole("button", { name: "Receive", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Quantity", exact: true }).fill("3");
  await page.getByRole("textbox", { name: "Lot 1 for line 1" }).fill(`HNS-${RUN}-A`);
  await page.getByRole("spinbutton", { name: "Lot 1 quantity for line 1" }).fill("2");
  await page.getByRole("button", { name: "Add another lot" }).click();
  await page.getByRole("textbox", { name: "Lot 2 for line 1" }).fill(`HNS-${RUN}-B`);
  await expect(page.getByText("Lots: 3 of 3 entered")).toBeVisible();
  await shot("1-receive-lots");
  await submit(page, "Create item receipt", "Item receipt");
  await shot("2-receipt");

  await page.getByRole("link", { name: /^PO\d+/ }).click();
  await landed(page, "Purchase order");
  await page.getByRole("button", { name: "Bill", exact: true }).click();
  await expect(page.getByText(/Line 1: .*GAR002L.* \(3 received, 0 billed\)/)).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Quantity" })).toHaveValue("3");
  await shot("3-bill-form");
  await submit(page, "Create bill", "Bill");
  await expect(page.getByText("6.00 US Dollar").first()).toBeVisible();
  await shot("4-bill");

  await page.getByRole("button", { name: "Pay bill" }).click();
  const own = page.getByRole("spinbutton", { name: /^Amount for Bill \d+$/ }).first();
  await expect(own).toHaveValue("6");
  await own.fill("4");
  const other = page.locator(".ship-line").nth(1);
  await other.getByRole("checkbox").check();
  await other.getByRole("spinbutton").fill("1");
  await expect(page.getByText("Pays 5.00 US Dollar.")).toBeVisible();
  await pick(page, "Account", "checking", /US Checking/);
  await shot("5-pay-form");
  await submit(page, "Create bill payment", "Bill payment");
  await shot("6-bill-payment");

  await page.getByRole("row", { name: /Made from .* Bill / }).first().getByRole("link").click();
  await landed(page, "Bill");
  await expect(page.locator("dd", { hasText: "2.00 US Dollar" })).toBeVisible();
  await shot("7-bill-part-paid");
});

test("a lot item ships from two lots", async ({ page, context }) => {
  await signIn(context);
  const shot = (name: string) => page.screenshot({ path: `e2e/shots/gaps-${name}.png`, fullPage: true });

  await page.goto("/#/transaction?type=salesorder&new=1");
  await pick(page, "Customer", "quinu", "124 Quinu LLP");
  await pick(page, "Location", "san", "San Francisco");
  await page.getByLabel("Memo").fill(MEMO);
  await pick(page, "Item", "stumptown", /Stumptown/);
  await page.getByRole("spinbutton", { name: "Quantity", exact: true }).fill("3");
  await page.getByRole("spinbutton", { name: "Rate" }).fill("10");
  await page.getByLabel(/I mean to run this/).check();
  await page.getByRole("button", { name: "Create sales order" }).click();
  await landed(page, "Sales order");

  await page.getByRole("button", { name: "Fulfill", exact: true }).click();
  await page.getByRole("combobox", { name: "Lot 1 for line 1" }).click();
  await page.getByRole("option", { name: /LOT-DEMO-A/ }).click();
  await page.getByRole("spinbutton", { name: "Lot 1 quantity for line 1" }).fill("2");
  await page.getByRole("button", { name: "Add another lot" }).click();
  await page.getByRole("combobox", { name: "Lot 2 for line 1" }).click();
  await page.getByRole("option", { name: /LOT-DEMO-B/ }).click();
  await expect(page.getByText("Lots: 3 of 3 picked")).toBeVisible();
  await shot("8-fulfill-lots");
  await submit(page, "Create fulfillment", "Fulfillment");
  await shot("9-fulfillment");
});

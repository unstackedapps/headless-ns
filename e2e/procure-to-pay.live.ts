import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session";
import { approve, landed, pick, recordNumber, submit as submitWith } from "./live";

// Writes to NetSuite: one purchase order, receipt, vendor bill and bill payment.
// Every record gets the memo "headless-ns workflow test". Screenshots go to e2e/shots/p2p-*.png.
const MEMO = "headless-ns workflow test";
const submit = (page: Page, button: string, kicker: string) => submitWith(page, MEMO, button, kicker);

test("purchase order to paid bill through the screens", async ({ page, context }) => {
  await signIn(context);
  const shot = (name: string) => page.screenshot({ path: `e2e/shots/p2p-${name}.png`, fullPage: true });

  await page.goto("/#/vendors");
  await page.getByRole("button", { name: "Core4Solutions" }).click();
  await page.getByRole("dialog", { name: "Core4Solutions" }).getByRole("heading", { name: "Core4Solutions" }).waitFor();
  await page.getByText("Open purchase orders").waitFor();
  await shot("1-vendor");
  await page.getByRole("dialog").getByRole("link", { name: "New purchase order" }).click();

  await pick(page, "Vendor", "core4", "Core4Solutions");
  await pick(page, "Location", "san", "San Francisco");
  await page.getByLabel("Memo").fill(MEMO);
  await pick(page, "Item", "kap001", /KAP001/);
  await expect(page.getByRole("spinbutton", { name: "Rate" })).toHaveValue("2.1");
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("2");
  await page.getByLabel(/I mean to run this/).check();
  await shot("2-new-po");
  await page.getByRole("button", { name: "Create purchase order" }).click();
  await landed(page, "Purchase order");
  // Approval routing is on, so the PO waits for approval before it can be received.
  await approve(page, "Pending Receipt");
  console.log(`purchase order: ${await recordNumber(page)}`);
  await shot("3-po");

  await page.getByRole("button", { name: "Receive", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Quantity" })).toHaveValue("2");
  await shot("4-receive-form");
  await submit(page, "Create receipt", "Receipt");
  console.log(`receipt: ${await recordNumber(page)}`);
  await shot("5-receipt");

  await page.getByRole("link", { name: /^PO\d+/ }).click();
  await landed(page, "Purchase order");
  await expect(page.locator(".page-tools .pill", { hasText: "Pending Bill" })).toBeVisible();
  await page.getByRole("button", { name: "Bill", exact: true }).click();
  await submit(page, "Create bill", "Bill");
  await approve(page, "Open");
  console.log(`bill: ${await recordNumber(page)}`);
  await shot("6-bill");

  await page.getByRole("button", { name: "Pay bill" }).click();
  await pick(page, "Account", "checking", /US Checking/);
  await shot("7-pay-form");
  await submit(page, "Create bill payment", "Bill payment");
  console.log(`bill payment: ${await recordNumber(page)}`);
  await shot("8-bill-payment");

  await page.getByRole("row", { name: /Made from .* Bill / }).getByRole("link").click();
  await landed(page, "Bill");
  await expect(page.locator(".page-tools .pill", { hasText: "Paid In Full" })).toBeVisible();
  await shot("9-bill-paid");
});

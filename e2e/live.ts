import { expect, type Page } from "@playwright/test";

// Shared steps for the live tests, which write to NetSuite through the screens.

export async function pick(page: Page, label: string, text: string, option: string | RegExp) {
  const box = page.getByRole("combobox", { name: label });
  await box.click();
  await box.fill(text);
  await page.getByRole("option", { name: option }).first().click();
}

// Waits for a record page whose kicker names its type.
export async function landed(page: Page, kicker: string) {
  await expect(page.locator(".kicker", { hasText: kicker })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("heading", { name: "Next steps" }).waitFor();
}

// Fills the memo when the form has one, confirms, clicks `button` and waits for the new record.
export async function submit(page: Page, memo: string, button: string, kicker: string) {
  const field = page.getByLabel("Memo");
  if (await field.count()) await field.fill(memo);
  await page.getByLabel(/I mean to run this/).check();
  await page.getByRole("button", { name: button }).click();
  await landed(page, kicker);
}

// Opens a step's form, then submits it.
export async function formStep(page: Page, memo: string, step: string, button: string, kicker: string) {
  await page.getByRole("button", { name: step, exact: true }).click();
  await submit(page, memo, button, kicker);
}

// Runs a step with no form fields (Approve, Reject) and waits for the record to reach `status`.
export async function runStep(page: Page, step: string, status: string) {
  await page.getByRole("button", { name: step, exact: true }).click();
  await page.getByLabel(/I mean to run this/).check();
  await page.locator(".step-form").getByRole("button", { name: step }).click();
  await expect(page.getByText(`${step} is done.`)).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".page-tools .pill", { hasText: status })).toBeVisible({ timeout: 60_000 });
}

// Purchase orders and bills wait for approval in td3138390 (workflow "headless-ns approval - PO and Bill").
export async function approve(page: Page, status: string) {
  await runStep(page, "Approve", status);
}

// The record number in the page title, such as "PO458" or "Bill 426".
export async function recordNumber(page: Page) {
  return (await page.locator(".page-head h1").innerText()).trim();
}

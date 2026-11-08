import { test } from "@playwright/test";
import { signIn } from "./session";

// Read-only tour: opens screens and saves screenshots to e2e/shots. Writes nothing.
test("tour the order screens", async ({ page, context }) => {
  await signIn(context);
  const shot = (name: string) => page.screenshot({ path: `e2e/shots/${name}.png`, fullPage: true });
  await page.goto("/#/orders");
  await page.getByRole("table").waitFor();
  await shot("orders");
  await page.goto("/#/transaction?type=salesorder&id=16203");
  await page.getByRole("heading", { name: "Next steps" }).waitFor();
  await shot("so629");
  await page.getByRole("link", { name: /^IF/ }).first().click();
  await page.getByRole("heading", { name: "Next steps" }).waitFor();
  await shot("fulfillment");
  // Forms open but are never submitted.
  await page.goto("/#/transaction?type=salesorder&id=12654");
  await page.getByRole("button", { name: "Fulfill", exact: true }).click();
  await page.getByRole("button", { name: "Create fulfillment" }).waitFor();
  await shot("fulfill-form");
  await page.goto("/#/transaction?type=invoice&id=12348");
  await page.getByRole("button", { name: "Receive payment" }).click();
  await page.getByRole("button", { name: "Create customer payment" }).waitFor();
  await shot("payment-form");
  await page.goto("/#/payments");
  await page.getByRole("link", { name: /^PYMT/ }).first().click();
  await page.getByRole("heading", { name: "Linked records" }).waitFor();
  await shot("payment");
  await page.goto("/#/transaction?type=estimate&new=1");
  await page.getByRole("combobox", { name: "Customer" }).waitFor();
  await shot("new-quote-empty");
  await page.getByRole("combobox", { name: "Customer" }).fill("quinu");
  await page.getByRole("option").first().waitFor();
  await shot("new-quote-customer-search");
  await page.getByRole("option").first().click();
  await page.getByRole("combobox", { name: "Location" }).click();
  await page.getByRole("option").first().waitFor();
  await shot("new-quote-location-search");
  await page.getByRole("option", { name: "San Francisco", exact: true }).click();
  await page.getByRole("combobox", { name: "Item" }).fill("spc");
  await page.getByRole("option").first().click();
  await page.locator(".field-hint").first().waitFor();
  await shot("new-quote-item-picked");
});

import { expect, test } from "@playwright/test";
import { estimateShape, flowLine, mockApi, numbers, salesOrder, session } from "./mock";

test.describe("sales order fulfillment", () => {
  test("one unit takes one serial number; picking another replaces it", async ({ page }) => {
    await mockApi(page, {
      "/api/session": session,
      "/api/flow": salesOrder([flowLine({ location: { id: "2", name: "San Francisco" }, available: 2 })]),
      "/api/flow/numbers": numbers,
    });
    await page.goto("/#/transaction?type=salesorder&id=500");
    await page.getByRole("button", { name: "Fulfill", exact: true }).click();
    await expect(page.getByText("Serial number: pick 1")).toBeVisible();
    await page.getByLabel("BES500-DEMO-04").check();
    await page.getByLabel("BES500-DEMO-05").check();
    await expect(page.getByLabel("BES500-DEMO-04")).not.toBeChecked();
    await expect(page.getByLabel("BES500-DEMO-05")).toBeChecked();
  });

  test("two units stop at two serial numbers", async ({ page }) => {
    await mockApi(page, {
      "/api/session": session,
      "/api/flow": salesOrder([flowLine({ quantity: 2, remaining: 2, location: { id: "2", name: "San Francisco" }, available: 3 })]),
      "/api/flow/numbers": { numbers: [...numbers.numbers, { id: "6155", number: "BES500-DEMO-06", available: 1 }] },
    });
    await page.goto("/#/transaction?type=salesorder&id=500");
    await page.getByRole("button", { name: "Fulfill", exact: true }).click();
    await page.getByLabel("BES500-DEMO-04").check();
    await page.getByLabel("BES500-DEMO-05").check();
    await expect(page.getByLabel("BES500-DEMO-06")).toBeDisabled();
  });

  test("moving the order to a location with stock keeps the form open", async ({ page }) => {
    let moved = false;
    const writes = await mockApi(page, {
      "/api/session": session,
      "/api/flow": () => salesOrder([moved ? flowLine({ location: { id: "2", name: "San Francisco" }, available: 2 }) : flowLine()]),
      "/api/flow/numbers": numbers,
      "POST /api/records": () => {
        moved = true;
        return { id: "500", type: "salesorder" };
      },
      "POST /api/records/transform": { id: "901", type: "itemfulfillment", externalId: "hns-wf-test" },
    });
    await page.goto("/#/transaction?type=salesorder&id=500");
    await page.getByRole("button", { name: "Fulfill", exact: true }).click();
    await expect(page.getByText("Only 0 available at Boston. San Francisco has 2.")).toBeVisible();
    await page.getByLabel(/I mean to run this/).check();
    await page.getByRole("button", { name: "Ship the order from San Francisco" }).click();
    await expect(page.getByText("The order now ships from San Francisco.")).toBeVisible();
    await expect(page.getByText(/Line 1: .* from San Francisco/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create fulfillment" })).toBeVisible();
    await expect(page.getByLabel(/I mean to run this/)).toBeChecked();
    expect(writes[0]).toMatchObject({ path: "/api/records", body: { data: { location: { id: "2" } } } });

    await page.getByLabel("BES500-DEMO-04").check();
    await page.getByRole("button", { name: "Create fulfillment" }).click();
    await expect(page).toHaveURL(/type=itemfulfillment&id=901/);
    const transform = writes.find((write) => write.path === "/api/records/transform");
    expect(transform?.body.fulfill.lines[0]).toMatchObject({ orderLine: 1, receive: true, quantity: 1, numbers: [{ id: "6153", quantity: 1 }] });
    expect(transform?.body.fulfill.clearShipMethod).toBe(true);
  });

  test("a fulfillment that is only picked is not offered again", async ({ page }) => {
    const order = salesOrder([flowLine({ location: { id: "2", name: "San Francisco" }, available: 2, picked: 1, remaining: 0 })]);
    order.steps = [{ id: "close", label: "Close lines", kind: "close" }];
    order.linked = [{ id: "901", type: "itemfulfillment", number: "IF900", date: "11/8/2026", status: "Item Fulfillment : Picked", direction: "next" }] as never;
    await mockApi(page, { "/api/session": session, "/api/flow": order });
    await page.goto("/#/transaction?type=salesorder&id=500");
    await expect(page.getByText("IF900 is picked. Open it to pack or ship it.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Fulfill", exact: true })).toHaveCount(0);
    await expect(page.getByText("1 on a fulfillment not shipped yet")).toBeVisible();
  });

  test("the status select is the themed one", async ({ page }) => {
    await mockApi(page, {
      "/api/session": session,
      "/api/flow": salesOrder([flowLine({ location: { id: "2", name: "San Francisco" }, available: 2 })]),
      "/api/flow/numbers": numbers,
    });
    await page.goto("/#/transaction?type=salesorder&id=500");
    await page.getByRole("button", { name: "Fulfill", exact: true }).click();
    await page.getByRole("combobox", { name: "Fulfillment status" }).click();
    await page.getByRole("option", { name: "Packed" }).click();
    await expect(page.getByRole("combobox", { name: "Fulfillment status" })).toContainText("Packed");
    await expect(page.locator("select")).toHaveCount(0);
  });
});

test.describe("new quote", () => {
  test("pickers show the chosen value, item fills rate, description and quantity", async ({ page }) => {
    const locations: string[] = [];
    await mockApi(page, {
      "/api/session": session,
      "/api/records/fields": estimateShape,
      "/api/records/lookup": (_request: unknown, url: URL) => {
        const source = url.searchParams.get("source");
        if (source === "location") locations.push(url.searchParams.get("partyId") || "");
        const options = {
          customer: [{ id: "341", label: "124 Quinu LLP" }],
          location: [{ id: "2", label: "San Francisco" }],
          item: [{ id: "5", label: "SRV100 Server" }],
        }[source || ""];
        return { options: options || [] };
      },
      "/api/records/item-defaults": { rate: 7995, description: "Oracle SPARC server", rateLabel: "Base price" },
    });
    await page.goto("/#/transaction?type=estimate&new=1");
    const customer = page.getByRole("combobox", { name: "Customer" });
    await expect(customer).toHaveAttribute("placeholder", "Search customer");
    await expect(customer).toHaveValue("");
    await customer.click();
    await page.getByRole("option", { name: "124 Quinu LLP" }).click();
    await expect(customer).toHaveValue("124 Quinu LLP");
    await expect(page.getByRole("button", { name: "Clear" })).toHaveCount(0);

    await page.getByRole("combobox", { name: "Location" }).click();
    await page.getByRole("option", { name: "San Francisco" }).click();
    expect(locations.at(-1)).toBe("341");

    await page.getByRole("combobox", { name: "Item" }).click();
    await page.getByRole("option", { name: "SRV100 Server" }).click();
    await expect(page.getByRole("spinbutton", { name: "Rate" })).toHaveValue("7995");
    await expect(page.getByRole("textbox", { name: "Description" })).toHaveValue("Oracle SPARC server");
    await expect(page.getByRole("spinbutton", { name: "Quantity" })).toHaveValue("1");
    await expect(page.getByText("Base price 7995")).toBeVisible();
    await page.getByRole("spinbutton", { name: "Rate" }).fill("7000");
    await expect(page.getByRole("spinbutton", { name: "Rate" })).toHaveValue("7000");
  });
});

test.describe("lists", () => {
  test("payments start with all payments and use the themed select", async ({ page }) => {
    const statuses: string[] = [];
    await mockApi(page, {
      "/api/session": session,
      "/api/tx": (_request: unknown, url: URL) => {
        statuses.push(url.searchParams.get("status") || "");
        return {
          fetchedAt: new Date().toISOString(),
          rows: [{ id: "1", number: "PYMT1", date: "2026-11-08", name: "124 Quinu LLP", status: "Deposited", currency: "USD", amount: 20 }],
          hasMore: false,
          total: 1,
          page: 0,
          statuses: [{ id: "C", label: "Deposited" }],
          hasOpen: false,
        };
      },
    });
    await page.goto("/#/payments");
    await expect(page.getByRole("link", { name: "PYMT1", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Status" })).toContainText("All");
    await expect(page.locator("select")).toHaveCount(0);
  });
});

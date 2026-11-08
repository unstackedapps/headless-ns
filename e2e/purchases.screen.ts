import { expect, test } from "@playwright/test";
import { estimateShape, mockApi, session } from "./mock";

const poLine = {
  line: 1,
  orderLine: null,
  item: { id: "541", name: "KAP001 Kapton Plastic" },
  description: "Kapton Plastic",
  quantity: 4,
  rate: 2.1,
  amount: 8.4,
  closed: false,
  done: 1,
  picked: 0,
  billed: 0,
  remaining: 3,
  location: { id: "2", name: "San Francisco" },
};

function record(type: string, number: string, status: { id: string; name: string }, steps: unknown[], extra: Record<string, unknown> = {}) {
  return {
    type,
    id: "700",
    number,
    status,
    approvalStatus: "",
    header: {
      tranId: { value: number },
      tranDate: { value: "2026-11-08" },
      entity: { value: "628", refName: "Core4Solutions" },
      location: { value: "2", refName: "San Francisco" },
      total: { value: 8.4 },
      currency: { value: "1", refName: "US Dollar" },
    },
    unpaid: null,
    lines: [poLine],
    linked: [],
    steps,
    ...extra,
  };
}

const poShape = { ...estimateShape, type: "purchaseorder", fields: estimateShape.fields.map((field) => (field.id === "entity" ? { ...field, source: "vendor" } : field)) };

test.describe("purchase orders", () => {
  test("a new purchase order uses vendors, the vendor's locations and purchase prices", async ({ page }) => {
    const seen: string[] = [];
    await mockApi(page, {
      "/api/session": session,
      "/api/records/fields": poShape,
      "/api/records/lookup": (_request: unknown, url: URL) => {
        seen.push(`${url.searchParams.get("source")}:${url.searchParams.get("party") || ""}:${url.searchParams.get("partyId") || ""}`);
        const options = {
          vendor: [{ id: "628", label: "Core4Solutions" }],
          location: [{ id: "2", label: "San Francisco" }],
          item: [{ id: "541", label: "KAP001 Kapton Plastic" }],
        }[url.searchParams.get("source") || ""];
        return { options: options || [] };
      },
      "/api/records/item-defaults": (_request: unknown, url: URL) => {
        seen.push(`defaults:${url.searchParams.get("side")}`);
        return { rate: 2.1, description: "Kapton Plastic", rateLabel: "Purchase price" };
      },
    });
    await page.goto("/#/purchaseorders");
    await page.route("**/api/tx**", (route) => route.fulfill({ json: { rows: [], hasMore: false, total: 0, page: 0, statuses: [], hasOpen: true, fetchedAt: "" } }));
    await page.getByRole("link", { name: "New purchase order" }).click();
    const vendor = page.getByRole("combobox", { name: "Vendor" });
    await expect(vendor).toHaveAttribute("placeholder", "Search vendor");
    await vendor.click();
    await page.getByRole("option", { name: "Core4Solutions" }).click();
    await page.getByRole("combobox", { name: "Location" }).click();
    await page.getByRole("option", { name: "San Francisco" }).click();
    await page.getByRole("combobox", { name: "Item" }).click();
    await page.getByRole("option", { name: "KAP001 Kapton Plastic" }).click();
    await expect(page.getByRole("spinbutton", { name: "Rate" })).toHaveValue("2.1");
    await expect(page.getByText("Purchase price 2.1")).toBeVisible();
    expect(seen).toContain("vendor::");
    expect(seen).toContain("location:vendor:628");
    expect(seen).toContain("defaults:purchase");
  });

  test("receiving shows open quantities and none of the fulfillment options", async ({ page }) => {
    const writes = await mockApi(page, {
      "/api/session": session,
      "/api/flow": record("purchaseorder", "PO900", { id: "E", name: "Pending Billing/Partially Received" }, [
        { id: "receive", label: "Receive", kind: "ship", target: "itemreceipt" },
        { id: "bill", label: "Bill", kind: "transform", target: "vendorbill" },
        { id: "close", label: "Close lines", kind: "close" },
      ]),
      "POST /api/records/transform": { id: "701", type: "itemreceipt", externalId: "hns-wf-test" },
    });
    await page.goto("/#/transaction?type=purchaseorder&id=700");
    await expect(page.getByRole("heading", { name: "PO900" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Received" })).toBeVisible();
    await page.getByRole("button", { name: "Receive", exact: true }).click();
    await expect(page.getByText(/Line 1: KAP001 Kapton Plastic \(3 open\)/)).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Quantity" })).toHaveValue("3");
    await expect(page.getByRole("combobox", { name: "Fulfillment status" })).toHaveCount(0);
    await expect(page.getByText(/Leave the ship method empty/)).toHaveCount(0);
    await expect(page.getByText(/Only .* available/)).toHaveCount(0);
    await page.getByRole("spinbutton", { name: "Quantity" }).fill("2");
    await page.getByLabel(/I mean to run this/).check();
    await page.getByRole("button", { name: "Create item receipt" }).click();
    await expect(page).toHaveURL(/type=itemreceipt&id=701/);
    const transform = writes.find((write) => write.path === "/api/records/transform");
    expect(transform?.body).toMatchObject({ sourceRecordType: "purchaseorder", targetRecordType: "itemreceipt" });
    expect(transform?.body.fulfill.lines).toEqual([{ orderLine: 1, receive: true, quantity: 2 }]);
  });

  test("paying a bill takes a date and account and pays the open amount", async ({ page }) => {
    const writes = await mockApi(page, {
      "/api/session": session,
      "/api/flow": record("vendorbill", "415", { id: "A", name: "Open" }, [{ id: "pay", label: "Pay bill", kind: "pay", target: "vendorpayment" }], { unpaid: 8.4 }),
      "/api/records/lookup": { options: [{ id: "122", label: "1010 Cash : US Checking" }] },
      "POST /api/records/transform": { id: "702", type: "vendorpayment", externalId: "hns-wf-test" },
    });
    await page.goto("/#/transaction?type=vendorbill&id=700");
    await expect(page.getByRole("heading", { name: "Bill 415" })).toBeVisible();
    await expect(page.getByText("8.40 US Dollar").last()).toBeVisible();
    await page.getByRole("button", { name: "Pay bill" }).click();
    await expect(page.getByRole("spinbutton", { name: "Amount" })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Account" }).click();
    await page.getByRole("option", { name: "1010 Cash : US Checking" }).click();
    await expect(page.getByRole("combobox", { name: "Account" })).toHaveValue("1010 Cash : US Checking");
    await page.getByLabel(/I mean to run this/).check();
    await page.getByRole("button", { name: "Create bill payment" }).click();
    await expect(page).toHaveURL(/type=vendorpayment&id=702/);
    const transform = writes.find((write) => write.path === "/api/records/transform");
    expect(transform?.body.data).toMatchObject({ account: { id: "122" } });
    expect(transform?.body.data.payment).toBeUndefined();
  });
});

test.describe("vendors", () => {
  test("a vendor opens with open purchase orders, open bills and a new order link", async ({ page }) => {
    await mockApi(page, {
      "/api/session": session,
      "/api/vendors": { fetchedAt: "", rows: [{ id: "628", name: "Core4Solutions", company: "Core4Solutions", email: "", phone: "", subsidiary: "United States", href: "" }], hasMore: false, total: 1, page: 0 },
      "/api/vendors/628": {
        vendor: { id: "628", name: "Core4Solutions", company: "Core4Solutions", email: "a@b.c", phone: "1", subsidiary: "United States", href: "" },
        balance: [{ currency: "US Dollar", amount: 8.4 }],
        orders: [{ id: "700", number: "PO900", date: "2026-11-08", due: "", status: "Pending Receipt", currency: "US Dollar", amount: 8.4, unpaid: null }],
        bills: [{ id: "701", number: "BILL900", date: "2026-11-08", due: "2026-12-08", status: "Open", currency: "US Dollar", amount: 8.4, unpaid: 8.4 }],
      },
    });
    await page.goto("/#/vendors");
    await page.getByRole("button", { name: "Core4Solutions" }).click();
    const drawer = page.getByRole("dialog", { name: "Core4Solutions" });
    await expect(drawer.getByRole("link", { name: "PO900" })).toHaveAttribute("href", /type=purchaseorder&id=700/);
    await expect(drawer.getByRole("link", { name: "BILL900" })).toHaveAttribute("href", /type=vendorbill&id=701/);
    await expect(drawer.getByRole("link", { name: "New purchase order" })).toBeVisible();
  });
});

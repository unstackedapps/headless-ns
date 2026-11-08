import type { Page, Request } from "@playwright/test";

type Handler = (request: Request, url: URL) => unknown;

// Answers every /api/ call from the given handlers, so screen tests never reach NetSuite.
// Returns the write requests the page sent, for assertions.
export async function mockApi(page: Page, handlers: Record<string, Handler | unknown>) {
  const writes: { path: string; body: any }[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}`;
    if (request.method() === "POST") writes.push({ path: url.pathname, body: request.postDataJSON() });
    const handler = handlers[key] ?? handlers[url.pathname];
    const body = typeof handler === "function" ? await (handler as Handler)(request, url) : handler ?? {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return writes;
}

export const session = {
  signedIn: true,
  via: "netsuite",
  accountId: "TD3138390",
  roleId: "customrole_test",
  configured: true,
  discovery: {},
};

export function flowLine(overrides: Record<string, unknown> = {}) {
  return {
    line: 1,
    orderLine: null,
    item: { id: "760", name: "Breville Bambino Plus" },
    description: "Espresso machine",
    quantity: 1,
    rate: 399,
    amount: 399,
    closed: false,
    done: 0,
    picked: 0,
    billed: 0,
    remaining: 1,
    location: { id: "1", name: "Boston" },
    tracking: "serial",
    stock: [{ id: "2", name: "San Francisco", available: 2 }],
    available: 0,
    ...overrides,
  };
}

export function salesOrder(lines: unknown[]) {
  return {
    type: "salesorder",
    id: "500",
    number: "SO900",
    status: { id: "B", name: "Pending Fulfillment" },
    approvalStatus: "",
    header: {
      tranId: { value: "SO900" },
      tranDate: { value: "2026-11-08" },
      entity: { value: "341", refName: "124 Quinu LLP" },
      location: { value: "1", refName: "Boston" },
      shipMethod: { value: "4", refName: "UPS Ground" },
      total: { value: 399 },
      currency: { value: "1", refName: "US Dollar" },
    },
    unpaid: null,
    lines,
    linked: [],
    steps: [
      { id: "fulfill", label: "Fulfill", kind: "ship", target: "itemfulfillment" },
      { id: "close", label: "Close lines", kind: "close" },
    ],
  };
}

export const numbers = {
  numbers: [
    { id: "6153", number: "BES500-DEMO-04", available: 1 },
    { id: "6154", number: "BES500-DEMO-05", available: 1 },
  ],
};

const field = (id: string, title: string, type: string, source?: string) => ({ id, title, type, ...(source ? { source } : {}) });

export const estimateShape = {
  type: "estimate",
  fields: [field("entity", "Entity", "ref", "customer"), field("tranDate", "Date", "string"), field("location", "Location", "ref", "location"), field("memo", "Memo", "string")],
  sublists: [
    {
      id: "item",
      title: "Item",
      fields: [field("item", "Item", "ref", "item"), field("description", "Description", "string"), field("quantity", "Quantity", "number"), field("rate", "Rate", "number"), field("amount", "Amount", "number"), field("isClosed", "Closed", "boolean")],
    },
  ],
};

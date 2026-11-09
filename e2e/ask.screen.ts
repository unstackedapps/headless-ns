import { expect, test } from "@playwright/test";
import { flowLine, mockApi, salesOrder, session } from "./mock";

const pending = {
  answer: "",
  steps: [{ name: "ns_runCustomSuiteQL", ok: true }],
  pendingId: "p-1",
  transcript: [{ role: "user", content: "Quote Acme 2 SPC002 at 10" }],
  pending: [
    {
      id: "call-1",
      name: "ns_createRecord",
      arguments: { recordType: "estimate", data: '{"entity":{"id":"341"}}' },
      summary: { title: "Create quote for Acme: 2 lines, Boston, total 35.00 US Dollar", details: ["2 × SPC002 at 10.00 US Dollar", "3 × GAR002 at 5.00 US Dollar"] },
    },
  ],
};

test("Ask shows a pending write as a summary, with the payload folded away", async ({ page }) => {
  const writes = await mockApi(page, {
    "/api/session": session,
    "/api/flow": salesOrder([flowLine()]),
    "/api/config": { llm: { id: "m", configured: true, model: "gemma" }, models: { connections: [], activeId: "m" } },
    "POST /api/ask": pending,
    "POST /api/ask/confirm": { answer: "Created QUO120.", steps: [], pending: null, transcript: [{ role: "assistant", content: "Created QUO120." }] },
  });
  await page.goto("/#/transaction?type=salesorder&id=500");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "Ask" });
  await drawer.getByLabel("Question").fill("Quote Acme 2 SPC002 at 10");
  await drawer.getByLabel("Question").press("Enter");
  await expect(drawer.getByText("Create quote for Acme: 2 lines, Boston, total 35.00 US Dollar")).toBeVisible();
  await expect(drawer.getByText("2 × SPC002 at 10.00 US Dollar")).toBeVisible();
  const raw = drawer.getByText('"recordType": "estimate"');
  await expect(raw).toBeHidden();
  await drawer.getByText("Show the exact request").click();
  await expect(raw).toBeVisible();
  await drawer.getByRole("button", { name: "Run on NetSuite" }).click();
  await expect(drawer.getByText("Created QUO120.")).toBeVisible();
  expect(writes.find((write) => write.path === "/api/ask/confirm")?.body).toEqual({ id: "p-1", approved: true });
});

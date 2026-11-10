import { expect, test, type Locator } from "@playwright/test";
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

test("Ask names the skill and file it read in its steps", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/flow": salesOrder([flowLine()]),
    "/api/config": { llm: { id: "m", configured: true, model: "gemma" }, models: { connections: [], activeId: "m" } },
    "POST /api/ask": {
      answer: "China Manufacturer leads.",
      steps: [
        { name: "skill_read", ok: true, detail: "netsuite-suiteskills-finance" },
        { name: "skill_read", ok: true, detail: "netsuite-suiteskills-finance · runbooks/netsuite-vendor-spend-analysis/RUNBOOK.md" },
        { name: "skill_read", ok: false, detail: "netsuite-suiteskills-finance · missing.md", error: "No file missing.md in netsuite-suiteskills-finance." },
        { name: "ns_runCustomSuiteQL", ok: true },
      ],
      pending: null,
      transcript: [{ role: "assistant", content: "China Manufacturer leads." }],
    },
  });
  await page.goto("/#/transaction?type=salesorder&id=500");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "Ask" });
  await drawer.getByLabel("Question").fill("Top vendors?");
  await drawer.getByLabel("Question").press("Enter");
  await expect(drawer.getByText("Read skill netsuite-suiteskills-finance", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Read skill netsuite-suiteskills-finance · runbooks/netsuite-vendor-spend-analysis/RUNBOOK.md")).toBeVisible();
  await expect(drawer.getByText("Could not read skill netsuite-suiteskills-finance · missing.md. No file missing.md in netsuite-suiteskills-finance.")).toBeVisible();
  await expect(drawer.getByText("Ran a SuiteQL query")).toBeVisible();
});

// Every button group in the Ask drawer and the command line keeps the shared 8px gap.
test("buttons in the Ask drawer and the command line don't touch", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/flow": salesOrder([flowLine()]),
    "/api/config": { llm: { id: "m", configured: true, model: "gemma" }, models: { connections: [], activeId: "m" } },
    "POST /api/ask": pending,
  });
  const gap = async (left: Locator, right: Locator) => {
    const [a, b] = [await left.boundingBox(), await right.boundingBox()];
    return b!.x - (a!.x + a!.width);
  };
  await page.goto("/#/transaction?type=salesorder&id=500");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "Ask" });
  // The drawer slides in, so measure once it has settled.
  await expect.poll(() => gap(drawer.getByRole("button", { name: "Clear" }), drawer.getByRole("button", { name: "Close" }))).toBeGreaterThanOrEqual(8);
  await drawer.getByLabel("Question").fill("Quote Acme 2 SPC002 at 10");
  await drawer.getByLabel("Question").press("Enter");
  await expect.poll(() => gap(drawer.getByRole("button", { name: "Run on NetSuite" }), drawer.getByRole("button", { name: "Cancel" }))).toBeGreaterThanOrEqual(8);
  await drawer.screenshot({ path: "e2e/shots/ask-buttons.png" });

  await page.getByRole("button", { name: "Command line" }).click();
  const cli = page.getByRole("region", { name: "Command line" });
  await expect.poll(() => gap(cli.getByRole("button", { name: "Minimize" }), cli.getByRole("button", { name: "Close" }))).toBeGreaterThanOrEqual(8);
});

test("the confirm box keeps the same gap below the question as the messages have", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/flow": salesOrder([flowLine()]),
    "/api/config": { llm: { id: "m", configured: true, model: "gemma" }, models: { connections: [], activeId: "m" } },
    "POST /api/ask": pending,
  });
  await page.goto("/#/transaction?type=salesorder&id=500");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "Ask" });
  await drawer.getByLabel("Question").fill("Quote Acme 2 SPC002 at 10");
  await drawer.getByLabel("Question").press("Enter");
  const confirm = drawer.locator("section.panel", { hasText: "Confirm before this runs on NetSuite" });
  await expect(confirm).toBeVisible();
  const gap = await drawer.evaluate((root) => {
    const bubbles = root.querySelectorAll(".thread .bubble");
    const last = bubbles[bubbles.length - 1].getBoundingClientRect();
    return root.querySelector(".thread + .panel")!.getBoundingClientRect().top - last.bottom;
  });
  expect(gap).toBe(10);
});

import { expect, test } from "@playwright/test";
import { emptyList, mockApi, session } from "./mock";

// A reply recorded from the live Gemma model for "how do I create a quote?", after the Phase 6b prompt change.
const quoteHowTo = {
  answer:
    "You can create a new quote using the **Quotes > New quote** page in headless-ns.\n\nIf you would like me to create one for you now, please provide:\n* The customer\n* The items (including quantity and rate)\n* The date",
  steps: [],
  pending: null,
  transcript: [] as unknown[],
};

test("the command line keeps the conversation, so a follow-up reaches Ask with its question", async ({ page }) => {
  const bodies: unknown[] = [];
  await mockApi(page, {
    "/api/session": session,
    "/api/tx": emptyList,
    "/api/config": { llm: { id: "m", configured: true, model: "gemma" }, models: { connections: [], activeId: "m" } },
    "POST /api/ask": (request: { postDataJSON: () => { text: string; transcript: unknown[] } }) => {
      const body = request.postDataJSON();
      bodies.push(body);
      const transcript = [...body.transcript, { role: "user", content: body.text }, { role: "assistant", content: bodies.length === 1 ? quoteHowTo.answer : `Reply ${bodies.length}` }];
      return { ...quoteHowTo, answer: bodies.length === 1 ? quoteHowTo.answer : `Reply ${bodies.length}`, transcript };
    },
  });
  await page.goto("/#/payments");
  await page.getByRole("button", { name: "Command line" }).click();
  const command = page.getByLabel("Command", { exact: true });
  await command.fill("ask how do I create a quote?");
  await command.press("Enter");
  const log = page.locator(".cli-log");
  await expect(log.locator("strong", { hasText: "Quotes > New quote" })).toBeVisible();
  await expect(log.locator("li")).toHaveCount(3);
  await expect(log).not.toContainText("Transactions >");
  await expect(log).not.toContainText("ns_");
  await command.fill("ask Acme, 2 SPC002 at 10");
  await command.press("Enter");
  await expect(page.locator(".cli-log").getByText("Reply 2")).toBeVisible();
  expect((bodies[1] as { transcript: { content: string }[] }).transcript.map((m) => m.content)).toEqual(["how do I create a quote?", quoteHowTo.answer]);
  await command.fill("clear");
  await command.press("Enter");
  await command.fill("ask again");
  await command.press("Enter");
  await expect(page.locator(".cli-log").getByText("Reply 3")).toBeVisible();
  expect((bodies[2] as { transcript: unknown[] }).transcript).toEqual([]);
});

test("a running command shows a spinner with seconds, Escape or Ctrl+C cancels it, and answers render as markdown", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/tx": emptyList,
    "POST /api/ask": async (request: { postDataJSON: () => { text: string } }) => {
      const { text } = request.postDataJSON();
      await new Promise((resolve) => setTimeout(resolve, text === "slow" ? 5000 : 1200));
      return { answer: "**387** active customers.\n\n- Source: a `SuiteQL` query", steps: [], pending: null, transcript: [] };
    },
    "POST /api/query": async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return { columns: ["n"], rows: [{ n: 1 }], hasMore: false };
    },
  });
  await page.goto("/#/payments");
  await page.getByRole("button", { name: "Command line" }).click();
  const cli = page.getByRole("region", { name: "Command line" });
  const command = page.getByLabel("Command", { exact: true });

  await command.fill("ask slow");
  await command.press("Enter");
  await expect(cli.getByRole("status")).toContainText(/Thinking \d+s/);
  await expect(cli.getByText("Esc or Ctrl+C cancels")).toBeVisible();
  await command.press("Escape");
  await expect(cli.getByText(/Cancelled after \d+s\./)).toBeVisible();
  await expect(cli).toBeVisible();

  await command.fill("sql select 1 as n from dual");
  await command.press("Enter");
  await expect(cli.getByRole("status")).toContainText(/Running query \d+s/);
  await command.press("Control+c");
  await expect(cli.getByText(/Cancelled after \d+s\./)).toHaveCount(2);

  await command.fill("ask how many active customers?");
  await command.press("Enter");
  await expect(cli.getByText(/Done in \d+s/)).toBeVisible();
  await expect(cli.locator(".md-compact strong")).toHaveText("387");
  await expect(cli.locator(".md-compact code")).toHaveText("SuiteQL");
  await expect(cli.locator(".md-compact li")).toHaveText("Source: a SuiteQL query");
  await expect(cli.getByText("**387**")).toHaveCount(0);
  await cli.screenshot({ path: "e2e/shots/6b-cli-markdown.png" });
});

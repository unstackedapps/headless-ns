import { expect, test } from "@playwright/test";
import { emptyList, mockApi, session } from "./mock";

// A reply recorded from the live Gemma model for "how do I create a quote?", after the Phase 6b prompt change.
const quoteHowTo = {
  answer: "",
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
      const transcript = [...body.transcript, { role: "user", content: body.text }, { role: "assistant", content: `Reply ${bodies.length}` }];
      return { ...quoteHowTo, answer: `Reply ${bodies.length}`, transcript };
    },
  });
  await page.goto("/#/payments");
  await page.getByRole("button", { name: "Command line" }).click();
  const command = page.getByLabel("Command", { exact: true });
  await command.fill("ask how do I create a quote?");
  await command.press("Enter");
  await expect(page.locator(".cli-log").getByText("Reply 1")).toBeVisible();
  await command.fill("ask Acme, 2 SPC002 at 10");
  await command.press("Enter");
  await expect(page.locator(".cli-log").getByText("Reply 2")).toBeVisible();
  expect((bodies[1] as { transcript: { content: string }[] }).transcript.map((m) => m.content)).toEqual(["how do I create a quote?", "Reply 1"]);
  await command.fill("clear");
  await command.press("Enter");
  await command.fill("ask again");
  await command.press("Enter");
  await expect(page.locator(".cli-log").getByText("Reply 3")).toBeVisible();
  expect((bodies[2] as { transcript: unknown[] }).transcript).toEqual([]);
});

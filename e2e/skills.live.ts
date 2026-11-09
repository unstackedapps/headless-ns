import { existsSync, readdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session";

// Imports Oracle's skills from GitHub at a pinned commit, then asks each saved model two questions that the skills cover.
// Skills stay imported afterwards. The active model is put back at the end. Screenshots go to e2e/shots/skills-*.png.
test.describe.configure({ mode: "serial" });

const SHA = "d2190aa97f11ac9efd0fb945cd15fcaa47e874ff";
const REPO = "https://github.com/oracle/netsuite-suitecloud-sdk";
const SUITESKILLS = ["netsuite-suiteskills-customers-sales", "netsuite-suiteskills-finance", "netsuite-suiteskills-onboarding", "netsuite-suiteskills-operations", "netsuite-suiteskills-workforce"];
const CONNECTOR = "netsuite-ai-connector-instructions";
// What this test expects of each saved model. The app itself sends every model the same prompt and tools.
// `answers: false` checks skill loading only: the question names the skill, and Ask must read it and the runbook.
// Gemma on LM Studio writes SuiteQL NetSuite rejects for this question with skills on or off (2026-11-09),
// so its answer goes to the log unchecked. Set it to true to check a stronger model on that connection.
const MODELS = [
  { provider: "anthropic", answers: true },
  { provider: "google", answers: true },
  { provider: "openai", answers: true },
  { provider: "compatible", answers: false },
] as const;
const RUNBOOK = "netsuite-suiteskills-finance · runbooks/netsuite-vendor-spend-analysis/RUNBOOK.md";
// The 12-month vendor bill ranking the test checks Ask against, computed by the test's own SuiteQL.
const TOP_VENDORS_SQL =
  "SELECT BUILTIN.DF(t.entity) AS vendor, -SUM(t.foreigntotal) AS spend FROM transaction t WHERE t.type = 'VendBill' AND t.trandate >= ADD_MONTHS(TRUNC(SYSDATE), -12) GROUP BY BUILTIN.DF(t.entity) ORDER BY spend DESC FETCH FIRST 5 ROWS ONLY";

type Step = { name: string; ok: boolean; error?: string; detail?: string };
type AskReply = { answer: string; steps: Step[]; pending: unknown[] | null };
type Connection = { id: string; provider: string; model: string };

// Calls the app's own API from the signed-in page, so the session cookie and same-origin checks apply.
async function call<T>(page: Page, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ([url, payload]) => {
      const response = await fetch(url, payload === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || `${url} ${response.status}`);
      return json;
    },
    [path, body] as const,
  ) as Promise<T>;
}

async function connections(page: Page) {
  return call<{ models: { activeId: string; connections: Connection[] } }>(page, "/api/config").then((config) => config.models);
}

// Asks in the docked drawer and returns the server's reply, with its steps.
async function ask(page: Page, question: string, shot: string) {
  // A reload clears the chat, so each question starts fresh. goto alone keeps it when the URL is the same.
  await page.goto("/#/ask");
  await page.reload();
  const drawer = page.getByRole("complementary", { name: "Ask" });
  const reply = page.waitForResponse((response) => response.url().endsWith("/api/ask") && response.request().method() === "POST", { timeout: 300_000 });
  await drawer.getByLabel("Question").fill(question);
  await drawer.getByLabel("Question").press("Enter");
  const body = (await (await reply).json()) as AskReply & { error?: string };
  await expect(drawer.getByText("Looking that up.")).toBeHidden({ timeout: 30_000 });
  await page.screenshot({ path: `e2e/shots/skills-${shot}.png`, fullPage: true });
  console.log(`[${shot}] steps: ${body.steps?.map((step) => `${step.name}${step.detail ? `(${step.detail})` : ""}${step.ok ? "" : " FAILED"}`).join(", ")}`);
  console.log(`[${shot}] answer: ${String(body.answer || body.error).replace(/\s+/g, " ").slice(0, 600)}`);
  return body;
}

// The model rows the last request added to Trace, with their token counts.
async function tokens(page: Page, shot: string, since: number) {
  const trace = await call<{ entries: { id: number; source: string; name: string; detail: string }[] }>(page, "/api/trace");
  const rows = trace.entries.filter((entry) => entry.id > since && entry.source === "ask" && entry.name.startsWith("model ")).reverse();
  console.log(`[${shot}] tokens per model call: ${rows.map((row) => row.detail.replace(" input tokens, ", "/").replace(" output tokens", "")).join(", ")}`);
  return rows;
}

const lastTraceId = async (page: Page) => (await call<{ entries: { id: number }[] }>(page, "/api/trace")).entries[0]?.id ?? 0;

test.beforeEach(async ({ context, page }) => {
  page.on("response", (response) => response.url().includes("/api/skills") && console.log(`[net] ${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`));
  page.on("framenavigated", (frame) => frame === page.mainFrame() && console.log(`[nav] ${frame.url()}`));
  await signIn(context);
  await page.goto("/#/settings");
});

test("Oracle's skills import from Git at a pinned commit", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const before = await call<{ skills: { name: string }[] }>(page, "/api/skills");
  for (const name of [...SUITESKILLS, CONNECTOR]) if (before.skills.some((skill) => skill.name === name)) await call(page, "/api/skills/remove", { name });
  await page.reload();

  const section = page.getByRole("region", { name: "Skills" });
  await section.getByText("Import skills").click();
  for (const [folder, count] of [
    ["anthropic/netsuite-suiteskills", 5],
    ["anthropic/netsuite-ai-companion", 1],
  ] as const) {
    await section.getByLabel("Git URL").fill(REPO);
    await section.getByLabel("Branch, tag or commit").fill(SHA);
    await section.getByLabel("Folder in the repo").fill(folder);
    await section.getByRole("button", { name: "Preview from Git" }).click();
    const preview = section.getByRole("region", { name: "Import preview" });
    await expect(preview.getByRole("heading", { name: `Found ${count} ${count === 1 ? "skill" : "skills"} in git · oracle/netsuite-suitecloud-sdk · d2190aa` })).toBeVisible({ timeout: 180_000 });
    await preview.screenshot({ path: `e2e/shots/skills-import-${count}.png` });
    await preview.getByRole("button", { name: count === 1 ? "Import 1 skill" : `Import ${count} skills` }).click();
    await expect(page.getByText(new RegExp(`^Imported ${count} skills?\\.`))).toBeVisible({ timeout: 60_000 });
  }

  const after = await call<{ skills: { name: string; enabled: boolean; scripts: number; source: { sha: string; path: string } }[] }>(page, "/api/skills");
  const ours = after.skills.filter((skill) => [...SUITESKILLS, CONNECTOR].includes(skill.name));
  expect(ours.map((skill) => skill.name).sort()).toEqual([CONNECTOR, ...SUITESKILLS].sort());
  for (const skill of ours) {
    expect(skill.source.sha).toBe(SHA);
    expect(skill.enabled).toBe(true);
  }
  expect(ours.find((skill) => skill.name === "netsuite-suiteskills-finance")?.scripts).toBeGreaterThan(0);
  expect(ours.find((skill) => skill.name === "netsuite-suiteskills-finance")?.source.path).toBe("anthropic/netsuite-suiteskills/skills/netsuite-suiteskills-finance");
  // Scripts are stored as text.
  expect(existsSync("data/skills/netsuite-suiteskills-finance/shared/tools")).toBe(true);
  // Unimported previews wait 30 minutes, but no Git download folder may stay.
  expect(readdirSync("data/skills/.staging").filter((entry) => entry.startsWith("git-"))).toEqual([]);
  await section.screenshot({ path: "e2e/shots/skills-list-live.png" });
});

for (const { provider, answers } of MODELS) {
  test(`${provider}: Ask ${answers ? "follows" : "loads"} Oracle's vendor spend runbook and the connector skill`, async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const models = await connections(page);
    const model = models.connections.find((row) => row.provider === provider);
    expect(model, `a saved ${provider} model`).toBeTruthy();
    const original = models.activeId;
    await call(page, "/api/models/active", { id: model!.id });
    try {
      const expected = (await call<{ rows: { vendor: string }[] }>(page, "/api/query", { sql: TOP_VENDORS_SQL })).rows.map((row) => row.vendor);
      expect(expected).toHaveLength(5);

      let since = await lastTraceId(page);
      const question = "Who are our top 5 vendors by vendor bill spend over the last 12 months?";
      const spend = await ask(page, answers ? question : `Using the netsuite-suiteskills-finance skill, ${question[0].toLowerCase()}${question.slice(1)}`, `${provider}-vendors`);
      await tokens(page, `${provider}-vendors`, since);
      const names = spend.steps.map((step) => step.name);
      const read = (detail: string) => spend.steps.some((step) => step.name === "skill_read" && step.ok && step.detail === detail);
      const found = expected.filter((vendor) => spend.answer.includes(vendor));
      console.log(`[${provider}-vendors] vendors named: ${found.length} of 5`);
      expect(spend.pending ?? null).toBeNull();
      expect(read("netsuite-suiteskills-finance"), "read the finance skill").toBe(true);
      if (answers) {
        expect(names).toContain("ns_runCustomSuiteQL");
        expect(found.length, `vendors named: ${found.join(", ")}`).toBeGreaterThanOrEqual(4);
      } else {
        expect(read(RUNBOOK), "read the vendor spend runbook").toBe(true);
      }

      since = await lastTraceId(page);
      const reports = await ask(page, "Following the NetSuite AI connector instructions, which reports can I run for each subsidiary?", `${provider}-reports`);
      await tokens(page, `${provider}-reports`, since);
      const order = reports.steps.map((step) => step.name);
      expect(reports.pending ?? null).toBeNull();
      expect(reports.steps.some((step) => step.name === "skill_read" && step.ok && step.detail === CONNECTOR)).toBe(true);
      const firstSql = order.indexOf("ns_runCustomSuiteQL");
      for (const tool of answers ? ["ns_getSubsidiaries", "ns_listAllReports"] : ["ns_listAllReports"]) {
        expect(order, `${tool} ran`).toContain(tool);
        if (firstSql >= 0) expect(order.indexOf(tool), `${tool} before SuiteQL`).toBeLessThan(firstSql);
      }
    } finally {
      await call(page, "/api/models/active", { id: original });
    }
  });
}

test("with skills on, a write still stops at Run, and Cancel writes nothing", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const models = await connections(page);
  const claude = models.connections.find((row) => row.provider === "anthropic")!;
  const original = models.activeId;
  const policy = (await call<{ policy: { allowWrites: boolean; disabled: string[] } }>(page, "/api/config")).policy;
  await call(page, "/api/models/active", { id: claude.id });
  await call(page, "/api/config/policy", { ...policy, allowWrites: true });
  const memo = `headless-ns ask test ${Date.now()}`;
  try {
    await page.goto("/#/ask");
    const drawer = page.getByRole("complementary", { name: "Ask" });
    await drawer.getByLabel("Question").fill(`Create a quote for customer id 341 at location id 2 with 2 units of item id 248 at rate 10, memo "${memo}".`);
    await drawer.getByLabel("Question").press("Enter");
    await expect(drawer.getByRole("button", { name: "Run on NetSuite" })).toBeVisible({ timeout: 300_000 });
    await drawer.locator("section.panel").screenshot({ path: "e2e/shots/skills-write-guard.png" });
    await drawer.getByRole("button", { name: "Cancel" }).click();
    await expect(drawer.getByRole("button", { name: "Run on NetSuite" })).toBeHidden({ timeout: 120_000 });
    const rows = await call<{ rows: unknown[] }>(page, "/api/query", { sql: `SELECT id FROM transaction WHERE memo = '${memo}'` });
    expect(rows.rows).toEqual([]);
  } finally {
    await call(page, "/api/config/policy", policy);
    await call(page, "/api/models/active", { id: original });
  }
});

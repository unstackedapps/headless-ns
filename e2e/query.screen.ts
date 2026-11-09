import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { mockApi, session } from "./mock";

const tables = [
  { name: "account", title: "Account" },
  { name: "AccountsReceivableAging", title: "[Missing Label:AccountsReceivableAging]" },
  { name: "customer", title: "Customer" },
  { name: "transaction", title: "Transaction" },
];

function rowsFor(page: number, size: number) {
  return Array.from({ length: size }, (_, index) => ({ id: page * size + index + 1, entityid: `C${page * size + index + 1}`, email: index === 0 ? "" : "a@b.c" }));
}

test("Query writes a SELECT from column clicks, runs it, pages, saves it and downloads a CSV", async ({ page }) => {
  let saved: { name: string; sql: string }[] = [];
  const writes = await mockApi(page, {
    "/api/session": session,
    "/api/suiteql": (_request: unknown, url: URL) =>
      url.searchParams.get("type")
        ? { type: "customer", fields: [{ id: "entityid", title: "Name", type: "string" }, { id: "email", title: "Email", type: "string" }] }
        : { tables },
    "/api/queries": () => ({ queries: saved }),
    "POST /api/queries": (request: { postDataJSON: () => { name: string; sql: string } }) => {
      saved = [request.postDataJSON()];
      return { queries: saved };
    },
    "POST /api/query": (request: { postDataJSON: () => { page: number; pageSize: number } }) => {
      const { page: at, pageSize } = request.postDataJSON();
      const last = pageSize === 1000 ? at === 1 : at === 2;
      return { columns: ["id", "entityid", "email"], rows: rowsFor(at, pageSize === 1000 ? 3 : 2), page: at, hasMore: !last, total: 250 };
    },
  });
  await page.goto("/#/query");
  const rail = page.locator(".split-rail");
  await expect(rail.locator(".tool").first()).toContainText("Transaction");
  await expect(rail.getByText("[Missing Label:AccountsReceivableAging]")).toBeHidden();
  await rail.getByLabel("Show 1 table NetSuite left unlabeled").check();
  await expect(rail.getByText("[Missing Label:AccountsReceivableAging]")).toBeVisible();

  await rail.getByRole("button", { name: /^Customer/ }).click();
  await rail.getByRole("button", { name: /^Name/ }).click();
  await rail.getByRole("button", { name: /^Email/ }).click();
  await expect(page.getByLabel("SQL")).toHaveValue("SELECT entityid, email\nFROM customer");
  await rail.getByRole("button", { name: "All tables" }).click();
  await expect(rail.getByRole("button", { name: /^Transaction/ })).toBeVisible();

  await page.getByLabel("SQL").press("Control+Enter");
  const results = page.getByRole("table", { name: "Query results" });
  await expect(results.getByRole("cell", { name: "C1", exact: true })).toBeVisible();
  await expect(page.getByText("250 rows")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(results.getByRole("cell", { name: "C3", exact: true })).toBeVisible();
  expect(writes.filter((write) => write.path === "/api/query").at(-1)?.body).toEqual({ sql: "SELECT entityid, email\nFROM customer", page: 1, pageSize: 100 });

  await page.getByLabel("Query name").fill("Customer emails");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Customer-emails.csv");
  const csv = readFileSync(await file.path(), "utf8").split("\r\n");
  expect(csv[0]).toBe("id,entityid,email");
  expect(csv.length).toBe(7);
  await page.screenshot({ path: "e2e/shots/6b-query.png" });
});

test("a sample fills the editor and its name", async ({ page }) => {
  await mockApi(page, { "/api/session": session, "/api/suiteql": { tables }, "/api/queries": { queries: [] } });
  await page.goto("/#/query");
  await page.getByRole("button", { name: "Overdue invoices" }).click();
  await expect(page.getByLabel("SQL")).toHaveValue(/CustInvc/);
  await expect(page.getByLabel("Query name")).toHaveValue("Overdue invoices");
});

test("Query keeps the unlabeled-tables box inside the rail, shows samples as small chips, and sizes the Saved box", async ({ page }) => {
  await mockApi(page, { "/api/session": session, "/api/suiteql": { tables }, "/api/queries": { queries: [] } });
  await page.goto("/#/query");
  const check = page.getByLabel(/NetSuite left unlabeled/);
  await expect(check).toBeVisible();
  const rail = (await page.locator(".split-rail").boundingBox())!;
  expect((await check.boundingBox())!.x - rail.x).toBeGreaterThanOrEqual(6);
  for (const name of ["Open sales orders", "Top customers this month"]) {
    expect((await page.getByRole("button", { name }).boundingBox())!.height).toBeLessThanOrEqual(26);
  }
  expect(Math.round((await page.locator(".saved-row label").first().boundingBox())!.width)).toBe(280);
});

import { expect, test } from "@playwright/test";
import { mockApi, session } from "./mock";

const order = {
  id: "17489",
  fields: [
    { id: "tranId", value: "SO640" },
    { id: "memo", value: "Rush" },
  ],
  sublists: [],
};

test("Records finds a record by name, lists the newest of a type, and remembers what was opened", async ({ page }) => {
  const writes: string[] = [];
  await mockApi(page, {
    "/api/session": session,
    "/api/records/types": { types: ["advintercompanyjournalentry", "customer", "salesorder"] },
    "/api/records/fields": { type: "salesorder", fields: [{ id: "memo", title: "Memo", type: "string" }], sublists: [] },
    "/api/records/transforms": { targets: [] },
    "/api/records/actions": { actions: [] },
    "/api/records/find": (_request: unknown, url: URL) => {
      writes.push(url.searchParams.get("q") || "");
      return { rows: [{ id: "17489", type: "salesorder", label: "SO640", detail: "124 Quinu LLP" }] };
    },
    "/api/records/latest": { rows: [{ id: "17489", label: "SO640", detail: "124 Quinu LLP" }, { id: "17408", label: "SO639", detail: "" }] },
    "/api/records": order,
  });
  await page.goto("/#/records");
  const rail = page.locator(".split-rail");
  await expect(rail.locator(".tool").nth(0)).toContainText("Customer");
  await expect(rail.locator(".tool").nth(1)).toContainText("Sales order");
  await expect(rail.locator(".tool").nth(2)).toContainText("advintercompanyjournalentry");

  await rail.getByRole("button", { name: /Sales order/ }).click();
  const latest = page.getByRole("table", { name: "Newest Sales order records" });
  await expect(latest.getByRole("button", { name: "SO639" })).toBeVisible();
  await page.screenshot({ path: "e2e/shots/6b-records.png" });
  await latest.getByRole("button", { name: "SO640" }).click();
  await expect(page.locator(".pane-head strong")).toHaveText("Sales order SO640");
  await expect(page.getByText("Rush")).toBeVisible();

  await page.reload();
  const recent = page.getByRole("navigation", { name: "Recent records" });
  await expect(recent.getByRole("button", { name: "Sales order SO640" })).toBeVisible();

  await page.getByLabel("Find a record").fill("quinu");
  const results = page.getByRole("table", { name: "Search results" });
  await expect(results.getByRole("cell", { name: "124 Quinu LLP" })).toBeVisible();
  await expect(results.getByRole("cell", { name: "Sales order" })).toBeVisible();
  expect(writes).toEqual(["quinu"]);
  await results.getByRole("button", { name: "SO640" }).click();
  await expect(page).toHaveURL(/#\/records\?type=salesorder&id=17489/);
  await expect(page.locator(".pane-head strong")).toHaveText("Sales order SO640");
});

test("Recent sits in one row under the search box, not styled as the side menu", async ({ page }) => {
  await mockApi(page, { "/api/session": session, "/api/records/types": { types: ["salesorder"] } });
  await page.addInitScript(() =>
    localStorage.setItem(
      "hn-records-recent",
      JSON.stringify([
        { type: "salesorder", id: "17489", label: "SO640" },
        { type: "estimate", id: "16391", label: "QUO102" },
      ]),
    ),
  );
  await page.goto("/#/records");
  const recent = page.getByRole("navigation", { name: "Recent records" });
  const chips = recent.getByRole("button");
  await expect(chips).toHaveCount(2);
  const tops = await chips.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  const search = await page.getByLabel("Find a record").boundingBox();
  const box = await recent.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(search!.y + search!.height);
  expect(box!.width).toBeGreaterThan(400);
  const look = await recent.evaluate((el) => {
    const style = getComputedStyle(el);
    return { direction: style.flexDirection, border: style.borderRightWidth, background: style.backgroundColor };
  });
  expect(look).toEqual({ direction: "row", border: "0px", background: "rgba(0, 0, 0, 0)" });
});

test("an open record puts Find a field under its title, level with the Internal ID box", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/records/types": { types: ["salesorder"] },
    "/api/records/fields": { type: "salesorder", fields: [{ id: "memo", title: "Memo", type: "string" }], sublists: [] },
    "/api/records/transforms": { targets: [] },
    "/api/records/actions": { actions: [] },
    "/api/records": order,
  });
  await page.goto("/#/records?type=salesorder&id=17489");
  const head = page.locator(".split-main > .pane-head");
  await expect(head.locator("strong")).toHaveText("Sales order SO640");
  const find = head.getByLabel("Find a field");
  await expect(find).toBeVisible();
  const box = async (locator: typeof find) => (await locator.boundingBox())!;
  const [title, search, id, label] = [
    await box(head.locator("strong")),
    await box(find),
    await box(head.getByRole("textbox", { name: "Internal ID" })),
    await box(head.locator(".filters label")),
  ];
  expect(Math.abs(search.y + search.height - (id.y + id.height))).toBeLessThanOrEqual(2);
  expect(Math.abs(title.y - label.y)).toBeLessThanOrEqual(4);
});

test("with round corners on, the type list stays square so the selected first row is not clipped", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/records/types": { types: ["customer", "salesorder"] },
    "/api/records/fields": { type: "customer", fields: [], sublists: [] },
    "/api/records/latest": { rows: [] },
    "/api/records/transforms": { targets: [] },
    "/api/records/actions": { actions: [] },
  });
  await page.addInitScript(() => localStorage.setItem("hn-shape", "round"));
  await page.goto("/#/records?type=customer");
  const list = page.locator(".split-rail .tool-list");
  await expect(list.locator(".tool").first()).toContainText("Customer");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--radius-panel").trim())).not.toBe("0px");
  expect(await list.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("0px");
});

test("Attach reports its result under the Attach button, not at the top of the record", async ({ page }) => {
  await mockApi(page, {
    "/api/session": session,
    "/api/records/types": { types: ["salesorder"] },
    "/api/records/fields": { type: "salesorder", fields: [{ id: "memo", title: "Memo", type: "string" }], sublists: [] },
    "/api/records/transforms": { targets: [] },
    "/api/records/actions": { actions: [] },
    "/api/records": order,
    "POST /api/records/file": { ok: true },
  });
  await page.goto("/#/records?type=salesorder&id=17489");
  await expect(page.getByText("Rush")).toBeVisible();
  await page.getByLabel("Cabinet path").fill("/Customer POs/RW-1042-signed.pdf");
  await page.getByLabel(/I mean to run this/).first().check();
  await page.getByRole("button", { name: "Attach" }).click();
  const file = page.locator("section", { has: page.getByRole("heading", { name: "File" }) });
  await expect(file.getByRole("status")).toHaveText("NetSuite attached the file.");
  await expect(file.getByRole("status")).toBeInViewport();
});

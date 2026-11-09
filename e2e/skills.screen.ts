import { expect, test, type Page } from "@playwright/test";
import { mockApi, session } from "./mock";

const config = {
  accountId: "TD3138390",
  roleId: "customrole_test",
  permissions: {},
  features: [],
  policy: { allowWrites: false, disabled: [] },
  llm: { configured: true, model: "gemma" },
  models: { activeId: null, connections: [], providers: [] },
};

const staged = (name: string, description: string) => ({
  name,
  description,
  license: "UPL-1.0",
  compatibility: "",
  ignoredKeys: name === "beta" ? ["hooks"] : [],
  warnings: [],
  exists: false,
  fileCount: 3,
  size: 2048,
});

const row = (name: string, description: string, enabled = true) => ({
  name,
  description,
  license: "UPL-1.0",
  enabled,
  source: { kind: "zip" },
  importedAt: "2026-11-09T10:00:00Z",
  fileCount: 3,
  size: 2048,
  scripts: 1,
});

// A small in-memory skill store behind the mocked routes.
async function skillsApi(page: Page) {
  let saved: ReturnType<typeof row>[] = [];
  const payload = () => ({ skills: saved, shortened: 0 });
  const writes = await mockApi(page, {
    "/api/session": session,
    "/api/config": config,
    "/api/tools": { tools: [] },
    "GET /api/skills": payload,
    "POST /api/skills/stage": (request: { postDataJSON: () => { kind: string; data?: string } }) => {
      const body = request.postDataJSON();
      return {
        id: "s1",
        source: body.kind === "git" ? { kind: "git", url: "https://github.com/oracle/netsuite-suitecloud-sdk", ref: "ai-plugins-dist", sha: "d2190aa97f11ac9efd0fb945cd15fcaa47e874ff", path: "anthropic" } : { kind: body.kind },
        skills: [staged("alpha", "Ranks vendors by spend."), staged("beta", "Closes the month.")],
        problems: [],
        skipped: [
          { path: "p/tool.exe", reason: "File type Ask can't use" },
          { path: "p/link.md", reason: "Symbolic link" },
        ],
        skippedCount: 2,
      };
    },
    "POST /api/skills/import": (request: { postDataJSON: () => { names: string[] } }) => {
      const { names } = request.postDataJSON();
      saved = names.map((name) => row(name, name === "alpha" ? "Ranks vendors by spend." : "Closes the month."));
      return { imported: names, kept: [], ...payload() };
    },
    "POST /api/skills/toggle": (request: { postDataJSON: () => { name: string; enabled: boolean } }) => {
      const { name, enabled } = request.postDataJSON();
      saved = saved.map((item) => (item.name === name ? { ...item, enabled } : item));
      return payload();
    },
    "POST /api/skills/remove": (request: { postDataJSON: () => { name: string } }) => {
      saved = saved.filter((item) => item.name !== request.postDataJSON().name);
      return payload();
    },
    "POST /api/skills/file": (request: { postDataJSON: () => { name: string; path?: string } }) => {
      const { name, path } = request.postDataJSON();
      if (path === "scripts/run.py") return { name, path, size: 9, script: true, text: "print(1)" };
      return {
        name,
        path: "SKILL.md",
        size: 120,
        script: false,
        text: "---\nname: alpha\ndescription: x\n---\n## Steps\n\n- Read **vendors** first.\n",
        files: [
          { path: "SKILL.md", size: 120 },
          { path: "scripts/run.py", size: 9 },
        ],
      };
    },
  });
  return writes;
}

test("import a zip: preview, untick one, import, toggle, open the drawer, remove after the dialog", async ({ page }) => {
  const writes = await skillsApi(page);
  await page.goto("/#/settings");
  const section = page.getByRole("region", { name: "Skills" });
  await expect(section.getByText("No skills yet. Import a folder, a zip or a Git URL")).toBeVisible();

  await section.getByText("Import skills").click();
  await section.getByLabel("A zip, or one Markdown file").setInputFiles({ name: "skills.zip", mimeType: "application/zip", buffer: Buffer.from("PK fake zip") });
  const preview = section.getByRole("region", { name: "Import preview" });
  await expect(preview.getByRole("heading", { name: "Found 2 skills in zip" })).toBeVisible();
  await expect(preview.getByText("Skipped 2 files Ask can't use")).toBeVisible();
  await expect(preview.getByText("Ignored keys: hooks")).toBeVisible();
  await preview.screenshot({ path: "e2e/shots/skills-preview.png" });
  await preview.getByRole("checkbox", { name: /beta/ }).uncheck();
  await preview.getByRole("button", { name: "Import 1 skill" }).click();
  await expect(page.getByText("Imported 1 skill. Skipped 2 files Ask can't use.")).toBeVisible();
  expect(writes.find((write) => write.path === "/api/skills/import")?.body).toEqual({ stagedId: "s1", names: ["alpha"], replace: [] });
  await expect(section.getByRole("listitem")).toHaveCount(1);
  await expect(section.getByText("Ranks vendors by spend.")).toBeVisible();
  await section.screenshot({ path: "e2e/shots/skills-list.png" });

  const toggle = section.getByRole("checkbox", { name: "alpha" });
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  expect(writes.filter((write) => write.path === "/api/skills/toggle").map((write) => write.body.enabled)).toEqual([false, true]);

  await section.getByRole("button", { name: "Preview alpha" }).click();
  const drawer = page.getByRole("dialog", { name: "alpha" });
  await expect(drawer.getByRole("heading", { name: "Steps" })).toBeVisible();
  await expect(drawer.getByText("name: alpha")).toHaveCount(0);
  await expect(drawer.getByText("UPL-1.0 · zip · 3 files · 2 KB · 1 scripts, not run by Ask")).toBeVisible();
  await page.screenshot({ path: "e2e/shots/skills-drawer.png" });
  await drawer.getByText("2 files").click();
  await drawer.getByRole("button", { name: "scripts/run.py" }).click();
  await expect(page.getByText("Not run by Ask. Ask can read this script as a description of the steps.")).toBeVisible();
  await expect(page.getByText("print(1)")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await section.getByRole("button", { name: "Remove alpha" }).click();
  const confirm = page.getByRole("dialog", { name: "Remove alpha?" });
  await expect(confirm.getByText("Folder and zip imports can't be fetched again.")).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Remove" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  expect(writes.some((write) => write.path === "/api/skills/remove")).toBe(false);
  await section.getByRole("button", { name: "Remove alpha" }).click();
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Removed alpha.")).toBeVisible();
  await expect(section.getByText("No skills yet.")).toBeVisible();
});

test("the Oracle link fills the Git fields and stages that folder", async ({ page }) => {
  const writes = await skillsApi(page);
  await page.goto("/#/settings");
  const section = page.getByRole("region", { name: "Skills" });
  await section.getByRole("button", { name: "use Oracle's NetSuite skills" }).click();
  await expect(section.getByLabel("Git URL")).toHaveValue("https://github.com/oracle/netsuite-suitecloud-sdk");
  await expect(section.getByLabel("Branch, tag or commit")).toHaveValue("ai-plugins-dist");
  await expect(section.getByLabel("Folder in the repo")).toHaveValue("anthropic");
  await expect(section.getByRole("heading", { name: "Found 2 skills in git · oracle/netsuite-suitecloud-sdk · d2190aa" })).toBeVisible();
  await expect.poll(() => writes.find((write) => write.path === "/api/skills/stage")?.body).toEqual({
    kind: "git",
    url: "https://github.com/oracle/netsuite-suitecloud-sdk",
    ref: "ai-plugins-dist",
    path: "anthropic",
  });
});

test("keyboard: Enter opens the import form and Tab reaches each field in order", async ({ page }) => {
  await skillsApi(page);
  await page.goto("/#/settings");
  const section = page.getByRole("region", { name: "Skills" });
  const summary = section.getByText("Import skills");
  await summary.focus();
  await page.keyboard.press("Enter");
  for (const label of ["A skill folder or plugin folder", "A zip, or one Markdown file (AGENTS.md, CLAUDE.md, .mdc)", "Git URL", "Branch, tag or commit", "Folder in the repo"]) {
    await page.keyboard.press("Tab");
    await expect(section.getByLabel(label)).toBeFocused();
  }
});

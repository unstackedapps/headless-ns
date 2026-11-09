import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseYaml, readFrontmatter } from "../server/frontmatter.mjs";
import { LIMITS, PAGE_CHARS, checkSkill, findSkills, openSkillStore, pagesOf, pathProblem, rewriteLinks, sectionOf } from "../server/skills.mjs";

const file = (path, text) => ({ path, bytes: Buffer.isBuffer(text) ? text : Buffer.from(text) });
const skillMd = (name, description = `Does ${name} things.`, extra = "") => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n\nBody of ${name}.\n`;
const store = () => openSkillStore(mkdtempSync(join(tmpdir(), "hn-skills-")));

test("frontmatter reads Oracle's real header shapes", () => {
  const parsed = readFrontmatter(`---
name: netsuite-suiteskills-finance
description: "Use for Finance and Accounting: Expense Close Assistant, Match Vendor Credits to Bills. Select the matching runbook."
license: The Universal Permissive License (UPL), Version 1.0
metadata:
  owner: "Oracle NetSuite"
  version: "1.0.0"
  category-id: CAT-FIN
---
# Body
`);
  assert.equal(parsed.data.name, "netsuite-suiteskills-finance");
  assert.match(parsed.data.description, /^Use for Finance and Accounting: Expense/);
  assert.equal(parsed.data.license, "The Universal Permissive License (UPL), Version 1.0");
  assert.deepEqual(parsed.data.metadata, { owner: "Oracle NetSuite", version: "1.0.0", "category-id": "CAT-FIN" });
  assert.equal(parsed.body, "# Body\n");
});

test("frontmatter reads | and > blocks, single quotes, lists and wrapped values", () => {
  const data = parseYaml(`literal: |
  one
  two
folded: >-
  one
  two

  three
quoted: 'it''s'
tools: [Read, "Grep"]
items:
  - a
  - b
wrapped: a long
  value`);
  assert.equal(data.literal, "one\ntwo\n");
  assert.equal(data.folded, "one two\n\nthree");
  assert.equal(data.quoted, "it's");
  assert.deepEqual(data.tools, ["Read", "Grep"]);
  assert.deepEqual(data.items, ["a", "b"]);
  assert.equal(data.wrapped, "a long value");
});

test("frontmatter refuses YAML outside the subset with its line number", () => {
  assert.throws(() => readFrontmatter("---\nname: x\nhooks:\n  pre:\n    - run: rm\n---\n"), /line 5/);
  assert.throws(() => readFrontmatter("---\nname: &anchor x\n---\n"), /line 2/);
  assert.throws(() => readFrontmatter("---\nname: x\n"), /no closing/);
  assert.equal(readFrontmatter("# no header"), null);
});

test("checkSkill enforces name and description rules", () => {
  assert.equal(checkSkill(skillMd("vendor-spend"), "vendor-spend").name, "vendor-spend");
  assert.throws(() => checkSkill("---\nname: x\n---\n"), /no description/);
  assert.throws(() => checkSkill(skillMd("Bad_Name")), /lowercase/);
  assert.throws(() => checkSkill(skillMd("a--b")), /lowercase/);
  assert.throws(() => checkSkill(skillMd("x", "d".repeat(1025))), /1,024/);
  assert.equal(checkSkill(skillMd("x", "d".repeat(1024))).description.length, 1024);
  assert.match(checkSkill(skillMd("real-name"), "folder-name").warnings[0], /Ask uses "real-name"/);
  assert.deepEqual(checkSkill(skillMd("x", "y", "hooks: none\nmodel: opus\nallowed-tools: Read\n")).ignoredKeys, ["hooks", "model"]);
});

test("unsafe paths are refused", () => {
  for (const bad of ["../x", "a/../b", "/etc/passwd", "C:\\x", "C:/x", "a\\b", "a\u0000b", "a//b", "./a", "x".repeat(241)]) {
    assert.notEqual(pathProblem(bad), "", bad);
  }
  assert.equal(pathProblem("skills/a/references/b.md"), "");
  assert.equal(pathProblem("x".repeat(240)), "");
  assert.throws(() => findSkills([file("a/SKILL.md", skillMd("a")), file("a/../../etc", "x")]), /\.\./);
});

test("detection: one skill folder, a plugin with 3 skills, a codex plugin, and nested SKILL.md", () => {
  const one = findSkills([file("vendor/SKILL.md", skillMd("vendor")), file("vendor/references/a.md", "a")]);
  assert.equal(one.skills.length, 1);
  assert.deepEqual(one.skills[0].files.map((item) => item.path).sort(), ["SKILL.md", "references/a.md"]);

  const plugin = findSkills([
    file("plug/.claude-plugin/plugin.json", "{}"),
    file("plug/README.md", "readme"),
    ...["a", "b", "c"].map((name) => file(`plug/skills/${name}/SKILL.md`, skillMd(name))),
    file("plug/skills/a/examples/inner/SKILL.md", skillMd("inner")),
  ]);
  assert.deepEqual(plugin.skills.map((item) => item.folder), ["a", "b", "c"]);
  assert.ok(plugin.skills[0].files.some((item) => item.path === "examples/inner/SKILL.md"));
  assert.ok(plugin.skipped.some((item) => item.path === "plug/README.md" && item.reason === "Not inside a skill folder"));

  const codex = findSkills([file("repo/.agents/skills/x/SKILL.md", skillMd("x")), file("repo/.codex-plugin/plugin.json", "{}")]);
  assert.equal(codex.skills[0].folder, "x");
});

test("detection wraps one AGENTS.md or .mdc rule as a playbook", () => {
  const agents = findSkills([file("acme-ops/AGENTS.md", "# Ops\n\nClose the month in this order.\n\nMore.")]);
  const head = checkSkill(agents.skills[0].files[0].bytes.toString(), agents.skills[0].folder);
  assert.equal(head.name, "acme-ops");
  assert.equal(head.description, "Close the month in this order.");

  const rule = findSkills([file("rules/Vendor Rules.mdc", "---\ndescription: Vendor payment rules\nglobs: '*.ts'\nalwaysApply: false\n---\nPay on Fridays.")]);
  const ruleHead = readFrontmatter(rule.skills[0].files[0].bytes.toString());
  assert.equal(ruleHead.data.name, "vendor-rules");
  assert.equal(ruleHead.data.description, "Vendor payment rules");
  assert.equal(ruleHead.body.trim(), "Pay on Fridays.");

  const renamed = findSkills([file("x.md", "Text")], { playbook: { name: "My Playbook", description: "Edited" } });
  assert.equal(readFrontmatter(renamed.skills[0].files[0].bytes.toString()).data.name, "my-playbook");
  assert.throws(() => findSkills([file("a.md", "a"), file("b.md", "b")]), /No SKILL.md/);
});

test("limits: big files, wrong types, bad UTF-8 and hidden files are skipped and counted", () => {
  const found = findSkills([
    file("s/SKILL.md", skillMd("s")),
    file("s/big.json", Buffer.alloc(LIMITS.file + 1, 32)),
    file("s/tool.exe", "x"),
    file("s/bad.md", Buffer.from([0xff, 0xfe, 0x00])),
    file("s/.env", "SECRET=1"),
    file("s/pic.png", Buffer.alloc(LIMITS.image + 1)),
    file("s/run.py", "print(1)"),
  ]);
  const reasons = Object.fromEntries(found.skipped.map((item) => [item.path, item.reason]));
  assert.equal(reasons["s/big.json"], "File over 4 MB");
  assert.equal(reasons["s/tool.exe"], "File type Ask can't use");
  assert.equal(reasons["s/bad.md"], "Not UTF-8 text");
  assert.equal(reasons["s/.env"], "Hidden file");
  assert.equal(reasons["s/pic.png"], "Image over 1 MB");
  assert.deepEqual(found.skills[0].files.map((item) => item.path).sort(), ["SKILL.md", "run.py"]);
  const many = Array.from({ length: LIMITS.files + 1 }, (_, index) => file(`s/${index}.md`, "x"));
  assert.throws(() => findSkills(many), /limit is 2500/);
});

test("stage, then import only the ticked skill, and nothing reaches data/skills before Import", () => {
  const skills = store();
  const preview = skills.stage(
    [file("p/skills/a/SKILL.md", skillMd("a")), file("p/skills/a/scripts/x.py", "print(1)"), file("p/skills/b/SKILL.md", skillMd("b")), file("p/skills/c/SKILL.md", "no header")],
    { kind: "folder" },
  );
  assert.deepEqual(preview.skills.map((item) => item.name), ["a", "b"]);
  assert.equal(preview.problems.length, 1);
  assert.match(preview.problems[0].error, /no frontmatter/);
  assert.equal(existsSync(join(skills.dir, "a")), false);
  const result = skills.importStaged(preview.id, ["a"]);
  assert.deepEqual(result.imported, ["a"]);
  assert.equal(readFileSync(join(skills.dir, "a", "scripts", "x.py"), "utf8"), "print(1)");
  assert.deepEqual(skills.list().map((row) => row.name), ["a"]);
  assert.deepEqual(skills.list()[0].source, { kind: "folder" });
  assert.equal(skills.list()[0].enabled, true);
  assert.throws(() => skills.importStaged(preview.id, ["b"]), /expired/);
  assert.deepEqual(readdirSync(skills.dir).sort(), [".staging", "a"]);
});

test("an existing name is kept unless the person chose Replace", () => {
  const skills = store();
  skills.importStaged(skills.stage([file("a/SKILL.md", skillMd("a", "Old."))], { kind: "folder" }).id, ["a"]);
  skills.toggle("a", false);
  const again = skills.stage([file("a/SKILL.md", skillMd("a", "New."))], { kind: "zip" });
  assert.equal(again.skills[0].exists, true);
  assert.deepEqual(skills.importStaged(again.id, ["a"]).kept, ["a"]);
  assert.equal(skills.list()[0].description, "Old.");
  const third = skills.stage([file("a/SKILL.md", skillMd("a", "New."))], { kind: "zip" });
  skills.importStaged(third.id, ["a"], ["a"]);
  assert.equal(skills.list()[0].description, "New.");
  assert.equal(skills.list()[0].enabled, false, "replace keeps the on/off choice");
  assert.match(readFileSync(join(skills.dir, "a", "SKILL.md"), "utf8"), /New\./);
});

test("two skills with the same name in one import: the second is a problem", () => {
  const preview = store().stage([file("x/SKILL.md", skillMd("a")), file("y/SKILL.md", skillMd("a"))], { kind: "folder" });
  assert.equal(preview.skills.length, 1);
  assert.match(preview.problems[0].error, /also named a/);
});

test("import refuses a staged tree that gained a symlink", () => {
  const skills = store();
  const preview = skills.stage([file("a/SKILL.md", skillMd("a"))], { kind: "folder" });
  symlinkSync("/etc/passwd", join(skills.dir, ".staging", preview.id, "a", "link.md"));
  assert.throws(() => skills.importStaged(preview.id, ["a"]), /not a plain file/);
  assert.equal(skills.list().length, 0);
});

test("toggle and remove", () => {
  const skills = store();
  skills.importStaged(skills.stage([file("a/SKILL.md", skillMd("a")), file("b/SKILL.md", skillMd("b"))], { kind: "folder" }).id, ["a", "b"]);
  skills.toggle("b", false);
  assert.deepEqual(skills.enabled().map((row) => row.name), ["a"]);
  skills.remove("a");
  assert.equal(existsSync(join(skills.dir, "a")), false);
  assert.deepEqual(skills.list().map((row) => row.name), ["b"]);
  assert.throws(() => skills.remove("nope"), /No skill named nope/);
});

function finance() {
  const skills = store();
  const runbook = `---\nname: vendor-spend\ndescription: x\n---\nLoad [SafeWords](../../SKILL.md#safewords) and [retrieval](../../shared/contracts/RETRIEVAL.md).\nSee [docs](https://example.com/a.md) and [above](#scope).\n\n## Scope\n\nTop 5.\n`;
  const body = `${skillMd("fin")}\n## SafeWords\n\nNever post.\n\n### Detail\n\nStill SafeWords.\n\n\`\`\`\n## Not a heading\n\`\`\`\n\n## Other\n\nOther text.\n`;
  const files = [
    file("fin/SKILL.md", body),
    file("fin/runbooks/vendor-spend/RUNBOOK.md", runbook),
    file("fin/shared/contracts/RETRIEVAL.md", "Retrieve."),
    file("fin/shared/tools/bind.py", "print('bind')"),
    file("fin/shared/big.md", Array.from({ length: 3000 }, (_, index) => `Line ${index} "quoted" text.`).join("\n")),
    file("fin/assets/logo.png", Buffer.from([0x89, 0x50])),
  ];
  skills.importStaged(skills.stage(files, { kind: "folder" }).id, ["fin"]);
  return skills;
}

test("skill_read with no path returns the body without frontmatter and a short outline", () => {
  const result = finance().read({ name: "fin" });
  assert.equal(result.path, "SKILL.md");
  assert.doesNotMatch(result.text, /^---/);
  assert.match(result.text, /^# fin/);
  assert.deepEqual(result.files, [
    { path: "SKILL.md", size: result.files[0].size },
    { path: "assets/", files: 1 },
    { path: "runbooks/", files: 1 },
    { path: "shared/", files: 3 },
  ]);
});

test("skill_read lists a folder, rewrites links to root paths, and reads #sections", () => {
  const skills = finance();
  assert.deepEqual(skills.read({ name: "fin", path: "shared" }).files.map((item) => item.path), ["shared/big.md", "shared/contracts/", "shared/tools/"]);
  const runbook = skills.read({ name: "fin", path: "runbooks/vendor-spend/RUNBOOK.md" }).text;
  assert.match(runbook, /\]\(SKILL\.md#safewords\)/);
  assert.match(runbook, /\]\(shared\/contracts\/RETRIEVAL\.md\)/);
  assert.match(runbook, /\]\(https:\/\/example\.com\/a\.md\)/);
  assert.match(runbook, /\]\(runbooks\/vendor-spend\/RUNBOOK\.md#scope\)/);
  const section = skills.read({ name: "fin", path: "SKILL.md#safewords" });
  assert.equal(section.path, "SKILL.md#safewords");
  assert.match(section.text, /Never post\.[\s\S]*Still SafeWords\.[\s\S]*Not a heading/);
  assert.doesNotMatch(section.text, /Other text/);
  assert.throws(() => skills.read({ name: "fin", path: "SKILL.md#nope" }), /No section #nope/);
});

test("skill_read pages long files under the tool result cap", () => {
  const skills = finance();
  const first = skills.read({ name: "fin", path: "shared/big.md" });
  assert.equal(first.page, 1);
  assert.ok(first.pages > 1);
  assert.ok(JSON.stringify(first).length < 14000);
  const last = skills.read({ name: "fin", path: "shared/big.md", page: first.pages });
  assert.match(last.text, /Line 2999/);
  assert.equal(skills.read({ name: "fin", path: "shared/big.md", page: 999 }).page, first.pages);
  const long = "x\"".repeat(40_000);
  const pages = pagesOf(long);
  assert.equal(pages.join(""), long);
  assert.ok(pages.every((page) => JSON.stringify(page).length - 2 <= PAGE_CHARS));
});

test("skill_read refuses unknown paths and disabled skills, and labels scripts", () => {
  const skills = finance();
  assert.throws(() => skills.read({ name: "fin", path: "../../etc/passwd" }), /No file \.\.\/\.\.\/etc\/passwd in fin\. Files: SKILL\.md, assets\/, runbooks\/, shared\//);
  assert.throws(() => skills.read({ name: "fin", path: "shared/missing.md" }), /No file shared\/missing\.md/);
  assert.match(skills.read({ name: "fin", path: "shared/tools/bind.py" }).text, /^Ask can't run this script\./);
  assert.match(skills.read({ name: "fin", path: "assets/logo.png" }).text, /image/);
  skills.toggle("fin", false);
  assert.throws(() => skills.read({ name: "fin" }), /No skill named fin/);
  assert.throws(() => skills.read({ name: "other" }), /No skill named other/);
});

test("sectionOf and rewriteLinks edge cases", () => {
  assert.equal(sectionOf("# A\n\ntext\n# B", "missing"), null);
  assert.equal(sectionOf("## Step 1: Scope\nx\n## Next", "step-1-scope"), "## Step 1: Scope\nx");
  assert.equal(rewriteLinks("[x](../../../outside.md)", "a/b.md"), "[x](../../../outside.md)");
  assert.equal(rewriteLinks("[x](./c.md)", "a/b.md"), "[x](a/c.md)");
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { parseGitSource, resolveRef } from "../server/git.mjs";
import { openSkillStore } from "../server/skills.mjs";

// The app blocks file:// remotes, so these tests reach a local repo through their own runner.
const git = async (args, cwd) =>
  execFileSync("git", ["-c", "protocol.allow=always", "-c", "core.symlinks=false", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });

const skillMd = (name, body = "Body.") => `---\nname: ${name}\ndescription: Does ${name} things.\n---\n${body}\n`;

async function repo() {
  const dir = mkdtempSync(join(tmpdir(), "hn-git-src-"));
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  await git(["init", "-q", "-b", "main", dir]);
  await git(["config", "uploadpack.allowFilter", "true"], dir);
  await git(["config", "uploadpack.allowAnySHA1InWant", "true"], dir);
  put("anthropic/plug/skills/alpha/SKILL.md", skillMd("alpha"));
  put("anthropic/plug/skills/alpha/references/a.md", "A");
  put("anthropic/plug/skills/beta/SKILL.md", skillMd("beta"));
  put("openai/other/SKILL.md", skillMd("other"));
  symlinkSync("/etc/passwd", join(dir, "anthropic/plug/skills/alpha/passwd.md"));
  await git(["add", "-A"], dir);
  await git(["commit", "-q", "-m", "one"], dir);
  await git(["tag", "-a", "v1", "-m", "v1"], dir);
  const first = (await git(["rev-parse", "HEAD"], dir)).trim();
  return { dir, url: `file://${dir}`, first, put };
}

const storeFor = () => openSkillStore(mkdtempSync(join(tmpdir(), "hn-git-data-")), { git, schemes: ["file:"] });

test("parseGitSource splits a GitHub tree URL and refuses unsafe input", () => {
  assert.deepEqual(parseGitSource({ url: "https://github.com/oracle/netsuite-suitecloud-sdk/tree/ai-plugins-dist/anthropic/netsuite-suiteskills" }), {
    url: "https://github.com/oracle/netsuite-suitecloud-sdk",
    ref: "ai-plugins-dist",
    path: "anthropic/netsuite-suiteskills",
  });
  assert.deepEqual(parseGitSource({ url: "https://github.com/o/r.git", ref: "v1", path: "/a/b/" }), { url: "https://github.com/o/r.git", ref: "v1", path: "a/b" });
  assert.equal(parseGitSource({ url: "https://example.com/r" }).ref, "HEAD");
  assert.throws(() => parseGitSource({ url: "file:///etc" }), /https:\/\//);
  assert.throws(() => parseGitSource({ url: "ssh://git@github.com/o/r" }), /https:\/\//);
  assert.throws(() => parseGitSource({ url: "https://user:pw@github.com/o/r" }), /public repos/);
  assert.throws(() => parseGitSource({ url: "https://github.com/o/r", ref: "--upload-pack=touch /tmp/x" }), /characters/);
  assert.throws(() => parseGitSource({ url: "https://github.com/o/r", ref: "a..b" }), /characters/);
  assert.throws(() => parseGitSource({ url: "https://github.com/o/r", path: "../x" }), /plain path/);
});

test("a branch, an annotated tag and a SHA all resolve to the commit", async () => {
  const source = await repo();
  assert.equal(await resolveRef({ url: source.url, ref: "main" }, git), source.first);
  assert.equal(await resolveRef({ url: source.url, ref: "v1" }, git), source.first);
  assert.equal(await resolveRef({ url: source.url, ref: source.first }, git), source.first);
  await assert.rejects(resolveRef({ url: source.url, ref: "nope" }, git), /Can't find nope/);
});

test("git import pins the commit, fetches only the chosen folder, and drops symlinks", async () => {
  const source = await repo();
  const skills = storeFor();
  const preview = await skills.stageGit({ url: source.url, ref: "main", path: "anthropic/plug" });
  assert.deepEqual(preview.skills.map((item) => item.name), ["alpha", "beta"]);
  assert.deepEqual(preview.source, { kind: "git", url: source.url, ref: "main", sha: source.first, path: "anthropic/plug" });
  assert.ok(preview.skipped.some((item) => item.path === "anthropic/plug/skills/alpha/passwd.md" && item.reason === "Symbolic link"));
  assert.ok(!JSON.stringify(preview).includes("openai/other"), "files outside the folder are never read");
  skills.importStaged(preview.id, ["alpha"]);
  const row = skills.list()[0];
  assert.deepEqual(row.source, { kind: "git", url: source.url, ref: "main", sha: source.first, path: "anthropic/plug/skills/alpha" });
  assert.deepEqual(row.files.map((file) => file.path).sort(), ["SKILL.md", "references/a.md"]);
  assert.deepEqual(readdirSync(join(skills.dir, ".staging")), [], "the fetch folder is deleted");
  await assert.rejects(skills.stageGit({ url: source.url, ref: "main", path: "missing" }), /no folder missing/);
});

test("update says up to date, then shows added, changed and removed files after a new commit", async () => {
  const source = await repo();
  const skills = storeFor();
  skills.importStaged((await skills.stageGit({ url: source.url, ref: "main", path: "anthropic/plug" })).id, ["alpha"]);
  assert.deepEqual(await skills.update("alpha"), { upToDate: true, sha: source.first });

  source.put("anthropic/plug/skills/alpha/SKILL.md", skillMd("alpha", "New body."));
  source.put("anthropic/plug/skills/alpha/references/b.md", "B");
  await git(["rm", "-q", "anthropic/plug/skills/alpha/references/a.md"], source.dir);
  await git(["add", "-A"], source.dir);
  await git(["commit", "-q", "-m", "two"], source.dir);
  const second = (await git(["rev-parse", "HEAD"], source.dir)).trim();

  const result = await skills.update("alpha");
  assert.equal(result.upToDate, false);
  assert.equal(result.sha, second);
  assert.deepEqual(result.changes, { added: ["references/b.md"], changed: ["SKILL.md"], removed: ["references/a.md"] });
  assert.deepEqual(result.preview.skills.map((item) => item.name), ["alpha"]);
  skills.importStaged(result.preview.id, ["alpha"], ["alpha"]);
  assert.equal(skills.list()[0].source.sha, second);
  assert.match(readFileSync(join(skills.dir, "alpha", "SKILL.md"), "utf8"), /New body/);

  skills.importStaged(skills.stage([{ path: "z/SKILL.md", bytes: Buffer.from(skillMd("zipped")) }], { kind: "zip" }).id, ["zipped"]);
  await assert.rejects(skills.update("zipped"), /zip import\. Import it again/);
});

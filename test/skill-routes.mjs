import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { deflateRawSync, crc32 } from "node:zlib";
import { openSkillStore } from "../server/skills.mjs";
import { skillRoutes } from "../server/studio.mjs";

const skillMd = (name) => `---\nname: ${name}\ndescription: Does ${name} things.\n---\nBody of ${name}.\n`;
const b64 = (text) => Buffer.from(text).toString("base64");

function setup({ allowed = true } = {}) {
  const skills = openSkillStore(mkdtempSync(join(tmpdir(), "hn-routes-")));
  let sent = null;
  const routes = skillRoutes({
    skills,
    authorized: async (req, res) => {
      if (!allowed) res.statusCode = 401;
      return allowed;
    },
    sendJson: (res, status, body) => {
      sent = { status, body };
    },
  });
  // Calls a route the way the server does: errors become { status, error }.
  const call = async (key, body) => {
    sent = null;
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    try {
      await routes[key](req, {}, new URL("https://localhost/"));
    } catch (error) {
      return { status: error.status === 400 ? 400 : 500, body: { error: error.message } };
    }
    return sent;
  };
  return { skills, call };
}

// One stored zip entry, enough to prove the zip route unpacks.
function tinyZip(name, text) {
  const data = Buffer.from(text);
  const packed = deflateRawSync(data);
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBytes.length, 12);
  end.writeUInt32LE(30 + nameBytes.length + packed.length, 16);
  return Buffer.concat([local, nameBytes, packed, central, nameBytes, end]);
}

test("every skill route checks the session first", async () => {
  const { call } = setup({ allowed: false });
  for (const key of ["GET /api/skills", "POST /api/skills/stage", "POST /api/skills/import", "POST /api/skills/update", "POST /api/skills/toggle", "POST /api/skills/remove", "POST /api/skills/file"]) {
    assert.equal(await call(key, {}), null, `${key} answered without a session`);
  }
});

test("folder upload: stage, import the ticked skill, list, toggle, read a file, remove", async () => {
  const { call, skills } = setup();
  assert.deepEqual((await call("GET /api/skills")).body, { skills: [], shortened: 0 });
  const staged = await call("POST /api/skills/stage", {
    kind: "files",
    files: [
      { path: "p/skills/a/SKILL.md", base64: b64(skillMd("a")) },
      { path: "p/skills/a/run.py", base64: b64("print(1)") },
      { path: "p/skills/b/SKILL.md", base64: b64(skillMd("b")) },
      { path: "p/notes.bin", base64: b64("x") },
    ],
  });
  assert.equal(staged.status, 200);
  assert.deepEqual(staged.body.skills.map((item) => [item.name, item.fileCount, item.files]), [
    ["a", 2, undefined],
    ["b", 1, undefined],
  ]);
  assert.equal(staged.body.skippedCount, 1);

  const imported = await call("POST /api/skills/import", { stagedId: staged.body.id, names: ["a"] });
  assert.deepEqual(imported.body.imported, ["a"]);
  assert.equal(imported.body.skills[0].fileCount, 2);
  assert.equal(imported.body.skills[0].scripts, 1);
  assert.equal(imported.body.skills[0].files, undefined);

  const off = await call("POST /api/skills/toggle", { name: "a", enabled: false });
  assert.equal(off.body.skills[0].enabled, false);
  const head = await call("POST /api/skills/file", { name: "a" });
  assert.match(head.body.text, /^---\nname: a/);
  assert.deepEqual(head.body.files.map((item) => item.path).sort(), ["SKILL.md", "run.py"]);
  assert.equal((await call("POST /api/skills/file", { name: "a", path: "run.py" })).body.script, true);
  assert.equal((await call("POST /api/skills/file", { name: "a", path: "../../x" })).status, 400);

  const removed = await call("POST /api/skills/remove", { name: "a" });
  assert.deepEqual(removed.body.skills, []);
  assert.equal(skills.list().length, 0);
});

test("zip and Markdown uploads stage, and bad bodies are 400s", async () => {
  const { call } = setup();
  const zip = await call("POST /api/skills/stage", { kind: "zip", data: tinyZip("z/SKILL.md", skillMd("zipped")).toString("base64") });
  assert.deepEqual(zip.body.skills.map((item) => item.name), ["zipped"]);
  assert.deepEqual(zip.body.source, { kind: "zip" });

  const markdown = await call("POST /api/skills/stage", { kind: "markdown", fileName: "AGENTS.md", data: b64("Close the month."), playbook: { name: "month-end", description: "Month-end steps" } });
  assert.equal(markdown.body.skills[0].name, "month-end");
  assert.equal(markdown.body.skills[0].description, "Month-end steps");

  assert.match((await call("POST /api/skills/stage", { kind: "markdown", fileName: "x.exe", data: b64("x") })).body.error, /\.md or \.mdc/);
  assert.match((await call("POST /api/skills/stage", { kind: "zip", data: "not base64!" })).body.error, /base64/);
  assert.match((await call("POST /api/skills/stage", { kind: "files", files: [] })).body.error, /Choose a folder/);
  assert.match((await call("POST /api/skills/stage", { kind: "nope" })).body.error, /Choose a folder, a zip/);
  assert.match((await call("POST /api/skills/stage", { kind: "git", url: "file:///etc" })).body.error, /https/);
  assert.equal((await call("POST /api/skills/import", { stagedId: "../../x", names: ["a"] })).status, 400);
  assert.equal((await call("POST /api/skills/toggle", { name: "missing", enabled: true })).status, 400);
  assert.match((await call("POST /api/skills/update", { name: "missing" })).body.error, /No skill named missing/);
});

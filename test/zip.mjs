import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { openSkillStore, unzipSkills } from "../server/skills.mjs";
import { readZip } from "../server/zip.mjs";

// Builds a zip in memory. Each entry: { name, data, method = 8, mode, flags, size } where `size` overrides the declared size.
function makeZip(entries, { zip64 = false, disk = 0 } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data ?? "");
    const method = entry.method ?? 8;
    const packed = method === 8 ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(entry.size ?? data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.mode === undefined ? 20 : (3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(entry.size ?? data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(disk, 4);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  return Buffer.concat([...locals, directory, ...(zip64 ? [locator] : []), end]);
}

const limits = { fileLimit: 4_000_000, totalLimit: 60_000_000, maxEntries: 2500 };
const skill = "---\nname: zipped\ndescription: From a zip.\n---\nBody.\n";

test("stored and deflated files come out byte for byte, folders and __MACOSX are left out", () => {
  const { files, skipped } = readZip(
    makeZip([
      { name: "zipped/", data: "" },
      { name: "zipped/SKILL.md", data: skill, method: 0 },
      { name: "zipped/references/a.md", data: "deflated ".repeat(200) },
      { name: "__MACOSX/zipped/._SKILL.md", data: "junk" },
    ]),
    limits,
  );
  assert.deepEqual(
    files.map((file) => [file.path, file.bytes.toString()]),
    [
      ["zipped/SKILL.md", skill],
      ["zipped/references/a.md", "deflated ".repeat(200)],
    ],
  );
  assert.deepEqual(skipped, []);
});

test("symlinks and other special entries are dropped and listed", () => {
  const { files, skipped } = readZip(
    makeZip([
      { name: "zipped/SKILL.md", data: skill, mode: 0o100644 },
      { name: "zipped/link.md", data: "/etc/passwd", mode: 0o120777 },
      { name: "zipped/fifo", data: "", mode: 0o010644 },
    ]),
    limits,
  );
  assert.deepEqual(files.map((file) => file.path), ["zipped/SKILL.md"]);
  assert.deepEqual(skipped, [
    { path: "zipped/link.md", reason: "Symbolic link" },
    { path: "zipped/fifo", reason: "Not a regular file" },
  ]);
});

test("encrypted, zip64, multi-disk, damaged and non-zip input is refused", () => {
  assert.throws(() => readZip(makeZip([{ name: "a.md", data: "x", flags: 1 }]), limits), /Encrypted/);
  assert.throws(() => readZip(makeZip([{ name: "a.md", data: "x" }], { zip64: true }), limits), /Zip64/);
  assert.throws(() => readZip(makeZip([{ name: "a.md", data: "x" }], { disk: 1 }), limits), /Multi-part/);
  assert.throws(() => readZip(Buffer.from("plain text, not a zip at all"), limits), /not a zip/);
  const broken = makeZip([{ name: "a.md", data: "hello world", method: 0 }]);
  broken[30 + "a.md".length] ^= 0xff;
  assert.throws(() => readZip(broken, limits), /damaged/);
});

test("a zip bomb stops at the file limit, whatever size it declares", () => {
  const { files, skipped } = readZip(
    makeZip([
      { name: "s/SKILL.md", data: skill },
      { name: "s/bomb.json", data: Buffer.alloc(limits.fileLimit + 1), size: 10 },
    ]),
    limits,
  );
  assert.deepEqual(files.map((file) => file.path), ["s/SKILL.md"]);
  assert.deepEqual(skipped, [{ path: "s/bomb.json", reason: "File over 4 MB" }]);
});

test("the total limit and the entry limit stop an import early", () => {
  const four = Array.from({ length: 4 }, (_, index) => ({ name: `s/${index}.json`, data: Buffer.alloc(1000) }));
  assert.throws(() => readZip(makeZip(four), { ...limits, totalLimit: 3500 }), /over 60 MB/);
  assert.throws(() => readZip(makeZip(four), { ...limits, maxEntries: 3 }), /more than 3 files/);
  assert.throws(() => readZip(makeZip(four), { ...limits, maxEntries: 0 }), /4 entries\. The limit is 0 files/);
  const folders = four.flatMap((entry, index) => [{ name: `d${index}/`, data: "" }, { name: `__MACOSX/${entry.name}`, data: "x" }, entry]);
  assert.equal(readZip(makeZip(folders), { ...limits, maxEntries: 4 }).files.length, 4, "folder and __MACOSX entries don't count");
});

test("a zip stages like a folder, with the dropped entries in the skipped list", () => {
  const skills = openSkillStore(mkdtempSync(join(tmpdir(), "hn-zip-")));
  const unpacked = unzipSkills(
    makeZip([
      { name: "zipped/SKILL.md", data: skill, mode: 0o100644 },
      { name: "zipped/link.md", data: "/etc/passwd", mode: 0o120777 },
    ]),
  );
  const preview = skills.stage(unpacked.files, { kind: "zip" }, { skipped: unpacked.skipped });
  assert.deepEqual(preview.skills.map((item) => item.name), ["zipped"]);
  assert.equal(preview.skippedCount, 1);
  assert.equal(preview.skipped[0].reason, "Symbolic link");
  skills.importStaged(preview.id, ["zipped"]);
  assert.deepEqual(skills.list()[0].source, { kind: "zip" });
});

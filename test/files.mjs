import assert from "node:assert/strict";
import test from "node:test";
import { classifyPreview, joinCabinetFile } from "../server/studio.mjs";

test("a file can only be joined onto a folder inside the cabinet", () => {
  assert.equal(joinCabinetFile("/Images", "note.txt"), "/Images/note.txt");
  assert.equal(joinCabinetFile("Images/", "note.txt"), "/Images/note.txt");
  assert.throws(() => joinCabinetFile("/", "note.txt"), /top level/);
  assert.throws(() => joinCabinetFile("/Images", "../note.txt"), /not valid/);
});

test("text and pictures can be shown, and other bytes cannot", () => {
  assert.equal(classifyPreview(Buffer.from("hello").toString("base64")).text, "hello");
  assert.equal(classifyPreview(Buffer.from("x").toString("base64"), "image/png").kind, "image");
  assert.equal(classifyPreview(Buffer.from([0, 1, 2]).toString("base64")).kind, "binary");
  assert.match(classifyPreview(Buffer.alloc(1_500_001).toString("base64")).note, /too large/);
});

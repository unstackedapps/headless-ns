import assert from "node:assert/strict";
import test from "node:test";
import { inlineSpans, markdownBlocks } from "../src/markdown.ts";

test("assistant markdown keeps headings, emphasis, and code", () => {
  const blocks = markdownBlocks("Hello **there**.\n### Tools\n1. Run `ns_runReport`\n2. Read the rows");
  assert.equal(blocks[0].type, "p");
  assert.deepEqual(inlineSpans(blocks[0].text).map((span) => span.kind), ["text", "strong", "text"]);
  assert.equal(blocks[1].type, "h");
  assert.equal(blocks[2].type, "ol");
  assert.equal(blocks[2].items[0], "Run `ns_runReport`");
  const smashed = markdownBlocks("Skills include: ### Data");
  assert.equal(smashed[1].type, "h");
  assert.equal(smashed[1].text, "Data");
});

test("a code fence stays literal and links stay on https", () => {
  const fenced = markdownBlocks("```\n**not bold**\n```");
  assert.equal(fenced[0].type, "pre");
  assert.equal(fenced[0].text, "**not bold**");
  const spans = inlineSpans("[Docs](https://example.com/a) and [no](javascript:alert(1))");
  assert.equal(spans.find((span) => span.kind === "link")?.href, "https://example.com/a");
  assert.equal(spans.some((span) => span.text.includes("javascript:")), true);
});

test("Ask's steps use plain words instead of tool names", async () => {
  const { stepText, toolTitle } = await import("../src/steps.ts");
  assert.equal(stepText({ name: "ns_runCustomSuiteQL", ok: true }), "Ran a SuiteQL query");
  assert.equal(stepText({ name: "ns_createRecord", ok: false, error: "Writes are off in Settings." }), "Could not create a record. Writes are off in Settings.");
  assert.equal(stepText({ name: "ns_getFooBar", ok: true }), "Called get foo bar");
  assert.equal(toolTitle("ns_runReport"), "Run a report");
});

test("a Markdown table becomes rows and cells, and a lone pipe line stays text", () => {
  const blocks = markdownBlocks("Top vendors:\n| # | Vendor | Spend |\n|---|:---|---:|\n| 1 | **China Manufacturer** | 978,708.02 |\n| 2 | Brocade |\n\nDone.");
  assert.deepEqual(blocks.map((block) => block.type), ["p", "table", "p"]);
  assert.deepEqual(blocks[1].head, ["#", "Vendor", "Spend"]);
  assert.deepEqual(blocks[1].rows, [
    ["1", "**China Manufacturer**", "978,708.02"],
    ["2", "Brocade"],
  ]);
  assert.equal(markdownBlocks("a | b | c")[0].type, "p");
  assert.equal(markdownBlocks("| not a table |\nnext line")[0].type, "p");
});

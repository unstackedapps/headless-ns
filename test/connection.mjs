import assert from "node:assert/strict";
import test from "node:test";
import { plainConnectionError } from "../server/osmcp.mjs";

test("setup's test read explains NetSuite failures in plain words", () => {
  const status = (code, message = "") => Object.assign(new Error(message), { status: code });
  assert.equal(plainConnectionError(status(401, "NetSuite rejected the call (401).")), "NetSuite did not accept the sign-in. Sign in again.");
  assert.match(plainConnectionError(status(403)), /missing a permission\. Add MCP Server Connection/);
  assert.match(plainConnectionError(new Error("Insufficient permission for this tool")), /missing a permission/);
  assert.match(plainConnectionError(status(404)), /MCP Standard Tools SuiteApp is installed/);
  assert.match(plainConnectionError(new TypeError("fetch failed")), /could not reach the server/);
  assert.equal(plainConnectionError(new Error("This role cannot see customer.")), "NetSuite said: This role cannot see customer.");
});

test("an old OpenSuiteMCP .env still connects, as a custom MCP server", async () => {
  const { connector, customMcpToken, customMcpUrl } = await import("../server/env.mjs");
  const keys = ["CONNECTOR", "MCP_URL", "MCP_TOKEN", "OSMCP_URL", "OSMCP_TOKEN"];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, { CONNECTOR: "opensuitemcp", MCP_URL: "", MCP_TOKEN: "", OSMCP_URL: "https://self.example/api/mcp", OSMCP_TOKEN: "old-token" });
    assert.equal(connector(), "custom");
    assert.equal(customMcpUrl(), "https://self.example/api/mcp");
    assert.equal(customMcpToken(), "old-token");
    Object.assign(process.env, { CONNECTOR: "", MCP_URL: "https://new.example/mcp", MCP_TOKEN: "new-token" });
    assert.equal(connector(), "custom");
    assert.equal(customMcpUrl(), "https://new.example/mcp");
    Object.assign(process.env, { MCP_TOKEN: "", OSMCP_TOKEN: "" });
    assert.equal(connector(), "netsuite");
  } finally {
    for (const key of keys) {
      if (before[key] == null) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test("a server with no NetSuite tools fails the test read with the reason", async () => {
  const { missingNetSuiteTools } = await import("../server/osmcp.mjs");
  assert.match(missingNetSuiteTools(["osmcp_whoami", "osmcp_recall"]), /answered with 2 tools, but none are NetSuite tools/);
  assert.equal(missingNetSuiteTools(["osmcp_whoami", "ns_getSessionInfo"]), "");
  assert.match(plainConnectionError(new Error("Method not found: tools/call ns_getSessionInfo")), /does not offer the NetSuite tools/);
});

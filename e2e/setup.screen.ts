import { expect, test, type Page } from "@playwright/test";
import { failWith, mockApi, session } from "./mock";

const connector = {
  kind: "netsuite",
  accountId: "",
  accountMissing: true,
  redirectUri: "https://localhost:5173/api/auth/callback",
  customUrl: "",
  customHint: "",
  mcpClientId: "",
  mcpSecretHint: "",
  mcpConfidential: false,
  suite: "all",
  netsuiteMcpUrl: "",
  mcpSignedIn: false,
};

const providers = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-5.2", needsBaseUrl: false },
  { id: "compatible", label: "OpenAI-compatible", defaultModel: "", needsBaseUrl: true },
];

const config = { llm: { configured: false, model: "" }, models: { activeId: null, connections: [], providers } };
// Overview after Open Overview, with nothing to show.
const overview = { "/api/overview": { year: 2026, metrics: {} }, "/api/activity": { year: 2026, rows: [] } };
const passed = { accountId: "td3138390", roleId: "customrole_opensuitemcp", customers: 42 };

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("first run asks only for the NetSuite fields, then signs in with NetSuite", async ({ page }) => {
  const writes = await mockApi(page, {
    "/api/session": { ...session, signedIn: false, ai: false },
    "/api/connector": connector,
    "POST /api/config/connector": connector,
    "/api/auth/mcp/login": {},
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up headless-ns" })).toBeVisible();
  await expect(page.locator("[aria-current=step]")).toHaveText("1. Connect NetSuite");
  await expect(page.getByLabel("Bearer token")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

  await pick(page, "Connection", "Custom MCP server");
  await expect(page.getByLabel("Server URL")).toBeVisible();
  await expect(page.getByLabel("Bearer token")).toBeVisible();
  await expect(page.getByLabel("Account ID")).toHaveCount(0);
  await pick(page, "Connection", "NetSuite OAuth");

  await page.getByLabel("Account ID").fill("td3138390");
  await page.getByLabel("Client ID").fill("client-123");
  await expect(page.getByLabel("Client secret")).toHaveCount(0);
  await expect(page.getByLabel("Public client")).toBeChecked();
  await page.getByLabel("Public client").uncheck();
  await page.getByLabel("Client secret").fill("secret-456");
  await page.getByRole("button", { name: "Sign in with NetSuite" }).click();
  await page.waitForURL(/\/api\/auth\/mcp\/login$/);
  // The saved Every SuiteApp choice survives, because setup sends saved values with its edits.
  expect(writes.find((write) => write.path === "/api/config/connector")?.body).toMatchObject({
    kind: "netsuite",
    accountId: "td3138390",
    mcpClientId: "client-123",
    clientType: "confidential",
    mcpClientSecret: "secret-456",
    suite: "all",
  });
});

test("Next waits for a passing test read, and a failed read shows NetSuite's reason", async ({ page }) => {
  let reads = 0;
  await mockApi(page, {
    "/api/session": { ...session, ai: false },
    "/api/connector": { ...connector, accountId: "td3138390", accountMissing: false, mcpClientId: "client-123", mcpSignedIn: true },
    "/api/config": config,
    "POST /api/setup/test": () => (++reads === 1 ? failWith(400, "The role you signed in with is missing a permission.") : passed),
  });
  await page.goto("/#/setup/netsuite");
  await expect(page.getByText("The role you signed in with is missing a permission.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await page.getByRole("button", { name: "Test again" }).click();
  await expect(page.getByText("Connected to TD3138390 as customrole_opensuitemcp.")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator("[aria-current=step]")).toHaveText("2. Connect the AI");
});

test("the AI step lists the provider's models, and Finish waits for a test reply", async ({ page }) => {
  let ai = false;
  const writes = await mockApi(page, {
    ...overview,
    "/api/session": () => ({ ...session, ai }),
    "/api/connector": { ...connector, accountId: "td3138390", mcpClientId: "client-123", mcpSignedIn: true },
    "/api/config": config,
    "POST /api/setup/test": passed,
    "POST /api/models/list": { models: ["gemma-4-27b", "gemma-4-9b"] },
    "POST /api/models/test": { reply: "ready" },
    "POST /api/models": () => {
      ai = true;
      return config.models;
    },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Next" }).click();
  await pick(page, "Provider", "OpenAI-compatible");
  await expect(page.getByRole("combobox", { name: "Model" })).toBeDisabled();
  await page.getByLabel("Provider URL").fill("https://gemma.example/v1");
  await page.getByLabel("API key").fill("sk-test");
  await page.getByRole("combobox", { name: "Model" }).fill("27");
  await page.getByRole("option", { name: "gemma-4-27b" }).click();
  await expect(page.getByRole("button", { name: "Finish" })).toBeDisabled();
  await page.getByRole("button", { name: "Send test message" }).click();
  await expect(page.getByText("The model replied: ready")).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("You're all set. NetSuite and Ask are ready.")).toBeVisible();
  expect(writes.find((write) => write.path === "/api/models/list")?.body).toEqual({ provider: "compatible", baseUrl: "https://gemma.example/v1", apiKey: "sk-test" });
  expect(writes.find((write) => write.path === "/api/models")?.body).toMatchObject({ model: "gemma-4-27b", activate: true });
  await page.getByRole("button", { name: "Open Overview" }).click();
  await expect(page).toHaveURL(/#\/overview$/);
  await expect(page.getByRole("button", { name: "Command line" })).toBeVisible();
});

test("skipping the AI step opens the app, and Ask links back to that step", async ({ page }) => {
  await mockApi(page, {
    ...overview,
    "/api/session": { ...session, ai: false },
    "/api/connector": { ...connector, accountId: "td3138390", mcpClientId: "client-123", mcpSignedIn: true },
    "/api/config": config,
    "POST /api/setup/test": passed,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByText("To turn on Ask later, add a model in Settings.")).toBeVisible();
  await page.getByRole("button", { name: "Open Overview" }).click();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "Ask" });
  await expect(drawer.getByLabel("Question")).toHaveCount(0);
  await drawer.getByRole("link", { name: "Connect an AI model" }).click();
  await expect(page.getByRole("heading", { name: "Connect the AI" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save model" })).toBeDisabled();
});

test("Settings keeps the optional connection fields and reopens one step", async ({ page }) => {
  const writes = await mockApi(page, {
    "/api/session": session,
    "/api/connector": { ...connector, accountId: "td3138390", mcpClientId: "client-123", mcpSignedIn: true },
    "/api/config": { ...config, accountId: "TD3138390", permissions: {}, features: [], policy: { allowWrites: false, disabled: [] } },
    "/api/tools": { tools: [] },
    "POST /api/config/connector": connector,
    "POST /api/setup/test": passed,
  });
  await page.goto("/#/settings");
  await expect(page.getByLabel("Account ID")).toHaveCount(0);
  await expect(page.getByLabel("Client secret")).toHaveCount(0);
  await pick(page, "Tools", "Standard tools");
  await page.getByRole("button", { name: "Save connection settings" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  const saved = writes.find((write) => write.path === "/api/config/connector")?.body;
  expect(saved).toMatchObject({ kind: "netsuite", accountId: "td3138390", suite: "standard" });
  expect(saved.clientType).toBeUndefined();

  await page.getByRole("link", { name: "Change connection" }).click();
  await expect(page.getByRole("heading", { name: "Connect NetSuite" })).toBeVisible();
  await expect(page.locator("[aria-current=step]")).toHaveCount(0);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/#\/overview$/);
});

test("a custom MCP server, such as self-hosted OpenSuiteMCP, takes a URL and a token, then tests", async ({ page }) => {
  let saved = false;
  const writes = await mockApi(page, {
    "/api/session": () => (saved ? { ...session, via: "custom", ai: false } : { ...session, signedIn: false, via: "custom", ai: false }),
    "/api/connector": connector,
    "POST /api/config/connector": () => {
      saved = true;
      return { ...connector, kind: "custom", customUrl: "https://mcp.example.com/api/mcp", customHint: "…oken" };
    },
    "POST /api/setup/test": passed,
  });
  await page.goto("/");
  await pick(page, "Connection", "Custom MCP server");
  await page.getByLabel("Server URL").fill("https://mcp.example.com/api/mcp");
  await page.getByLabel("Bearer token").fill("osmcp-token");
  await page.getByRole("button", { name: "Save and test" }).click();
  await expect(page.getByText("Connected to TD3138390")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
  expect(writes.find((write) => write.path === "/api/config/connector")?.body).toMatchObject({
    kind: "custom",
    customUrl: "https://mcp.example.com/api/mcp",
    customToken: "osmcp-token",
  });
});

test("a saved custom server is tested on load, so its failure shows after a reload", async ({ page }) => {
  await mockApi(page, {
    "/api/session": { ...session, signedIn: false, via: "custom", ai: true },
    "/api/connector": { ...connector, kind: "custom", customUrl: "https://app.opensuitemcp.com/api/mcp", customHint: "…oken" },
    "POST /api/setup/test": failWith(400, "The server answered with 34 tools, but none are NetSuite tools (ns_...)."),
  });
  await page.goto("/#/setup/netsuite");
  await expect(page.getByText("none are NetSuite tools")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Test again" })).toBeVisible();
});

test("setup's how-to names where each feature lives, the role's records, the integration's state and scope, and the tested custom servers", async ({ page }) => {
  await mockApi(page, {
    "/api/session": { ...session, signedIn: false, ai: false },
    "/api/connector": connector,
  });
  await page.goto("/");
  await page.getByText("How to set this up").click();
  const steps = page.locator("ol.steps");
  await expect(steps).toContainText("Check Server SuiteScript on the SuiteCloud tab");
  await expect(steps).toContainText("REST Web Services under Web Services");
  await expect(steps).toContainText("OAuth 2.0 under Manage Authentication");
  await expect(steps).toContainText("SuiteCloud > SuiteApp Marketplace and install MCP Standard Tools");
  await expect(steps).toContainText("customers, vendors, items, transactions, and files");
  await expect(steps).toContainText("Assign the role to each person who signs in.");
  await expect(steps).toContainText("set State to Enabled");
  await expect(steps).toContainText("check only NetSuite AI Connector Service");
  await expect(steps).toContainText("https://localhost:5173/api/auth/callback");

  await pick(page, "Connection", "Custom MCP server");
  await expect(steps).toContainText("OpenSuiteMCP and Mint (Mintive) are tested");
  await expect(steps).toContainText("https://app.mintmcp.com/oauth/callback");
  await expect(steps).toContainText("In Mint, install NetSuite from the MCP store");
  await expect(steps).toContainText("In Mint, open the Virtual MCP, copy its URL, and create an API key");
  await expect(page.getByLabel("Server URL")).toHaveAttribute("placeholder", "https://your-server/mcp");
  await expect(page.getByText("opensuitemcp.com")).toHaveCount(0);
});

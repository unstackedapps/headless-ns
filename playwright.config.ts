import { defineConfig } from "@playwright/test";

// Tests run against the dev server on https://localhost:5173 (the only port the NetSuite integration allows).
// Start it with `npm run dev` first. The certificate is self-signed, so the test browser accepts it.
export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/results",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "https://localhost:5173",
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "screens", testMatch: /\.screen\.ts$/ },
    // Live tests write to NetSuite. They run only with `npm run e2e:live`.
    { name: "live", testMatch: /\.live\.ts$/, timeout: 240_000 },
  ],
});

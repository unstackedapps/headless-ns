import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The client reads no env vars. Looking for them outside the root stops a full page reload each time setup saves .env.
  envDir: "server",
  // Playwright writes trace .html files while tests run, and skill imports write .js and .html files to data/skills.
  // Watching either reloads the open app and drops what is on screen.
  server: { watch: { ignored: ["**/e2e/results/**", "**/test-results/**", "**/playwright-report/**", "**/data/**"] } },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The client reads no env vars. Looking for them outside the root stops a full page reload each time setup saves .env.
  envDir: "server",
  // Playwright writes trace .html files while tests run. Watching them reloads the open app every second.
  server: { watch: { ignored: ["**/e2e/results/**", "**/test-results/**", "**/playwright-report/**"] } },
});

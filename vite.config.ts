import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The client reads no env vars. Looking for them outside the root stops a full page reload each time setup saves .env.
  envDir: "server",
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on NTNP_PORT (default 5350) and Vite on VITE_PORT (default 5360); /api is proxied.
const api = { target: `http://127.0.0.1:${Number(process.env.NTNP_PORT) || 5350}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 5360, strictPort: true, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js" },
});

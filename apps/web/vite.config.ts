import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Absolute imports from src root
      "@": resolve(__dirname, "src"),
      // Resolve @servrsit/ui directly from source so Vite transpiles it.
      // This avoids needing a pre-built dist/ during development.
      "@servrsit/ui": resolve(__dirname, "../../packages/ui/src/index.ts"),
    },
  },
  css: {
    devSourcemap: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Dev only: bind to the founder's Tailscale address so the tailnet can
    // reach it. Do not widen to all interfaces.
    host: "100.104.220.8",
    // Dev only: forward /api to the local API so the browser stays same-origin.
    // Override the target with SERVRSIT_API_URL to reach a second API instance.
    proxy: {
      "/api": {
        target: process.env["SERVRSIT_API_URL"] ?? "http://127.0.0.1:3001",
        changeOrigin: false,
      },
    },
  },
  // Prevent Vite from pre-bundling workspace packages that we resolve
  // directly from TypeScript source.
  optimizeDeps: {
    exclude: ["@servrsit/ui"],
  },
});

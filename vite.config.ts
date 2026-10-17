import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { target: "es2022" },
  // In dev, /api goes to the Node server (npm run dev:server).
  server: { proxy: { "/api": "http://localhost:8787" } },
  test: { include: ["tests/**/*.test.ts", "server/tests/**/*.test.ts"] },
});

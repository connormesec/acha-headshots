import { defineConfig, devices } from "@playwright/test";

// Runs against the production build (npm run build first), so the CSP is the real one.
// PW_CHANNEL=chrome or msedge uses an installed browser instead of Playwright's own Chromium.
// PW_WEBKIT=1 adds WebKit (needs `npx playwright install webkit`).
const channel = process.env.PW_CHANNEL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 5 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:4173", acceptDownloads: true },
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) } },
    ...(process.env.PW_WEBKIT ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }] : []),
  ],
});

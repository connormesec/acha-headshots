import { defineConfig, devices } from "@playwright/test";

// Runs against the production build and the real Node server (npm run build first), so the CSP and
// headers are the real ones. AI help uses the free, filename-driven mock.
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
    command: "node server-dist/index.mjs",
    url: "http://localhost:4173/api/health",
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: "4173",
      ADMIN_PASSWORD: "e2e-password",
      SESSION_SECRET: "e2e-session-secret-e2e-session-secret",
      VISION_PROVIDER: "mock",
      E2E_TEST_HOOKS: "1",
      NODE_ENV: "test",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) } },
    ...(process.env.PW_WEBKIT ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }] : []),
  ],
});

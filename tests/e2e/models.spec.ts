// The real models (not the ?mockcv mocks) load and run under the production CSP and
// cross-origin isolation: MediaPipe for people, ONNX Runtime for the number reader.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("sorting runs with the real models, without CSP or console errors", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.text().startsWith("INFO: ")) return; // MediaPipe's XNNPACK notice
    if (m.type() === "error" || /Content Security Policy/i.test(m.text())) problems.push(`console: ${m.text()}`);
  });

  await page.goto("/#/teams/new");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await page.getByRole("tab", { name: /Type it in/ }).click();
  await page.locator("textarea").fill(readFileSync("test-fixtures/demo-roster.txt", "utf8"));
  await page.getByLabel("Team name").fill("MSU Hockey");
  await page.getByRole("button", { name: /Create team/ }).click();
  await expect(page.getByRole("heading", { name: "MSU Hockey" })).toBeVisible();

  await page.goto("/#/jobs/new");
  await page.getByTestId("sort-files-input").setInputFiles("test-fixtures/demo-game.zip");
  await page.getByRole("button", { name: /^Start for MSU Hockey/ }).click();
  await expect(page.getByRole("heading", { name: "MSU Hockey" })).toBeVisible({ timeout: 4 * 60_000 });
  await expect(page.locator(".stat").filter({ hasText: "Total photos" }).locator(".stat__value")).toHaveText("23");
  await expect(page.locator(".stat").filter({ hasText: "Failed" }).locator(".stat__value")).toHaveText("1");
  expect(problems).toEqual([]);
});

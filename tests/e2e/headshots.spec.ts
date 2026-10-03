// End to end: ZIP in → review → rename → reload + continue → make files → check the download.
// Needs `npm run fixtures` and `npm run build` first.
import { expect, test, type Page } from "@playwright/test";
import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { readFileSync } from "node:fs";
import sharp from "sharp";

const FIXTURES = "test-fixtures/fixtures.zip";

const cards = (page: Page) => page.locator("[data-item-id]");
const card = (page: Page, original: string) => cards(page).filter({ has: page.getByAltText(`Crop of ${original}`) });

/** Every card's file name and crop, to compare before and after a reload. */
async function snapshot(page: Page) {
  return cards(page).evaluateAll((els) => els.map((el) => ({
    name: (el.querySelector("input[data-name-field]") as HTMLInputElement).value,
    crop: el.querySelector(".crop-preview img")?.getAttribute("style") ?? "",
  })).sort((a, b) => a.name.localeCompare(b.name)));
}

test("ZIP to ACHA files, entirely in the browser", async ({ page }) => {
  const requests: { url: string; method: string }[] = [];
  const problems: string[] = [];
  page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // MediaPipe logs "INFO: Created TensorFlow Lite XNNPACK delegate for CPU." through console.error.
    if (m.text().startsWith("INFO: ")) return;
    if (m.type() === "error" || /Content Security Policy/i.test(m.text())) problems.push(`console: ${m.text()}`);
  });

  await page.goto("/");
  await page.getByTestId("files-input").setInputFiles(FIXTURES);
  await expect(page.getByText("fixtures.zip", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Crop my photos →" }).click();

  // Review screen (the processing screen says "Step 2 of 3" too; only review has the action bar).
  await expect(page.locator(".hs-bar")).toBeVisible({ timeout: 4 * 60_000 });
  const skipped = page.locator(".hs-skipped");
  await expect(skipped.locator("summary")).toContainText("1 file couldn't be opened · 1 skipped");
  await skipped.locator("summary").click();
  await expect(skipped).toContainText("broken.jpg: This file couldn't be opened");
  await expect(skipped).toContainText("notes.txt: not a photo we can use");
  await expect(skipped).not.toContainText("DS_Store");
  await expect(skipped).not.toContainText("MACOSX");
  await expect(cards(page)).toHaveCount(8);

  // Rename one photo (Enter saves and moves on).
  const nameInput = card(page, "rotated.jpg").locator("input[data-name-field]");
  await nameInput.fill("red_blue12");
  await nameInput.press("Enter");
  await expect(nameInput).toHaveValue("red_blue12");
  await expect(page.locator(".name-field__error")).toHaveCount(0);

  // Reload mid-review: Continue brings back the same items, crops and names.
  const before = await snapshot(page);
  await page.waitForTimeout(600); // let the debounced save land
  await page.reload();
  await expect(page.getByText(/Continue your batch "fixtures" \(9 photos\)/)).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".hs-bar")).toBeVisible();
  await expect(cards(page)).toHaveCount(8);
  expect(await snapshot(page)).toEqual(before);

  // Make files and download.
  await page.getByRole("button", { name: /make ACHA files/ }).click();
  await page.getByRole("button", { name: "Make files anyway" }).click();
  const downloadButton = page.getByRole("button", { name: "Download ZIP" });
  await expect(downloadButton).toBeVisible({ timeout: 4 * 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  expect(download.suggestedFilename()).toBe("fixtures - ACHA headshots.zip");
  const zipPath = await download.path();

  // Open the ZIP in Node and check every file.
  const reader = new ZipReader(new BlobReader(new Blob([readFileSync(zipPath)])));
  const entries = await reader.getEntries();
  const names = entries.map((e) => e.filename).sort();
  expect(names).toEqual(before.map((b) => `${b.name}.jpg`).sort());
  expect(names).toContain("red_blue12.jpg");
  for (const entry of entries) {
    if (entry.directory) continue;
    const data = Buffer.from(await entry.getData(new Uint8ArrayWriter()));
    const meta = await sharp(data).metadata();
    expect.soft(meta.format, entry.filename).toBe("jpeg");
    expect.soft([meta.width, meta.height], entry.filename).toEqual([1000, 1500]);
    expect.soft(data.length, entry.filename).toBeLessThanOrEqual(2_000_000);
    expect.soft(meta.orientation, entry.filename).toBeUndefined();
    expect.soft(meta.exif, entry.filename).toBeUndefined();
    if (entry.filename === "noisy.jpg") expect(data.length, "noise should survive the downscale").toBeGreaterThan(1_000_000);
    if (entry.filename === "red_blue12.jpg") {
      const pixel = async (x: number, y: number) =>
        [...(await sharp(data).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer())];
      const [top, bottom] = [await pixel(500, 20), await pixel(500, 1480)];
      expect(top[0]).toBeGreaterThan(200); expect(top[2]).toBeLessThan(60);     // red
      expect(bottom[2]).toBeGreaterThan(200); expect(bottom[0]).toBeLessThan(60); // blue
    }
  }
  await reader.close();

  // Nothing left the device: same-origin GETs only.
  const origin = new URL(page.url()).origin;
  const network = requests.filter((r) => /^https?:/.test(r.url));
  expect(network.length).toBeGreaterThan(0);
  for (const r of network) {
    expect.soft(new URL(r.url).origin, r.url).toBe(origin);
    expect.soft(r.method, r.url).toBe("GET");
  }
  expect(problems).toEqual([]);
});

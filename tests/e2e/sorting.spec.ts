// Photo sorting end to end, with the filename-driven mocks (?mockcv) for people and numbers and the
// server's mock AI model. Needs `npm run fixtures` and `npm run build` first.
//
// The point of these tests: everyone can sort, but only an admin's job ever reaches the paid AI
// endpoint, and only for numbers the local reader couldn't make out.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { readFileSync } from "node:fs";

const GAME = "test-fixtures/demo-game.zip";
const ROSTER = readFileSync("test-fixtures/demo-roster.txt", "utf8");
const PASSWORD = "e2e-password";

async function serverVisionCalls(request: APIRequestContext) {
  return (await (await request.get("/api/test/vision-calls")).json()).calls as number;
}

function watch(page: Page) {
  const vision: string[] = [];
  const problems: string[] = [];
  page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api/vision")) vision.push(r.url()); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.text().startsWith("INFO: ")) return;
    if (m.type() === "error" || /Content Security Policy/i.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  return { vision, problems };
}

async function addTeam(page: Page) {
  await page.goto("/?mockcv#/teams/new");
  await page.getByRole("tab", { name: /Type it in/ }).click();
  await page.locator("textarea").fill(ROSTER);
  await page.getByLabel("Team name").fill("MSU Hockey");
  await page.getByRole("button", { name: /Create team with 10 players/ }).click();
  await expect(page.getByRole("heading", { name: "MSU Hockey" })).toBeVisible();
}

async function sortGame(page: Page, ai: boolean | null) {
  await page.goto("/?mockcv#/jobs/new");
  await page.getByTestId("sort-files-input").setInputFiles(GAME);
  await expect(page.getByText("demo-game.zip")).toBeVisible();
  const toggle = page.getByRole("checkbox", { name: /AI help/ });
  if (ai === null) await expect(toggle).toHaveCount(0); // not offered to non-admins
  else await toggle.setChecked(ai);
  await page.getByRole("button", { name: /^Start for MSU Hockey/ }).click();
  await expect(page.getByRole("heading", { name: "MSU Hockey" })).toBeVisible({ timeout: 2 * 60_000 }); // results page
}

const stat = (page: Page, label: string) => page.locator(".stat").filter({ hasText: label }).locator(".stat__value");

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset", { data: {}, headers: { Origin: "http://localhost:4173" } });
});

test("anyone can sort a game; nothing is sent to the AI", async ({ page, request }) => {
  const { vision, problems } = watch(page);
  await addTeam(page);
  await sortGame(page, null);

  // 23 photos: 13 read locally, 9 waiting for a person (unreadable or unclear numbers), 1 broken.
  await expect(stat(page, "Total photos")).toHaveText("23");
  await expect(stat(page, "Fully identified")).toHaveText("13");
  await expect(stat(page, "Need review")).toHaveText("9");
  await expect(stat(page, "Failed")).toHaveText("1");

  // Review: the first undecided person is IMG_011 (#27, unreadable). Pick Bob Johnson from the roster.
  await page.getByRole("link", { name: "Start review" }).click();
  await expect(page.getByText("9 left to decide")).toBeVisible();
  await expect(page.locator(".review__caption")).toContainText("IMG_011_v27.jpg");
  await page.locator(".roster-pick").getByRole("button", { name: /Bob Johnson/ }).click();
  await expect(page.getByRole("status")).toContainText("Assigned Bob Johnson #27");

  // Export: per-player folders of the originals, plus a manifest.
  await page.getByRole("link", { name: "Results" }).click();
  await expect(stat(page, "Fully identified")).toHaveText("14");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download ZIP" }).click()]);
  expect(download.suggestedFilename()).toBe("demo-game - sorted.zip");
  const zip = new ZipReader(new BlobReader(new Blob([readFileSync(await download.path())])));
  const entries = await zip.getEntries();
  const names = entries.map((e) => e.filename);
  expect(names).toContain("export/Bob Johnson - 27/IMG_011_v27.jpg");
  expect(names).toContain("export/John Smith - 7/IMG_013_7_12.jpg");
  expect(names).toContain("export/Mike Jones - 12/IMG_013_7_12.jpg");
  expect(names).toContain("export/NEEDS REVIEW/IMG_015_q27.jpg");
  expect(names).toContain("export/manifest.csv");
  expect(names.some((n) => n.includes("IMG_021_corrupt"))).toBe(false);
  const manifest = await entries.find((e) => e.filename === "export/manifest.csv")!.getData!(new TextWriter());
  expect(manifest.split("\n")[0]).toBe("photo,player_id,player_name,jersey_number,confidence,status");
  await zip.close();

  expect(vision).toEqual([]);
  expect(await serverVisionCalls(request)).toBe(0);
  expect(problems).toEqual([]);
});

test("an admin's job asks the AI only about numbers the local reader couldn't read", async ({ page, request }) => {
  const { vision, problems } = watch(page);
  await addTeam(page);
  await page.goto("/?mockcv#/admin");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "You're logged in" })).toBeVisible();

  await sortGame(page, true);
  await expect(stat(page, "Fully identified")).toHaveText("16");
  await expect(stat(page, "Need review")).toHaveText("6");
  // 3 unreadable (one call each), 2 unclear + 2 blank + 1 off-roster (two calls each); confident reads: none.
  expect(await serverVisionCalls(request)).toBe(13);
  expect(vision).toHaveLength(13);

  await page.getByRole("link", { name: "Job details" }).click();
  await expect(page.locator(".kv").filter({ hasText: "Calls" })).toContainText("13");
  expect(problems).toEqual([]);
});

test("the AI endpoints refuse anyone without a valid admin cookie", async ({ request }) => {
  const body = { image: Buffer.from(readFileSync("test-fixtures/small.jpg")).toString("base64") };
  const headers = { Origin: "http://localhost:4173" };
  expect((await request.post("/api/vision/jersey-number", { data: body, headers })).status()).toBe(401);
  expect((await request.post("/api/vision/analyze-players", { data: { ...body, teamName: "x", rosterNumbers: [1] }, headers })).status()).toBe(401);
  const forged = await request.post("/api/vision/jersey-number", { data: body, headers: { ...headers, Cookie: "acha_admin=9999999999.0000" } });
  expect(forged.status()).toBe(401);
  expect(await serverVisionCalls(request)).toBe(0);
});

import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";

const env = { ADMIN_PASSWORD: "hunter2", SESSION_SECRET: "s".repeat(32), VISION_PROVIDER: "mock", STATIC_DIR: "nonexistent" };
const app = async (extra: Record<string, string> = {}, now?: () => number) =>
  (await createApp(loadConfig({ ...env, ...extra }), { now })).app;

const ORIGIN = { Origin: "http://127.0.0.1" };
async function login(a: Awaited<ReturnType<typeof app>>, password = "hunter2") {
  const res = await request(a).post("/api/auth/login").set(ORIGIN).set("Host", "127.0.0.1").send({ password });
  const cookie = (res.headers["set-cookie"] as unknown as string[] | undefined)?.[0]?.split(";")[0];
  return { res, cookie };
}

describe("admin login (port of api/auth.py)", () => {
  it("is off without a password: nobody is admin, login says so", async () => {
    const a = await app({ ADMIN_PASSWORD: "" });
    expect((await request(a).get("/api/auth/me")).body).toMatchObject({ admin: false, loginAvailable: false, visionAvailable: false });
    const { res } = await login(a);
    expect(res.status).toBe(503);
  });

  it("logs in with the right password and sets a strict HttpOnly cookie", async () => {
    const a = await app();
    const { res, cookie } = await login(a);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ admin: true, visionAvailable: true });
    const header = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Strict/);
    expect((await request(a).get("/api/auth/me").set("Cookie", cookie!)).body.admin).toBe(true);
  });

  it("refuses a wrong password", async () => {
    const a = await app();
    const { res, cookie } = await login(a, "nope");
    expect(res.status).toBe(401);
    expect(cookie).toBeUndefined();
  });

  it("rejects forged, tampered and expired cookies", async () => {
    let t = Date.now();
    const a = await app({}, () => t);
    const { cookie } = await login(a);
    const [name, value] = cookie!.split("=");
    const [expiry, sig] = decodeURIComponent(value).split(".");
    const me = (c: string) => request(a).get("/api/auth/me").set("Cookie", c).then((r) => r.body.admin);
    expect(await me(`${name}=${expiry}.${"0".repeat(64)}`)).toBe(false);
    expect(await me(`${name}=${Number(expiry) + 99999}.${sig}`)).toBe(false); // pushing the expiry breaks the signature
    expect(await me(`${name}=garbage`)).toBe(false);
    t += 13 * 3600_000;
    expect(await me(cookie!)).toBe(false);
  });

  it("logs everyone out when the password changes", async () => {
    const { cookie } = await login(await app());
    const after = await app({ ADMIN_PASSWORD: "new-password" });
    expect((await request(after).get("/api/auth/me").set("Cookie", cookie!)).body.admin).toBe(false);
  });

  it("throttles repeated wrong passwords per IP", async () => {
    const a = await app();
    for (let i = 0; i < 10; i++) expect((await login(a, "wrong")).res.status).toBe(401);
    expect((await login(a, "wrong")).res.status).toBe(429);
    expect((await login(a)).res.status).toBe(429); // even the right one, until the window passes
  });

  it("treats a blank password in the environment as unset", async () => {
    const a = await app({ ADMIN_PASSWORD: "   " });
    expect((await request(a).get("/api/auth/me")).body.loginAvailable).toBe(false);
  });

  it("refuses cross-site writes", async () => {
    const a = await app();
    const res = await request(a).post("/api/auth/login").set("Origin", "https://evil.example").set("Host", "127.0.0.1").send({ password: "hunter2" });
    expect(res.status).toBe(403);
    const form = await request(a).post("/api/auth/login").set(ORIGIN).set("Host", "127.0.0.1").type("form").send("password=hunter2");
    expect(form.status).toBe(415);
  });

  it("sends the security headers", async () => {
    const res = await request(await app()).get("/api/health");
    expect(res.headers["content-security-policy"]).toMatch(/connect-src 'self'/);
    expect(res.headers["cross-origin-embedder-policy"]).toBe("require-corp");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

/** The admin login: one shared password, then a signed, expiring HttpOnly cookie.
 * Port of api/auth.py (the admin half; headshots no longer touch the server). Fails closed:
 * with no ADMIN_PASSWORD nobody is admin. */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Config } from "./config";
import { WindowCounter } from "./security";

export const ADMIN_COOKIE = "acha_admin";
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

export class Auth {
  private readonly key: Buffer;
  private readonly failures: WindowCounter;

  constructor(private readonly config: Config, private readonly now: () => number = Date.now) {
    // Includes the password, so changing it logs everyone out.
    this.key = createHash("sha256").update(`${config.sessionKeySecret}\0${config.adminPassword ?? ""}`).digest();
    this.failures = new WindowCounter(MAX_FAILURES, FAILURE_WINDOW_MS, now);
  }

  get loginAvailable(): boolean {
    return this.config.adminPassword !== null;
  }

  private sign(expiry: number): string {
    return createHmac("sha256", this.key).update(`admin:${expiry}`).digest("hex");
  }

  isAdmin(req: Request): boolean {
    if (!this.loginAvailable) return false;
    const raw = parseCookies(req.headers.cookie)[ADMIN_COOKIE] ?? "";
    const [expiry, sig = ""] = raw.split(".", 2);
    if (!/^\d{1,13}$/.test(expiry) || Number(expiry) * 1000 < this.now()) return false;
    return safeEqual(sig, this.sign(Number(expiry)));
  }

  /** Express middleware for routes that spend money. */
  readonly requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (this.isAdmin(req)) return next();
    res.status(401).json({ error: "Admin login required", code: "admin_required" });
  };

  /** Returns the cookie to set, or an error to send. */
  login(password: unknown, ip: string): { cookie: string; maxAge: number } | { status: number; error: string } {
    if (!this.loginAvailable) return { status: 503, error: "Admin login is turned off on this server (no ADMIN_PASSWORD)." };
    if (this.failures.blocked(ip)) return { status: 429, error: "Too many wrong passwords. Try again in 15 minutes." };
    if (typeof password !== "string" || !safeEqual(password, this.config.adminPassword!)) {
      this.failures.hit(ip);
      return { status: 401, error: "Wrong password" };
    }
    this.failures.reset(ip);
    const maxAge = Math.round(this.config.sessionHours * 3600);
    const expiry = Math.floor(this.now() / 1000) + maxAge;
    return { cookie: `${expiry}.${this.sign(expiry)}`, maxAge };
  }

  cookieOptions(maxAgeSeconds: number) {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: "strict" as const,
      path: "/",
      maxAge: maxAgeSeconds * 1000,
    };
  }
}

/** Constant-time compare of two strings of any length. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[name] = part.slice(i + 1).trim();
    }
  }
  return out;
}

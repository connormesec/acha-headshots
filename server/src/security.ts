/** Response headers, the same-origin check for writes, and per-IP rate limits. */

import type { NextFunction, Request, Response } from "express";

/** The page's policy. The same text is in index.html as a <meta> fallback for static-only hosting.
 * connect-src 'self': photos can only ever be sent to this site (and only crops, only for admins). */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Content-Security-Policy", CSP);
  // Cross-origin isolation: lets the number reader use several CPU threads.
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}

/** Writes must come from our own pages: a matching Origin (browsers always send it on POST) and a
 * JSON body (cross-site forms can't send one without a CORS preflight, which we never allow). */
export function sameOriginWrites(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const origin = req.headers.origin;
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      /* "null" or garbage */
    }
    const allowed = [req.headers.host, req.headers["x-forwarded-host"]].flatMap((h) => (typeof h === "string" ? h.split(",") : []));
    if (!host || !allowed.some((h) => h.trim() === host)) {
      res.status(403).json({ error: "Cross-site request refused" });
      return;
    }
  }
  if (!req.is("application/json")) {
    res.status(415).json({ error: "Send JSON" });
    return;
  }
  next();
}

/** Counts events per key in a sliding window. Bounded, so a flood of new IPs can't grow it forever. */
export class WindowCounter {
  private readonly hits = new Map<string, number[]>();

  constructor(readonly limit: number, readonly windowMs: number, private readonly now: () => number = Date.now,
              private readonly maxKeys = 10_000) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  count(key: string): number {
    return this.recent(key).length;
  }

  blocked(key: string): boolean {
    return this.count(key) >= this.limit;
  }

  hit(key: string): void {
    const list = this.recent(key);
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next().value; // Maps iterate in insertion order
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    this.hits.set(key, [...list, this.now()]);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

/** Middleware: at most `limit` requests per `windowMs` per client IP. */
export function rateLimit(limit: number, windowMs: number, message = "Too many requests. Wait a minute and try again.") {
  const counter = new WindowCounter(limit, windowMs);
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? "unknown";
    if (counter.blocked(ip)) {
      res.status(429).json({ error: message });
      return;
    }
    counter.hit(ip);
    next();
  };
}

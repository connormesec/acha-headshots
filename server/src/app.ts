/** The web server: serves the built site and a small /api. Photos are never uploaded here; the
 * only image data it ever sees is a small crop an admin's browser sends for AI help. */

import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type Request, type Response } from "express";
import { Auth, ADMIN_COOKIE } from "./auth";
import { visionConfigured, type Config } from "./config";
import { httpsFetcher, type Fetcher } from "./roster/fetch";
import { rosterRouter } from "./roster/routes";
import { rateLimit, sameOriginWrites, securityHeaders } from "./security";
import { Budget } from "./vision/budget";
import { MockVision, OpenAIVision, type OpenAIOptions, type VisionBackend } from "./vision/openai";
import { visionRouter } from "./vision/routes";
import { UsageLog } from "./vision/usageLog";

export interface AppDeps {
  fetcher?: Fetcher;
  openai?: OpenAIOptions;
  now?: () => number;
}

export async function createApp(config: Config, deps: AppDeps = {}) {
  const now = deps.now ?? Date.now;
  const auth = new Auth(config, now);
  const backend: VisionBackend | null =
    config.visionProvider === "mock" ? new MockVision()
    : config.visionProvider === "openai" && config.openaiApiKey ? new OpenAIVision(config, deps.openai)
    : null;
  const budget = new Budget(config, now);
  const log = new UsageLog(config.dataDir, now);
  budget.load((await log.thisMonth()).map((u) => ({ at: u.at, cost: u.estimated_cost_usd })));
  let visionCalls = 0;

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(securityHeaders);

  // ---------------------------------------------------------------- /api
  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  api.use(express.json({ limit: "600kb" }));
  api.use(sameOriginWrites);

  const me = (req: Request) => {
    const admin = auth.isAdmin(req);
    return {
      admin,
      loginAvailable: auth.loginAvailable,
      visionAvailable: admin && backend !== null && visionConfigured(config) && budget.available(backend.maxCost()),
      spend: admin ? budget.snapshot() : null,
    };
  };

  api.get("/health", (_req, res) => void res.json({ ok: true }));
  api.get("/auth/me", (req, res) => void res.json(me(req)));
  api.post("/auth/login", rateLimit(30, 60_000), (req: Request, res: Response) => {
    const out = auth.login(req.body?.password, req.ip ?? "unknown");
    if ("error" in out) return void res.status(out.status).json({ error: out.error });
    res.cookie(ADMIN_COOKIE, out.cookie, auth.cookieOptions(out.maxAge));
    res.json({ ...me(req), admin: true, spend: budget.snapshot(),
      visionAvailable: backend !== null && budget.available(backend.maxCost()) });
  });
  api.post("/auth/logout", (_req, res) => {
    res.clearCookie(ADMIN_COOKIE, { ...auth.cookieOptions(0), maxAge: undefined });
    res.json({ admin: false, loginAvailable: auth.loginAvailable, visionAvailable: false, spend: null });
  });

  api.use("/vision", visionRouter({ auth, backend, budget, log, onCall: () => void visionCalls++ }));
  api.use("/roster", rateLimit(60, 60_000), rosterRouter(deps.fetcher ?? httpsFetcher(), config.achaFeedKey));

  if (config.testHooks) {
    api.get("/test/vision-calls", (_req, res) => void res.json({ calls: visionCalls }));
    api.post("/test/reset", (_req, res) => {
      visionCalls = 0;
      res.json({ ok: true });
    });
  }

  api.use((_req, res) => void res.status(404).json({ error: "Not found" }));
  api.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: express.NextFunction) => {
    if (err.type === "entity.too.large") return void res.status(413).json({ error: "Request too large" });
    if (err.type === "entity.parse.failed") return void res.status(400).json({ error: "Bad JSON" });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server" });
  });
  app.use("/api", api);

  // ---------------------------------------------------------------- the site
  const index = join(config.staticDir, "index.html");
  const sendIndex = (_req: Request, res: Response) => {
    if (!existsSync(index)) return void res.status(503).send("The site isn't built yet. Run npm run build.");
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(index);
  };
  app.get("/", sendIndex);
  app.get("/index.html", sendIndex);
  app.use(express.static(config.staticDir, {
    index: false,
    setHeaders(res, path) {
      const p = path.replace(/\\/g, "/");
      if (p.includes("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // hashed names
      else if (/\/(models|mediapipe|ort)\//.test(p)) res.setHeader("Cache-Control", "public, max-age=604800");
      else res.setHeader("Cache-Control", "public, max-age=3600");
      if (/\.(onnx|tflite)$/.test(p)) res.setHeader("Content-Type", "application/octet-stream");
    },
  }));

  return { app, auth, budget, backend, visionCalls: () => visionCalls };
}

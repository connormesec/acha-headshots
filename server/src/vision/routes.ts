/** /api/vision/*: the AI number reader. Admins only. Every call is checked (input, budget), counted
 * against the caps and logged. */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Auth } from "../auth";
import type { Budget } from "./budget";
import { checkImage } from "./jpeg";
import type { VisionBackend } from "./openai";
import type { UsageLog } from "./usageLog";

const id = z.string().max(64);
const Ctx = z.object({
  jobId: id.optional(),
  photoId: id.optional(),
  detectionId: id.optional(),
  filename: z.string().max(300).optional(),
  detectionIndex: z.number().int().min(0).max(100).optional(),
}).default({});

const JerseyBody = z.object({ image: z.string(), ctx: Ctx });
const AnalyzeBody = z.object({
  image: z.string(),
  // Goes into the prompt: short, one line, no control characters.
  teamName: z.string().max(100).transform((s) => s.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim() || "Unknown team"),
  rosterNumbers: z.array(z.number().int().min(0).max(99)).max(100).transform((ns) => [...new Set(ns)].sort((a, b) => a - b)),
  ctx: Ctx,
});

export interface VisionDeps {
  auth: Auth;
  backend: VisionBackend | null;
  budget: Budget;
  log: UsageLog;
  onCall?: () => void; // e2e counter
}

export function visionRouter(deps: VisionDeps): Router {
  const r = Router();
  r.use(deps.auth.requireAdmin);

  const run = async (req: Request, res: Response, call: (jpeg: Buffer) => ReturnType<VisionBackend["identifyJerseyNumber"] | VisionBackend["analyzePlayers"]>, jobId?: string) => {
    const backend = deps.backend;
    if (!backend) {
      res.status(503).json({ error: "AI help is turned off on this server (no OpenAI key).", code: "vision_off" });
      return;
    }
    const image = checkImage(req.body?.image);
    if ("error" in image) {
      res.status(400).json({ error: image.error, code: "bad_image" });
      return;
    }
    const reservation = deps.budget.reserve(backend.maxCost());
    if (!reservation) {
      res.status(402).json({ error: "The AI spending limit is reached. AI help is paused until it resets.", code: "budget", spend: deps.budget.snapshot() });
      return;
    }
    let cost = backend.maxCost(); // if the call throws, assume the worst
    let out: Awaited<ReturnType<typeof call>>;
    try {
      deps.onCall?.();
      out = await call(image.bytes);
      cost = out.usage.estimated_cost_usd;
    } finally {
      deps.budget.settle(reservation, cost);
    }
    await deps.log.append(out.usage, jobId ?? null);
    res.json({ ...out, spend: deps.budget.snapshot() });
  };

  r.post("/jersey-number", async (req, res) => {
    const body = JerseyBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "Bad request", code: "bad_request" });
    const { ctx } = body.data;
    await run(req, res, (jpeg) => deps.backend!.identifyJerseyNumber(jpeg, ctx), ctx.jobId);
  });

  r.post("/analyze-players", async (req, res) => {
    const body = AnalyzeBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "Bad request", code: "bad_request" });
    const { teamName, rosterNumbers, ctx } = body.data;
    await run(req, res, (jpeg) => deps.backend!.analyzePlayers(jpeg, teamName, rosterNumbers, ctx), ctx.jobId);
  });

  /** This month's calls, totalled by operation. */
  r.get("/usage", async (_req, res) => {
    const rows = await deps.log.thisMonth();
    const byOp = new Map<string, { operation: string; model: string; calls: number; failures: number; input_tokens: number; output_tokens: number; estimated_cost_usd: number }>();
    for (const u of rows) {
      const key = `${u.model}:${u.operation}`;
      const agg = byOp.get(key) ?? { operation: u.operation, model: u.model, calls: 0, failures: 0, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 };
      agg.calls++;
      if (!u.success) agg.failures++;
      agg.input_tokens += u.input_tokens ?? 0;
      agg.output_tokens += u.output_tokens ?? 0;
      agg.estimated_cost_usd += u.estimated_cost_usd;
      byOp.set(key, agg);
    }
    res.json({ spend: deps.budget.snapshot(), by_operation: [...byOp.values()] });
  });

  return r;
}

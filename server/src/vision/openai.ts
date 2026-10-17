/** The only code that talks to OpenAI. Port of providers/vision/openai_provider.py.
 *
 * Contract: never throws for API or validation failures. It returns `result: null` ("observation
 * unavailable") with a usage record, and the browser carries on without it. */

import type { z } from "zod";
import {
  JERSEY_NUMBER_JSON_SCHEMA,
  JerseyNumberResult,
  PLAYER_ANALYSIS_JSON_SCHEMA,
  PlayerAnalysisResult,
  type UsageRecord,
  type VisionResponse,
} from "../../../shared/vision/schemas";
import { tokenFor } from "../../../shared/mockConvention";
import type { Config } from "../config";
import { JERSEY_NUMBER_PROMPT, rosterAnalysisPrompt, SYSTEM_PROMPT } from "./prompts";
import { RateLimiter } from "./ratelimit";

export type Operation = UsageRecord["operation"];
export interface CallContext { filename?: string; detectionIndex?: number }

export interface VisionBackend {
  readonly name: string;
  readonly model: string;
  /** Worst-case cost of one call, in USD. */
  maxCost(): number;
  identifyJerseyNumber(jpeg: Buffer, ctx: CallContext): Promise<VisionResponse<JerseyNumberResult>>;
  analyzePlayers(jpeg: Buffer, teamName: string, rosterNumbers: number[], ctx: CallContext): Promise<VisionResponse<PlayerAnalysisResult>>;
}

class RetryableError extends Error {}
class ResponseError extends Error {} // the model answered, but not with JSON matching our schema

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAIOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  backoffInitialMs?: number;
  backoffMaxMs?: number;
}

export class OpenAIVision implements VisionBackend {
  readonly name = "openai";
  readonly model: string;
  private readonly limiter: RateLimiter;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly backoffInitialMs: number;
  private readonly backoffMaxMs: number;

  constructor(private readonly config: Config, opts: OpenAIOptions = {}) {
    if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is required when VISION_PROVIDER=openai");
    this.model = config.openaiModel;
    this.fetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
    this.limiter = new RateLimiter(config.openaiMaxConcurrency, config.openaiMinIntervalMs, this.sleep);
    this.backoffInitialMs = opts.backoffInitialMs ?? 1000;
    this.backoffMaxMs = opts.backoffMaxMs ?? 20_000;
  }

  /** Worst-case cost of one call, reserved against the budget before it starts. */
  maxCost(): number {
    const c = this.config;
    // A ≤768 px image at detail "high" plus the prompt stays well under 3,000 input tokens.
    return (3000 * c.inputCostPer1M + c.openaiMaxOutputTokens * c.outputCostPer1M) / 1_000_000;
  }

  identifyJerseyNumber(jpeg: Buffer) {
    return this.call("identify_jersey_number", jpeg, JERSEY_NUMBER_PROMPT, "jersey_number", JERSEY_NUMBER_JSON_SCHEMA, JerseyNumberResult);
  }

  analyzePlayers(jpeg: Buffer, teamName: string, rosterNumbers: number[]) {
    return this.call("analyze_players", jpeg, rosterAnalysisPrompt(teamName, rosterNumbers), "player_analysis",
      PLAYER_ANALYSIS_JSON_SCHEMA, PlayerAnalysisResult);
  }

  private async call<T>(operation: Operation, jpeg: Buffer, prompt: string, schemaName: string, jsonSchema: object,
                        schema: z.ZodType<T>): Promise<VisionResponse<T>> {
    const start = Date.now();
    let attempts = 0;
    let usage: ChatResponse["usage"];
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, detail: "high" } },
          ],
        },
      ],
      response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema: jsonSchema } },
      max_completion_tokens: this.config.openaiMaxOutputTokens,
    });
    const report = (error: string | null): UsageRecord => {
      const input = usage?.prompt_tokens ?? null, output = usage?.completion_tokens ?? null;
      const cost = ((input ?? 0) * this.config.inputCostPer1M + (output ?? 0) * this.config.outputCostPer1M) / 1_000_000;
      return {
        provider: this.name, model: this.model, operation, input_tokens: input, output_tokens: output,
        image_bytes: jpeg.length, estimated_cost_usd: Math.round(cost * 1e6) / 1e6, duration_ms: Date.now() - start,
        attempts: Math.max(attempts, 1), success: error === null, error: error?.slice(0, 1000) ?? null,
      };
    };

    try {
      let response: ChatResponse | undefined;
      for (let retry = 0; ; retry++) {
        attempts++;
        try {
          response = await this.limiter.run(() => this.post(body));
          break;
        } catch (e) {
          if (!(e instanceof RetryableError) || retry >= this.config.openaiMaxRetries) throw e;
          const wait = Math.min(this.backoffMaxMs, this.backoffInitialMs * 2 ** retry) + Math.random() * this.backoffInitialMs;
          await this.sleep(wait);
        }
      }
      usage = response.usage;
      return { result: parse(response.choices?.[0]?.message?.content ?? null, schema), usage: report(null) };
    } catch (e) {
      const why = e instanceof ResponseError ? `invalid response: ${e.message}` : `${(e as Error).name}: ${(e as Error).message}`;
      console.warn(`vision ${operation} failed after ${attempts} attempt(s): ${why.slice(0, 300)}`);
      return { result: null, usage: report(why) };
    }
  }

  private async post(body: string): Promise<ChatResponse> {
    let res: Response;
    try {
      res = await this.fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.openaiApiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(this.config.openaiTimeoutMs),
      });
    } catch (e) {
      throw new RetryableError(`connection failed: ${(e as Error).message}`); // includes timeouts
    }
    if (res.status === 429 || res.status >= 500) throw new RetryableError(`OpenAI returned ${res.status}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI returned ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as ChatResponse;
  }
}

function parse<T>(content: string | null, schema: z.ZodType<T>): T {
  if (!content) throw new ResponseError("empty response");
  let text = content.trim();
  if (text.startsWith("```")) text = text.replace(/^`+/, "").replace(/`+$/, "").replace(/^json/, "").trim(); // tolerate fences
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ResponseError(`not JSON: ${JSON.stringify(text.slice(0, 120))}`);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new ResponseError("JSON root is not an object");
  const out = schema.safeParse(payload);
  if (!out.success) throw new ResponseError(out.error.message.slice(0, 300));
  return out.data;
}

/** Free and deterministic, driven by the photo's filename (see shared/mockConvention). For tests
 * and the demo; refuses to start in production. Records zero-cost usage. */
export class MockVision implements VisionBackend {
  readonly name = "mock";
  readonly model = "mock";
  calls = 0;

  maxCost() {
    return 0;
  }

  private usage(operation: Operation, jpeg: Buffer): UsageRecord {
    this.calls++;
    return { provider: "mock", model: "mock", operation, input_tokens: null, output_tokens: null, image_bytes: jpeg.length,
      estimated_cost_usd: 0, duration_ms: 1, attempts: 1, success: true, error: null };
  }

  async identifyJerseyNumber(jpeg: Buffer, ctx: CallContext) {
    const usage = this.usage("identify_jersey_number", jpeg);
    const token = tokenFor(ctx.filename ?? "", ctx.detectionIndex ?? -1);
    if (token && token.number !== null && ["ocr", "vision", "goalie"].includes(token.kind)) {
      return { result: { number: token.number, confidence: 0.93, visible: true, notes: "mock: digits visible" }, usage };
    }
    return { result: { number: null, confidence: 0.1, visible: false, notes: "mock: no number visible" }, usage };
  }

  async analyzePlayers(jpeg: Buffer, _teamName: string, rosterNumbers: number[], ctx: CallContext) {
    const usage = this.usage("analyze_players", jpeg);
    const token = tokenFor(ctx.filename ?? "", ctx.detectionIndex ?? -1);
    if (!token || token.number === null) {
      return { result: { jersey_number: null, confidence: 0.05, candidates: [], evidence: ["mock: insufficient evidence"] }, usage };
    }
    if (token.kind === "ambiguous") {
      const alt = rosterNumbers.find((n) => n !== token.number);
      const candidates = [{ jersey_number: token.number, confidence: 0.61 }];
      if (alt !== undefined) candidates.push({ jersey_number: alt, confidence: 0.27 });
      return { result: { jersey_number: null, confidence: 0.61, candidates, evidence: ["mock: partially obscured digits"] }, usage };
    }
    return { result: { jersey_number: token.number, confidence: 0.9, candidates: [], evidence: ["mock: number shape matches"] }, usage };
  }
}

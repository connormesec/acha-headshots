/** Server settings from environment variables. Only the admin login and the OpenAI proxy need
 * secrets; with none set, the site still serves every tool and AI help stays off. */

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

export type VisionProviderName = "openai" | "mock" | "none";

export interface Config {
  port: number;
  staticDir: string;
  dataDir: string | null; // usage log; null = in memory only
  /** Express "trust proxy": how many proxy hops set X-Forwarded-For (1 behind Hostinger's proxy). */
  trustProxy: number | boolean;

  adminPassword: string | null;
  sessionKeySecret: string; // random per process when SESSION_SECRET is unset
  sessionSecretIsRandom: boolean;
  sessionHours: number;
  cookieSecure: boolean;

  visionProvider: VisionProviderName;
  openaiApiKey: string | null;
  openaiModel: string;
  openaiTimeoutMs: number;
  openaiMaxRetries: number;
  openaiMaxConcurrency: number;
  openaiMinIntervalMs: number;
  openaiMaxOutputTokens: number;
  inputCostPer1M: number;
  outputCostPer1M: number;
  dailyCapUsd: number;
  monthlyCapUsd: number;

  achaFeedKey: string;
  /** e2e only: exposes /api/test/* counters. Never set in production. */
  testHooks: boolean;
}

type Env = Record<string, string | undefined>;

/** `ADMIN_PASSWORD=` means "not set", never "the empty password". */
const secret = (v: string | undefined) => (v && v.trim() ? v : null);

function num(env: Env, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) throw new Error(`${key} must be a number ≥ ${min} (got "${raw}")`);
  return n;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${key} must be true or false (got "${env[key]}")`);
}

export function loadConfig(env: Env = process.env): Config {
  const provider = (env.VISION_PROVIDER?.trim().toLowerCase() || (secret(env.OPENAI_API_KEY) ? "openai" : "none")) as VisionProviderName;
  if (!["openai", "mock", "none"].includes(provider)) throw new Error(`VISION_PROVIDER must be openai, mock or none (got "${provider}")`);
  const sessionSecret = secret(env.SESSION_SECRET);
  const trust = env.TRUST_PROXY?.trim();
  const testHooks = bool(env, "E2E_TEST_HOOKS", false);
  if (testHooks && env.NODE_ENV === "production") throw new Error("E2E_TEST_HOOKS must not be set in production");
  if (provider === "mock" && env.NODE_ENV === "production") throw new Error("VISION_PROVIDER=mock is for tests only");
  return {
    port: num(env, "PORT", 8787, 1),
    staticDir: resolve(env.STATIC_DIR?.trim() || "dist"),
    dataDir: env.DATA_DIR?.trim() ? resolve(env.DATA_DIR.trim()) : null,
    trustProxy: !trust ? false : /^\d+$/.test(trust) ? Number(trust) : trust === "true",

    adminPassword: secret(env.ADMIN_PASSWORD),
    sessionKeySecret: sessionSecret ?? randomBytes(32).toString("hex"),
    sessionSecretIsRandom: !sessionSecret,
    sessionHours: num(env, "ADMIN_SESSION_HOURS", 12, 0.01),
    cookieSecure: bool(env, "COOKIE_SECURE", env.NODE_ENV === "production"),

    visionProvider: provider,
    openaiApiKey: secret(env.OPENAI_API_KEY),
    openaiModel: env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    openaiTimeoutMs: num(env, "OPENAI_TIMEOUT_SECONDS", 30, 1) * 1000,
    openaiMaxRetries: num(env, "OPENAI_MAX_RETRIES", 4),
    openaiMaxConcurrency: num(env, "OPENAI_MAX_CONCURRENCY", 4, 1),
    openaiMinIntervalMs: num(env, "OPENAI_MIN_INTERVAL_SECONDS", 0.2) * 1000,
    openaiMaxOutputTokens: num(env, "OPENAI_MAX_OUTPUT_TOKENS", 400, 50),
    inputCostPer1M: num(env, "OPENAI_INPUT_COST_PER_1M", 0.4),
    outputCostPer1M: num(env, "OPENAI_OUTPUT_COST_PER_1M", 1.6),
    dailyCapUsd: num(env, "OPENAI_DAILY_CAP_USD", 3),
    monthlyCapUsd: num(env, "OPENAI_MONTHLY_CAP_USD", 10),

    achaFeedKey: env.ACHA_FEED_KEY?.trim() || "e6867b36742a0c9d", // public key embedded in achahockey.org
    testHooks,
  };
}

/** Can an admin use the vision model at all (budget aside)? */
export const visionConfigured = (c: Config) =>
  c.visionProvider === "mock" || (c.visionProvider === "openai" && c.openaiApiKey !== null);

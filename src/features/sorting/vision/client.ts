/** The browser side of AI help: sends one small crop of one player to this site's server, which
 * checks the admin login and the spending limit before asking OpenAI. Port of the old
 * OpenAIVisionProvider's contract: it never throws, it answers null ("no observation"). */

import type { JerseyNumberResult, PlayerAnalysisResult, UsageRecord, VisionContext } from "../../../../shared/vision/schemas";
import { api, ApiError, type Spend } from "../../../app/api";
import { addUsage } from "../../../db/repo";
import { scaleTo, type RGBAImage } from "../../../ml/ocr/image";
import type { DetectionContext, PlayerCrops, VisionClient } from "../pipeline/providers";

const MAX_SIDE = 768;   // the server refuses anything bigger: fewer input tokens, lower cost
const QUALITY = 0.85;
const GIVE_UP_AFTER = 3; // network failures in a row

/** RGBA -> JPEG (≤768 px), base64. */
async function toBase64Jpeg(img: RGBAImage): Promise<string> {
  const s = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const small = s < 1 ? scaleTo(img, Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s))) : img;
  const canvas = document.createElement("canvas");
  canvas.width = small.width;
  canvas.height = small.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(small.data), small.width, small.height), 0, 0);
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("JPEG encode failed"))), "image/jpeg", QUALITY));
  canvas.width = canvas.height = 0;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface BrowserVisionClient extends VisionClient {
  stopReason(): string | null;
  calls(): number;
}

export function createVisionClient(onSpend?: (s: Spend) => void): BrowserVisionClient {
  let stopped: string | null = null;
  let failures = 0;
  let calls = 0;

  const call = async <T>(path: string, crops: PlayerCrops, ctx: DetectionContext, extra: object): Promise<T | null> => {
    if (stopped) return null;
    const context: VisionContext = { jobId: ctx.jobId, photoId: ctx.photoId, detectionId: ctx.detectionId, filename: ctx.filename, detectionIndex: ctx.detectionIndex };
    try {
      calls++;
      const out = await api<{ result: T | null; usage: UsageRecord; spend: Spend | null }>(`vision/${path}`, {
        body: { image: await toBase64Jpeg(crops.full), ctx: context, ...extra },
      });
      failures = 0;
      if (out.spend) onSpend?.(out.spend);
      await addUsage([{ ...out.usage, jobId: ctx.jobId, photoId: ctx.photoId, detectionId: ctx.detectionId, at: new Date().toISOString() }]);
      return out.result;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) stopped = "Your admin login ended, so AI help stopped for the rest of this job.";
      else if (e instanceof ApiError && e.status === 402) stopped = "The AI spending limit was reached, so AI help stopped for the rest of this job.";
      else if (e instanceof ApiError && e.status === 503) stopped = "AI help is turned off on the server.";
      else if (++failures >= GIVE_UP_AFTER) stopped = "The server stopped answering, so AI help stopped for the rest of this job.";
      return null;
    }
  };

  return {
    active: () => stopped === null,
    stopReason: () => stopped,
    calls: () => calls,
    identifyJerseyNumber: (crops, ctx) => call<JerseyNumberResult>("jersey-number", crops, ctx, {}),
    analyzePlayers: (crops, teamName, rosterNumbers, ctx) =>
      call<PlayerAnalysisResult>("analyze-players", crops, ctx, { teamName: teamName.slice(0, 100), rosterNumbers: rosterNumbers.slice(0, 100) }),
  };
}

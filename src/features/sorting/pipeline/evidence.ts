/** Evidence for one detected player, with cost control. Port of processing/evidence.py.
 *
 *     OCR (local, free)
 *       confident + maps to exactly one roster player?  -> done, no AI call
 *       otherwise, only if an admin turned AI help on -> vision: the jersey number
 *         confident + maps to exactly one roster player? -> done
 *         otherwise -> vision: which roster number fits (roster numbers as context)
 *
 * Only *observations* come out of here; identity is decided by the IdentityResolver. */

import { allCandidates, effectiveNumber } from "../../../../shared/vision/schemas";
import { SORTING } from "../config";
import { rosterNumbers, uniquelyOnRoster, type NumberEvidence, type Roster, type VisionEvidence } from "../domain";
import type { Observation } from "../types";
import type { DetectionContext, PlayerCrops, Providers } from "./providers";

export interface CollectedEvidence {
  numbers: NumberEvidence[];
  vision: VisionEvidence[];
  observations: Observation[];
  visionCalls: number;
}

export async function collectEvidence(p: Providers, crops: PlayerCrops, ctx: DetectionContext, roster: Roster,
                                      readings?: NumberEvidence[]): Promise<CollectedEvidence> {
  const out: CollectedEvidence = { numbers: [], vision: [], observations: [], visionCalls: 0 };

  // 1) OCR (readings may already exist from the background check, so OCR doesn't run twice)
  readings ??= await p.readNumbers(crops, ctx);
  for (const r of readings) {
    out.numbers.push(r);
    out.observations.push({ number: r.number, confidence: r.confidence, source: "OCR", region: r.region ?? null });
  }
  const best = readings[0];
  if (best && best.confidence >= SORTING.ocrAcceptThreshold && uniquelyOnRoster(roster, best.number)) return out;
  const vision = p.vision;
  if (!vision || !vision.active()) return out; // no AI help: uncertain people go to review

  // 2) Vision: the observable jersey number only
  const jersey = await vision.identifyJerseyNumber(crops, ctx);
  out.visionCalls++;
  if (jersey) {
    const number = effectiveNumber(jersey);
    out.observations.push({ number, confidence: jersey.confidence, source: "VISION_MODEL", region: "full", raw: JSON.stringify(jersey) });
    if (number !== null) out.numbers.push({ number, confidence: jersey.confidence, source: "VISION_MODEL", region: "full" });
    if (number !== null && jersey.confidence >= SORTING.visionAcceptThreshold && uniquelyOnRoster(roster, number)) return out;
  }
  if (!vision.active()) return out; // stopped part way (spending limit, logged out)

  // 3) Vision: which roster number fits, given the roster as context
  const analysis = await vision.analyzePlayers(crops, roster.team.name, rosterNumbers(roster), ctx);
  out.visionCalls++;
  const raw = analysis ? JSON.stringify(analysis) : null;
  for (const c of analysis ? allCandidates(analysis) : []) {
    out.vision.push({ number: c.jersey_number, confidence: c.confidence });
    out.observations.push({ number: c.jersey_number, confidence: c.confidence, source: "VISION_MODEL", region: "roster_analysis", raw });
  }
  return out;
}

/** Prompts ask for *observable* information only. The model never names players; the browser maps
 * numbers onto the roster itself. Port of providers/vision/prompts.py. Server side only: the
 * browser can't send its own prompt. */

export const SYSTEM_PROMPT =
  "You are a careful sports-photo analyst. You report only what is visibly present in the " +
  "image. You never guess. You respond with JSON only.";

export const JERSEY_NUMBER_PROMPT = `Analyze this hockey player crop.

Determine whether a jersey number is visible (back, front, sleeve, shoulder, or helmet).

Return JSON only:

{
  "number": integer or null,
  "confidence": number between 0 and 1,
  "visible": boolean,
  "notes": string
}

Do not guess a number if it is not visible. If digits are partially hidden, lower your confidence
accordingly or return null.`;

export function rosterAnalysisPrompt(teamName: string, rosterNumbers: number[]): string {
  const numbers = rosterNumbers.map((n) => `#${n}`).join(", ") || "(none)";
  return `Analyze this hockey player.

Known team: ${teamName}
Jersey numbers on this team's roster: ${numbers}

Determine which roster jersey number appears to correspond to this player, but only if there is
enough visual evidence (visible digits, partial digits, number shape and position).

Return JSON only:

{
  "jersey_number": integer or null,
  "confidence": number between 0 and 1,
  "candidates": [{"jersey_number": integer, "confidence": number between 0 and 1}],
  "evidence": [string]
}

Use "candidates" to list other plausible roster numbers when the evidence is ambiguous.
Only use numbers from the roster list. Do not guess when evidence is insufficient: return
null with low confidence and an empty candidates list.`;
}

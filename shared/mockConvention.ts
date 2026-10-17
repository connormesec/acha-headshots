/** Deterministic filename convention driving the mock detection/OCR/vision providers (tests, demo).
 * Port of providers/mock_convention.py.
 *
 * The photo's filename stem is split on `_`, `-` and spaces. Recognised tokens, one per detected
 * player, left to right:
 *
 *     27     OCR clearly reads #27 (0.95)
 *     v27    OCR fails; the vision model reads #27 (0.93)
 *     q27    ambiguous: OCR unsure of #27 (0.70), vision returns candidates #27 (0.61) and
 *            another roster number (0.27) -> lands in human review
 *     x      a player with no readable number
 *     g30    a goalie; OCR clearly reads #30 (the mock role classifier says "goalie")
 *
 * Anything else (e.g. `IMG`, `001`, `game1`) is ignored. No tokens -> no players detected.
 * Example: `game1_27_v12_q91.jpg` -> three players. */

export type TokenKind = "ocr" | "vision" | "ambiguous" | "blank" | "goalie";
export interface MockPlayerToken { kind: TokenKind; number: number | null }

const TOKEN = /^([vqg]?)(\d{1,2})$/;
const KIND: Record<string, TokenKind> = { "": "ocr", v: "vision", q: "ambiguous", g: "goalie" };

export function parseTokens(filename: string): MockPlayerToken[] {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
  const tokens: MockPlayerToken[] = [];
  for (const raw of stem.split(/[_\-\s]+/)) {
    if (raw === "x") {
      tokens.push({ kind: "blank", number: null });
      continue;
    }
    const m = TOKEN.exec(raw);
    if (m) tokens.push({ kind: KIND[m[1]], number: Number(m[2]) });
  }
  return tokens;
}

export function tokenFor(filename: string, index: number): MockPlayerToken | null {
  const tokens = parseTokens(filename);
  return index >= 0 && index < tokens.length ? tokens[index] : null;
}

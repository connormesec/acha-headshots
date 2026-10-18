import { useMemo, useState } from "react";
import { JerseyBadge, SignalBar, StatusPill, pct } from "../../../components/ui";
import type { ReviewItem } from "../services/stats";
import type { Detection, Match, Player } from "../types";
import { BlobImage } from "./BlobImage";

const SOURCE_LABEL: Record<string, string> = { OCR: "Number reader", VISION_MODEL: "AI help", MANUAL: "Reviewer" };
const ROLE_LABEL = { goalie: "Goalie", skater: "Skater", unsure: "Maybe a goalie" } as const;

/** The current tag (auto-accepted or confirmed) first, so Enter/"1" keep it. */
export function activeCandidates(d: Detection | null): Match[] {
  if (!d) return [];
  const accepted = (m: Match) => (m.status === "AUTO_ACCEPTED" || m.status === "CONFIRMED" ? 0 : 1);
  return d.matches.filter((m) => m.status !== "REJECTED").sort((a, b) => accepted(a) - accepted(b) || a.rank - b.rank);
}

export function ReviewPanel({ item, detection, players, roster, busy, decision, onChoose, onAssign, onUnknown }: {
  item: ReviewItem;
  detection: Detection | null;
  players: Map<string, Player>;
  roster: Player[];
  busy: boolean;
  decision?: string;
  onChoose: (m: Match) => void;
  onAssign: (p: Player) => void;
  onUnknown: () => void;
}) {
  const [query, setQuery] = useState("");
  const candidates = activeCandidates(detection).filter((m) => players.has(m.playerId));
  const primary = candidates[0];
  const tagged = detection?.matches.find((m) => m.status === "AUTO_ACCEPTED" || m.status === "CONFIRMED");
  const status = detection?.status;
  const role = detection?.role ?? null;
  const who = (m: Match) => players.get(m.playerId)!;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Someone who looks like a goalie most likely is one of our goalies: list them first.
    const ordered = role === "goalie" ? [...roster].sort((a, b) => Number(b.position === "G") - Number(a.position === "G")) : roster;
    if (!q) return ordered;
    return ordered.filter((p) => String(p.jerseyNumber ?? "") === q || p.displayName.toLowerCase().includes(q));
  }, [query, roster, role]);

  const numbers = detection?.observations.filter((o) => o.number !== null) ?? [];

  return (
    <aside className="review-panel">
      {decision && <div className="decision" role="status">✓ {decision}</div>}

      {item.kind === "photo" ? (
        <div className="review-block">
          <h2 className="review-panel__title">No players detected</h2>
          <p className="muted">Nobody was found in this photo. Tag a roster player if one is visible, or mark it as having no roster players.</p>
        </div>
      ) : detection && (
        <>
          <div className="review-block review-block--crop">
            {!detection.manual && <BlobImage className="crop" blobKey={`crop:${detection.id}`} alt="Detected player" />}
            <div className="ai-result">
              {tagged && players.has(tagged.playerId) ? (
                <>
                  <span className="eyebrow">Tagged as</span>
                  <div className="ai-result__who">
                    <JerseyBadge number={who(tagged).jerseyNumber} />
                    <div>
                      <strong>{who(tagged).displayName}</strong>
                      <StatusPill status={tagged.status} />
                    </div>
                  </div>
                </>
              ) : status === "FILTERED" || status === "REJECTED" ? (
                <>
                  <span className="eyebrow">Current decision</span>
                  <strong className="ai-result__none ai-result__none--muted">{status === "FILTERED" ? "Hidden as background" : "Not a roster player"}</strong>
                  <span className="muted small">Pick a player below if that's wrong.</span>
                </>
              ) : (
                <>
                  <span className="eyebrow">Best guess</span>
                  {primary ? (
                    <div className="ai-result__who">
                      <JerseyBadge number={who(primary).jerseyNumber} tone="review" />
                      <div>
                        <strong>{who(primary).displayName}</strong>
                        <span className="confidence">{pct(primary.finalScore)} confidence</span>
                      </div>
                    </div>
                  ) : (
                    <strong className="ai-result__none">No roster match</strong>
                  )}
                </>
              )}
              {!detection.manual && (
                <span className="muted small">
                  Detector confidence {pct(detection.confidence)}
                  {role && detection.goalieScore !== null && (
                    <> · <span className={`role role--${role}`}>{ROLE_LABEL[role]}</span> ({pct(detection.goalieScore)} goalie)</>
                  )}
                </span>
              )}
            </div>
          </div>

          <div className="review-block">
            <h3 className="block-title">Evidence</h3>
            <SignalBar label="Jersey number" value={primary?.signals.number} />
            <SignalBar label="AI help" value={primary?.signals.vision} />
            {numbers.length > 0 && (
              <ul className="observations">
                {numbers.map((o, i) => (
                  <li key={i}>
                    <JerseyBadge number={o.number} size="sm" tone="muted" />
                    <span>{SOURCE_LABEL[o.source] ?? o.source}{o.region ? ` · ${o.region.replace("_", " ")}` : ""}</span>
                    <span className="mono">{pct(o.confidence)}</span>
                  </li>
                ))}
              </ul>
            )}
            {detection.reasoning && <p className="reasoning">{detection.reasoning}</p>}
          </div>

          <div className="review-block">
            <h3 className="block-title">Candidates</h3>
            {candidates.length === 0 && <p className="muted small">No candidates. Pick the player from the roster below.</p>}
            <div className="candidates">
              {candidates.map((m, i) => (
                <button key={m.id} className={`candidate ${i === 0 ? "candidate--primary" : ""}`} onClick={() => onChoose(m)} disabled={busy}>
                  <kbd>{i + 1}</kbd>
                  <JerseyBadge number={who(m).jerseyNumber} size="sm" />
                  <span className="candidate__name">
                    {who(m).displayName}
                    {who(m).position === "G" && <span className="role role--goalie" title="Goalie">G</span>}
                  </span>
                  <span className="candidate__score">{pct(m.finalScore)}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="review-block">
        <h3 className="block-title">Someone else?</h3>
        <input className="search" type="search" placeholder="Search roster by number or name" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="Search roster" />
        <div className="roster-pick">
          {filtered.map((p) => (
            <button key={p.id} className="roster-pick__item" onClick={() => onAssign(p)} disabled={busy} title={`Assign ${p.displayName}`}>
              <JerseyBadge number={p.jerseyNumber} size="sm" tone="muted" />
              <span>{p.displayName}</span>
              {p.position === "G" && <span className="role role--goalie" title="Goalie">G</span>}
            </button>
          ))}
          {filtered.length === 0 && <p className="muted small">No roster player matches "{query}".</p>}
        </div>
      </div>

      <div className="review-actions">
        {primary && (
          <button className="button button--primary" onClick={() => onChoose(primary)} disabled={busy}>
            Confirm {who(primary).displayName} <kbd>Enter</kbd>
          </button>
        )}
        <button className="button" onClick={onUnknown} disabled={busy}>
          {item.kind === "photo" ? "No roster player" : "Not a roster player"} <kbd>U</kbd>
        </button>
      </div>
    </aside>
  );
}

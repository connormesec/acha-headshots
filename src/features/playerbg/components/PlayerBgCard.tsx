import { useState } from "react";
import { CropPreview } from "../../../components/CropPreview";
import { JerseyBadge } from "../../../components/ui";
import { useBlobUrl } from "../../sorting/components/BlobImage";
import type { BgFlag, BgPick, Player } from "../../sorting/types";
import type { Candidate } from "../lib/picks";

/** Plain-words notes for each framing flag. `look` ones mark the card for a second look. */
export const BG_FLAG_COPY: Record<BgFlag, { text: string; look: boolean }> = {
  cut_off: { text: "Part of the player is cut off. Try another shot or zoom out.", look: true },
  low_resolution: { text: "This shot is small, so the banner will look blurry.", look: true },
  crowded: { text: "Lots of other people in frame. Is the right player the focus?", look: false },
  upscaled: { text: "A bit small, so it will be enlarged slightly.", look: false },
};

export const flagNotes = (flags: BgFlag[]) => flags.filter((f) => BG_FLAG_COPY[f]).map((f) => BG_FLAG_COPY[f].text);
export const needsLook = (pick: BgPick) => pick.flags.some((f) => BG_FLAG_COPY[f]?.look);

const STRIP = 6; // candidate thumbnails shown before "more"

function Shot({ candidate, crop, aspect, alt, className }: { candidate: Candidate; crop: BgPick["crop"]; aspect: number; alt: string; className?: string }) {
  const src = useBlobUrl(`norm:${candidate.photo.id}`);
  return <CropPreview src={src} crop={crop} aspect={aspect} alt={alt} className={className} />;
}

export function PlayerBgCard({ pick, player, candidates, outputName, aspect, busy, onEdit, onChoose, onInclude }: {
  pick: BgPick;
  player: Player;
  candidates: Candidate[];
  outputName: string;
  aspect: number;
  busy?: boolean;
  onEdit: () => void;
  onChoose: (detectionId: string) => void;
  onInclude: (included: boolean) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const look = needsLook(pick);
  const current = candidates.find((c) => c.detection.id === pick.detectionId) ?? candidates[0];
  const shown = showAll ? candidates : candidates.slice(0, STRIP);

  return (
    <article className={`hs-card bg-card ${look && pick.included ? "hs-card--look" : ""} ${pick.included ? "" : "hs-card--out"}`} data-pick={player.displayName}>
      <button type="button" className="hs-card__photo" onClick={onEdit} disabled={busy} aria-label={`Adjust crop for ${player.displayName}`}>
        {current && <Shot candidate={current} crop={pick.crop} aspect={aspect} alt={`Background for ${player.displayName}`} />}
        <span className="hs-card__badges">
          {look && pick.included && <span className="pill pill--review">Needs a look</span>}
          {!pick.included && <span className="pill pill--bad">Left out</span>}
          {pick.cropEdited && pick.included && <span className="pill pill--good">Edited</span>}
        </span>
        <span className="hs-card__hint" aria-hidden="true">Adjust crop</span>
      </button>

      <div className="hs-card__body">
        <div className="bg-card__who">
          <JerseyBadge number={player.jerseyNumber} size="sm" />
          <div>
            <strong>{player.displayName}</strong>
            <span className="bg-card__file">{pick.included ? outputName : "not in the ZIP"}</span>
          </div>
        </div>

        {pick.included && pick.flags.filter((f) => BG_FLAG_COPY[f]).map((f) => (
          <p key={f} className={BG_FLAG_COPY[f].look ? "hs-card__reason" : "hs-card__soft"}>{BG_FLAG_COPY[f].text}</p>
        ))}

        {candidates.length > 1 && (
          <div>
            <span className="field__label">
              {candidates.length} shots of {player.firstName || player.displayName}{pick.chosen ? "" : " · best picked for you"}
            </span>
            <div className="bg-strip" role="radiogroup" aria-label={`Shots of ${player.displayName}`}>
              {shown.map((c, i) => {
                const active = c.detection.id === pick.detectionId;
                return (
                  <button key={c.detection.id} type="button" role="radio" aria-checked={active}
                    className={`bg-strip__item ${active ? "is-active" : ""}`} onClick={() => !active && onChoose(c.detection.id)}
                    disabled={busy} title={`${c.photo.filename}${i === 0 ? " · top score" : ""}`}>
                    <Shot candidate={c} crop={c.frame.crop} aspect={aspect} alt={c.photo.filename} />
                  </button>
                );
              })}
              {!showAll && candidates.length > STRIP && (
                <button type="button" className="bg-strip__more" onClick={() => setShowAll(true)}>+{candidates.length - STRIP}</button>
              )}
            </div>
          </div>
        )}
        {current && <p className="hs-card__orig" title={current.photo.filename}>From {current.photo.filename}</p>}

        <div className="hs-card__actions">
          <button type="button" className="button button--small" onClick={onEdit} disabled={busy}>Adjust crop</button>
          {pick.included
            ? <button type="button" className="button button--small hs-link" onClick={() => onInclude(false)} disabled={busy}>Leave out</button>
            : <button type="button" className="button button--small" onClick={() => onInclude(true)} disabled={busy}>Put back</button>}
        </div>
      </div>
    </article>
  );
}

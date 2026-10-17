import type { Headshot, HeadshotFlag } from "../state/types";
import { CropPreview } from "../../../components/CropPreview";
import { NameField } from "./NameField";

/** Every message a user sees about a photo, in plain words. */
export const FLAG_COPY: Record<HeadshotFlag, { text: string; look: boolean }> = {
  not_headshot: { text: "This doesn't look like a headshot. Leave it out?", look: true },
  no_face: { text: "We couldn't find a face. Is the crop right?", look: true },
  multiple_people: { text: "There's more than one person. Pick the right one.", look: true },
  small_face: { text: "The face is small in this photo, so it's zoomed in a lot. Check it's sharp.", look: true },
  low_resolution: { text: "This photo is small. It will look blurry at ACHA's size.", look: true },
  upscaled: { text: "A bit small, so it will be enlarged slightly.", look: false },
  generic_name: { text: "Add the player's name so the file is easy to find.", look: false },
};

export function lookReasons(item: Headshot): string[] {
  return item.flags.filter((f) => FLAG_COPY[f]?.look).map((f) => FLAG_COPY[f].text);
}

export { formatBytes } from "../../../components/ui";

export function HeadshotCard({ item, onEdit, onApprove, onInclude, onRename, busy }: {
  item: Headshot;
  onEdit: () => void;
  onApprove: () => void;
  onInclude: (included: boolean) => void;
  onRename: (name: string) => Promise<void>;
  busy?: boolean;
}) {
  const reasons = lookReasons(item);
  const look = item.needs_look;
  return (
    <article className={`hs-card ${look ? "hs-card--look" : ""} ${item.included ? "" : "hs-card--out"}`}>
      <button type="button" className="hs-card__photo" onClick={onEdit} disabled={busy} aria-label={`Fix crop for ${item.output_name}`}>
        <CropPreview src={item.image_url} crop={item.crop} alt={`Crop of ${item.original_filename}`} />
        <span className="hs-card__badges">
          {look && <span className="pill pill--review">Needs a look</span>}
          {!item.included && <span className="pill pill--bad">Left out</span>}
          {item.crop_source === "manual" && item.included && <span className="pill pill--good">Edited</span>}
        </span>
        <span className="hs-card__hint" aria-hidden="true">Fix crop</span>
      </button>

      <div className="hs-card__body">
        <NameField value={item.output_name} onSave={onRename} chain disabled={busy} />
        {look && reasons.map((r) => <p key={r} className="hs-card__reason">{r}</p>)}
        {!look && item.included && item.flags.includes("upscaled") && (
          <p className="hs-card__soft">{FLAG_COPY.upscaled.text}</p>
        )}
        {item.original_filename !== item.output_name && (
          <p className="hs-card__orig" title={item.original_filename}>From {item.original_filename}</p>
        )}

        <div className="hs-card__actions">
          {!item.included ? (
            <button type="button" className="button button--small" onClick={() => onInclude(true)} disabled={busy}>
              Put it back
            </button>
          ) : look ? (
            <>
              <button type="button" className="button button--small button--primary" onClick={onEdit} disabled={busy}>Fix crop</button>
              <button type="button" className="button button--small" onClick={onApprove} disabled={busy}>Looks good</button>
              <button type="button" className="button button--small hs-link" onClick={() => onInclude(false)} disabled={busy}>Leave out</button>
            </>
          ) : (
            <>
              <button type="button" className="button button--small" onClick={onEdit} disabled={busy}>Fix crop</button>
              <button type="button" className="button button--small hs-link" onClick={() => onInclude(false)} disabled={busy}>Leave out</button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

import { CropPreview } from "../../../components/CropPreview";
import { Modal } from "../../../components/Modal";
import { CORNERS, useCropBox } from "../../../hooks/useCropBox";
import { useBlobUrl } from "../../sorting/components/BlobImage";
import type { BgPick, Player } from "../../sorting/types";
import { BG_HEIGHT, BG_WIDTH } from "../lib/bannerCrop";
import type { Candidate } from "../lib/picks";
import { flagNotes } from "./PlayerBgCard";

/** Move/zoom the wide banner crop for one player. The player's detected box is outlined. */
export function BannerCropEditor({ pick, player, candidate, outputName, onClose, onSave, onReset }: {
  pick: BgPick;
  player: Player;
  candidate: Candidate;
  outputName: string;
  onClose: () => void;
  onSave: (crop: { x: number; y: number; w: number }) => void;
  onReset: () => void;
}) {
  const { photo, detection } = candidate;
  const W = photo.width ?? 1, H = photo.height ?? 1;
  const src = useBlobUrl(`norm:${photo.id}`);
  const { crop, zoom, setZoom, dirtyFrom, handlers, onKeyDown } = useCropBox({
    width: W, height: H, aspect: BG_WIDTH / BG_HEIGHT, minWidth: 0.12, initial: pick.crop,
  });
  const dirty = dirtyFrom(pick.crop);
  const box = { x: detection.box.x / W, y: detection.box.y / H, w: detection.box.width / W, h: detection.box.height / H };
  const notes = dirty ? [] : flagNotes(pick.flags);

  return (
    <Modal title={`Crop for ${player.displayName}`} onClose={onClose} wide>
      <div className="editor editor--banner">
        <div>
          <p className="editor__tip">Drag to move. Drag a corner to zoom. Leave room for the play around the player.</p>
          <div className="editor__stage" style={{ aspectRatio: `${W} / ${H}`, width: `min(100%, calc(62vh * ${W / H}))` }}
            tabIndex={0} onKeyDown={onKeyDown} aria-label="Crop area. Arrow keys move the crop; plus and minus zoom.">
            {src && <img src={src} alt="" draggable={false} />}
            <span className="editor__subject" aria-hidden="true"
              style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />
            <div className="editor__box" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
              {...handlers("move")}>
              {CORNERS.map((c) => <span key={c} className={`editor__handle editor__handle--${c}`} {...handlers(c)} />)}
            </div>
          </div>
          <label className="editor__zoom">
            <span>Wider</span>
            <input type="range" min={0} max={1} step={0.001} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
            <span>Closer</span>
          </label>
        </div>

        <aside className="editor__side">
          <div>
            <span className="field__label">Player page header</span>
            <CropPreview src={src} crop={crop} aspect={BG_WIDTH / BG_HEIGHT} alt="Preview of the player page background" className="editor__preview editor__preview--banner" />
            <p className="small muted">{BG_WIDTH} × {BG_HEIGHT} · {pick.included ? outputName : "left out"}</p>
          </div>
          {notes.length > 0 && <div className="note note--warn small">{notes.map((n) => <div key={n}>{n}</div>)}</div>}
          <div className="editor__actions">
            <button type="button" className="button button--primary" onClick={() => onSave({ x: crop.x, y: crop.y, w: crop.w })} disabled={!dirty}>Save crop</button>
            <button type="button" className="button" onClick={onClose}>Cancel</button>
            <button type="button" className="button button--small hs-link" onClick={onReset}>Reset to automatic crop</button>
          </div>
        </aside>
      </div>
    </Modal>
  );
}

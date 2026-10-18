import type { Detection, Photo } from "../types";
import { useBlobUrl } from "./BlobImage";

/** A photo with every detected person outlined; the one under review is highlighted. */
export function PhotoFrame({ photo, detections, activeId, onSelect }: {
  photo: Photo;
  detections: Detection[];
  activeId?: string;
  onSelect?: (d: Detection) => void;
}) {
  const src = useBlobUrl(`norm:${photo.id}`);
  const w = photo.width ?? 1, h = photo.height ?? 1;
  if (!photo.width || !photo.height) return <div className="frame frame--empty">No preview available</div>;
  return (
    <div className="frame" style={{ aspectRatio: `${w} / ${h}` }}>
      {src && <img src={src} alt={photo.filename} />}
      <svg className="frame__overlay" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        {detections.filter((d) => !d.manual).map((d) => {
          const b = d.box;
          const tag = Math.max(18, Math.min(w, h) * 0.045);
          return (
            <g key={d.id} className={`box ${d.id === activeId ? "box--active" : ""} box--${d.status.toLowerCase()}`}
              onClick={() => onSelect?.(d)} style={{ cursor: onSelect ? "pointer" : undefined }}>
              <rect x={b.x} y={b.y} width={b.width} height={b.height} vectorEffect="non-scaling-stroke" />
              <rect className="box__tag" x={b.x} y={Math.max(0, b.y - tag)} width={tag * 1.1} height={tag} />
              <text x={b.x + tag * 0.55} y={Math.max(0, b.y - tag) + tag * 0.74} fontSize={tag * 0.7} textAnchor="middle">{d.index + 1}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

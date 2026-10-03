import type { Crop } from "../../state/types";

/** Shows exactly what the 1000×1500 file will contain, by positioning the preview image
 * inside a 2:3 window. No server render needed. */
export function CropPreview({ src, crop, alt, className = "" }: {
  src: string | null;
  crop: Crop | null;
  alt: string;
  className?: string;
}) {
  if (!src || !crop) return <div className={`crop-preview crop-preview--empty ${className}`} aria-label={alt} />;
  return (
    <div className={`crop-preview ${className}`}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          width: `${100 / crop.w}%`,
          left: `${(-crop.x / crop.w) * 100}%`,
          top: `${(-crop.y / crop.h) * 100}%`,
        }}
      />
    </div>
  );
}

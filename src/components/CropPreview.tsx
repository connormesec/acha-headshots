import type { Crop } from "../lib/geometry";

/** Shows exactly what the output file will contain, by positioning the preview image inside a
 * window of the output's aspect ratio. No render needed. */
export function CropPreview({ src, crop, alt, aspect = 2 / 3, className = "" }: {
  src: string | null;
  crop: Crop | null;
  alt: string;
  aspect?: number; // output width / height
  className?: string;
}) {
  const style = { aspectRatio: String(aspect) };
  if (!src || !crop) return <div className={`crop-preview crop-preview--empty ${className}`} style={style} aria-label={alt} />;
  return (
    <div className={`crop-preview ${className}`} style={style}>
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

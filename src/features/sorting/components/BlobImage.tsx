import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { getBlob } from "../../../db/repo";

/** An object URL for a stored photo or crop, revoked when no longer shown. */
export function useBlobUrl(key: string | null, enabled = true): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key || !enabled) return;
    let live = true;
    let made: string | null = null;
    void getBlob(key).then((b) => {
      if (!live || !b) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [key, enabled]);
  return url;
}

/** <img> from the browser's database, loaded only once it scrolls into view. */
export function BlobImage({ blobKey, alt, className, ...rest }: { blobKey: string | null; alt: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  const url = useBlobUrl(blobKey, visible);
  if (!url) return <span ref={ref} className={`${className ?? ""} blob-img--loading`} role="img" aria-label={alt} />;
  return <img src={url} alt={alt} className={className} {...rest} />;
}

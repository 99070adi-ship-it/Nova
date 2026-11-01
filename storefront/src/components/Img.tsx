import { useState } from "react";

/** A product/brand image that never shows a broken-image icon: if there is no URL, or it fails to load, a quiet tile
 * with the item's initial is shown instead (the same tile in every state, so layouts never jump). */
export default function Img({ src, alt, className = "", fallbackLabel }: { src?: string | null; alt: string; className?: string; fallbackLabel?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center bg-surface text-faint ${className}`} role="img" aria-label={alt}>
        <span aria-hidden="true" className="text-3xl font-light">{(fallbackLabel ?? alt).trim().charAt(0).toUpperCase()}</span>
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`object-cover ${className}`} />;
}

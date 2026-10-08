// A small, deliberately simple face for NOVA — not a mascot asset, an SVG so there's nothing to
// upload/license and it inherits the app's own neutral-900 palette. It's an animated character
// reacting to what's happening, not decoration: it blinks on its own (`index.css`'s nova-blink),
// its eyes shift toward `look` (where the spotlight currently is, so it visibly reads as NOVA
// looking at the thing it's about to touch), and its mouth animates only while `talking` is true
// (narration text is actually being said), so stillness reads as listening, not broken.
export type NovaLookDirection = "center" | "down" | "left" | "right";

const EYE_OFFSET: Record<NovaLookDirection, { x: number; y: number }> = {
  center: { x: 0, y: 0 },
  down: { x: 0, y: 2 },
  left: { x: -2, y: 0 },
  right: { x: 2, y: 0 },
};

export default function NovaFace({
  talking = false,
  look = "center",
  size = 36,
}: {
  talking?: boolean;
  look?: NovaLookDirection;
  size?: number;
}) {
  const eye = EYE_OFFSET[look];

  return (
    <div
      role="img"
      aria-label="NOVA"
      className="flex shrink-0 items-center justify-center rounded-full bg-neutral-900"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 40 40" width={size * 0.62} height={size * 0.62}>
        <circle
          className="nova-face-eye"
          cx={13 + eye.x}
          cy={17 + eye.y}
          r="3.2"
          fill="white"
          style={{ transition: "cx 300ms ease, cy 300ms ease" }}
        />
        <circle
          className="nova-face-eye"
          cx={27 + eye.x}
          cy={17 + eye.y}
          r="3.2"
          fill="white"
          style={{ transition: "cx 300ms ease, cy 300ms ease", animationDelay: "120ms" }}
        />
        <rect
          className={talking ? "nova-face-mouth-talking" : undefined}
          x="14"
          y={talking ? "25" : "26.5"}
          width="12"
          height={talking ? "5" : "2.2"}
          rx={talking ? "2.5" : "1.1"}
          fill="white"
          style={{ transition: "y 150ms ease, height 150ms ease" }}
        />
      </svg>
    </div>
  );
}

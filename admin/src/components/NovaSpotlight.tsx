// Everything outside the one real element NOVA is about to act on visibly loses focus — blurred
// and dimmed, not just dimmed — while NOVA demonstrates, then returns to normal the instant
// control hands back to the user (NovaSpotlight only renders at all while `rect` is set, which is
// only true during the demo's own spotlight actions — see hooks/useNovaLesson.ts). Implemented as
// four bands tiling the region outside the focused box (top/bottom/left/right) rather than a
// clip-path mask — simpler, and each band eases independently with the same spring motion as the
// focus ring and pointer, so the whole thing visibly travels together, not a static window.
const SPRING_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const MOVE = `top 550ms ${SPRING_EASING}, left 550ms ${SPRING_EASING}, width 550ms ${SPRING_EASING}, height 550ms ${SPRING_EASING}, right 550ms ${SPRING_EASING}, bottom 550ms ${SPRING_EASING}`;

export default function NovaSpotlight({ rect }: { rect: DOMRect | null }) {
  if (!rect) return null;

  const pad = 8;
  const box = {
    top: Math.max(rect.top - pad, 0),
    left: Math.max(rect.left - pad, 0),
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
  const pointer = { top: rect.top + rect.height / 2, left: rect.left + rect.width / 2 };

  const band: React.CSSProperties = {
    position: "fixed",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    backgroundColor: "rgba(10, 10, 10, 0.25)",
    transition: MOVE,
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div style={{ ...band, top: 0, left: 0, width: "100%", height: box.top }} />
      <div style={{ ...band, top: box.top + box.height, left: 0, width: "100%", bottom: 0 }} />
      <div style={{ ...band, top: box.top, left: 0, width: box.left, height: box.height }} />
      <div style={{ ...band, top: box.top, left: box.left + box.width, right: 0, height: box.height }} />

      <div
        className="absolute rounded-lg ring-2 ring-amber-400"
        style={{ top: box.top, left: box.left, width: box.width, height: box.height, transition: MOVE }}
      />
      <div
        className="nova-pointer-pulse absolute -ml-2 -mt-2 h-4 w-4 rounded-full border-2 border-white bg-amber-500"
        style={{
          top: pointer.top,
          left: pointer.left,
          transition: `top 550ms ${SPRING_EASING}, left 550ms ${SPRING_EASING}`,
        }}
      />
    </div>
  );
}

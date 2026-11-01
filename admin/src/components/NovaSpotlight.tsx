// Two modes, both fully click-through (pointer-events-none) so the app is never locked:
//  - "focus": everything outside the one real element NOVA is acting on is blurred and dimmed.
//    Used ONLY while NOVA is demonstrating.
//  - "cue": once control is handed to the user, the blur/dim is gone — just a quiet ring and pulse
//    on the control to press, so navigation and the rest of the page are fully usable. Implemented as
// four bands tiling the region outside the focused box (top/bottom/left/right) rather than a
// clip-path mask — simpler, and each band eases independently with the same spring motion as the
// focus ring and pointer, so the whole thing visibly travels together, not a static window.
const SPRING_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const MOVE = `top 550ms ${SPRING_EASING}, left 550ms ${SPRING_EASING}, width 550ms ${SPRING_EASING}, height 550ms ${SPRING_EASING}, right 550ms ${SPRING_EASING}, bottom 550ms ${SPRING_EASING}`;

export default function NovaSpotlight({ rect, mode = "focus" }: { rect: DOMRect | null; mode?: "focus" | "cue" }) {
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
    backgroundColor: "rgb(var(--fg) / 0.28)",
    transition: MOVE,
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40" data-nova-spotlight={mode}>
      {mode === "focus" && (
        <>
          <div data-nova-band style={{ ...band, top: 0, left: 0, width: "100%", height: box.top }} />
          <div data-nova-band style={{ ...band, top: box.top + box.height, left: 0, width: "100%", bottom: 0 }} />
          <div data-nova-band style={{ ...band, top: box.top, left: 0, width: box.left, height: box.height }} />
          <div data-nova-band style={{ ...band, top: box.top, left: box.left + box.width, right: 0, height: box.height }} />
        </>
      )}

      <div
        data-nova-ring
        className="absolute rounded-lg ring-2 ring-corona"
        style={{ top: box.top, left: box.left, width: box.width, height: box.height, transition: MOVE }}
      />
      <div
        className="nova-pointer-pulse absolute -ml-2 -mt-2 h-4 w-4 rounded-full border-2 border-white bg-corona"
        style={{
          top: pointer.top,
          left: pointer.left,
          transition: `top 550ms ${SPRING_EASING}, left 550ms ${SPRING_EASING}`,
        }}
      />
    </div>
  );
}

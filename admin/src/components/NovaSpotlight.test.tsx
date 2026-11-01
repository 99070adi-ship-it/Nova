import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NovaSpotlight from "./NovaSpotlight";

function rect(overrides: Partial<DOMRect> = {}): DOMRect {
  return { top: 100, left: 50, width: 120, height: 40, bottom: 140, right: 170, x: 50, y: 100, toJSON: () => ({}), ...overrides };
}

describe("NovaSpotlight — background blurs, the focused element doesn't", () => {
  it("renders nothing when there is nothing to focus on", () => {
    const { container } = render(<NovaSpotlight rect={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  // jsdom doesn't recognize backdrop-filter (or the token-based tint) as valid CSS and silently
  // drops them from the serialized style (a test-environment gap, not a real one), so the bands are
  // identified by their stable data attribute; the blur is a real inline style NovaSpotlight.tsx
  // sets unconditionally on every band.
  function dimmedBands(container: HTMLElement) {
    return Array.from(container.querySelectorAll("[data-nova-band]")) as HTMLElement[];
  }

  it("renders exactly four dimmed bands tiling everything outside the focused box", () => {
    const { container } = render(<NovaSpotlight rect={rect()} />);
    expect(dimmedBands(container)).toHaveLength(4);
  });

  it("the top band's height stops exactly where the focused box (plus padding) begins", () => {
    const { container } = render(<NovaSpotlight rect={rect({ top: 100 })} />);
    const topBand = dimmedBands(container).find((el) => el.style.top === "0px")!;
    // pad=8, so the box starts at 100-8=92 — the band above it is exactly that tall.
    expect(topBand.style.height).toBe("92px");
  });

  it("never blurs the focused element itself — no band covers the box's own area", () => {
    const { container } = render(<NovaSpotlight rect={rect({ top: 100, left: 50, width: 120, height: 40 })} />);
    const ring = container.querySelector("[data-nova-ring]") as HTMLElement;
    expect(ring.style.top).toBe("92px"); // 100 - 8 padding
    expect(ring.style.left).toBe("42px"); // 50 - 8 padding
  });

  it("in 'cue' mode (the user's turn) there is no blur or dim at all — only the ring and pointer", () => {
    const { container } = render(<NovaSpotlight rect={rect()} mode="cue" />);
    expect(dimmedBands(container)).toHaveLength(0);
    expect(container.querySelector("[data-nova-ring]")).not.toBeNull();
    expect(container.firstElementChild?.className).toContain("pointer-events-none");
  });
});

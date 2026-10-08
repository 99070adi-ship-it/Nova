import { describe, expect, it, vi } from "vitest";
import { getTarget, runUIAction, runUIActions, setControlledValue } from "./novaUiActions";

function makeControlledInput(onChange: (v: string) => void): HTMLInputElement {
  const input = document.createElement("input");
  document.body.appendChild(input);
  input.addEventListener("input", (e) => onChange((e.target as HTMLInputElement).value));
  return input;
}

describe("novaUiActions — the allowlisted UI Action Protocol", () => {
  it("getTarget only resolves known data-nova-target elements, never an arbitrary selector", () => {
    const el = document.createElement("div");
    el.setAttribute("data-nova-target", "product_form.title");
    document.body.appendChild(el);

    expect(getTarget("product_form.title")).toBe(el);
    expect(getTarget("some.unknown.key")).toBeNull();
    el.remove();
  });

  it("setControlledValue fires a real input event so React's own onChange handler runs", () => {
    const onChange = vi.fn();
    const input = makeControlledInput(onChange);

    setControlledValue(input, "Classic Canvas Tote");

    expect(onChange).toHaveBeenCalledWith("Classic Canvas Tote");
    expect(input.value).toBe("Classic Canvas Tote");
    input.remove();
  });

  it("fill_field and clear_field drive the real target through the same controlled-value path", async () => {
    const onChange = vi.fn();
    const input = makeControlledInput(onChange);
    input.setAttribute("data-nova-target", "product_form.title");
    const onSpotlight = vi.fn();

    await runUIAction({ type: "fill_field", target: "product_form.title", value: "Demo Tote" }, { onSpotlight });
    expect(input.value).toBe("Demo Tote");

    await runUIAction({ type: "clear_field", target: "product_form.title" }, { onSpotlight });
    expect(input.value).toBe("");
    input.remove();
  });

  it("a missing target is a safe no-op — a lesson must never throw and break the page", async () => {
    const onSpotlight = vi.fn();
    await expect(
      runUIAction({ type: "fill_field", target: "nonexistent.target", value: "x" }, { onSpotlight }),
    ).resolves.toBeUndefined();
    await expect(runUIAction({ type: "spotlight", target: "nonexistent.target" }, { onSpotlight })).resolves.toBeUndefined();
    expect(onSpotlight).toHaveBeenCalledWith(null);
  });

  it("spotlight reports the real target's bounding box, not a synthesized/fake one", async () => {
    const el = document.createElement("button");
    el.setAttribute("data-nova-target", "product_form.save");
    document.body.appendChild(el);
    el.scrollIntoView = vi.fn();
    const rect = { top: 1, left: 2, width: 3, height: 4 } as DOMRect;
    el.getBoundingClientRect = vi.fn().mockReturnValue(rect);
    const onSpotlight = vi.fn();

    await runUIAction({ type: "spotlight", target: "product_form.save" }, { onSpotlight });

    expect(onSpotlight).toHaveBeenCalledWith(rect);
    el.remove();
  });

  it("runUIActions executes an allowlisted sequence in order", async () => {
    const title = document.createElement("input");
    title.setAttribute("data-nova-target", "product_form.title");
    document.body.appendChild(title);
    const onSpotlight = vi.fn();

    await runUIActions(
      [
        { type: "fill_field", target: "product_form.title", value: "A" },
        { type: "fill_field", target: "product_form.title", value: "B" },
      ],
      { onSpotlight },
      1,
    );

    expect(title.value).toBe("B");
    title.remove();
  });
});

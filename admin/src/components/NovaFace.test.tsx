import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NovaFace from "./NovaFace";

describe("NovaFace", () => {
  it("renders as a labeled image so it's identifiable without relying on visible text", () => {
    render(<NovaFace />);
    expect(screen.getByRole("img", { name: "NOVA" })).toBeInTheDocument();
  });

  it("only animates the talking mouth class while talking is true", () => {
    const { rerender, container } = render(<NovaFace talking={false} />);
    expect(container.querySelector(".nova-face-mouth-talking")).not.toBeInTheDocument();

    rerender(<NovaFace talking />);
    expect(container.querySelector(".nova-face-mouth-talking")).toBeInTheDocument();
  });

  it("shifts both eyes by the same offset for each look direction", () => {
    const { container } = render(<NovaFace look="down" />);
    const eyes = container.querySelectorAll(".nova-face-eye");
    expect(eyes).toHaveLength(2);
    expect(eyes[0].getAttribute("cy")).toBe("19");
    expect(eyes[1].getAttribute("cy")).toBe("19");
  });
});

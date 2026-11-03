import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GuideVoiceSetup from "./GuideVoiceSetup";
import type { VoiceProgress } from "../lib/browserSpeech";

const progress = (over: Partial<VoiceProgress> = {}): VoiceProgress => ({ state: "loading", percent: null, loadedBytes: 0, totalBytes: 0, ...over });
const MB = 1024 * 1024;

describe("GuideVoiceSetup", () => {
  it("explains the one-time update and shows a determinate bar with real numbers", () => {
    render(<GuideVoiceSetup progress={progress({ percent: 42, loadedBytes: 38 * MB, totalBytes: 90 * MB })} failed={false} onContinueInText={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("Setting up NOVA's voice");
    expect(screen.getByText(/one-time update is downloading to your browser/)).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Downloading NOVA's voice" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByTestId("guide-voice-setup-status")).toHaveTextContent("42% · 38 of 90 MB");
  });

  it("shows an indeterminate bar, without claiming a download, before any bytes are known (e.g. loading from cache)", () => {
    render(<GuideVoiceSetup progress={progress()} failed={false} onContinueInText={() => {}} />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByTestId("guide-voice-setup-status")).toHaveTextContent("Preparing…");
    expect(screen.queryByText(/downloading to your browser/)).not.toBeInTheDocument();
  });

  it("always lets the person skip to text", () => {
    const onContinueInText = vi.fn();
    render(<GuideVoiceSetup progress={progress({ percent: 5, loadedBytes: MB, totalBytes: 20 * MB })} failed={false} onContinueInText={onContinueInText} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip and use text only" }));
    expect(onContinueInText).toHaveBeenCalledTimes(1);
  });

  it("says plainly when the voice could not be set up, with no stuck bar", () => {
    const onContinueInText = vi.fn();
    render(<GuideVoiceSetup progress={progress({ state: "failed" })} failed onContinueInText={onContinueInText} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("couldn't be set up");
    expect(screen.getByRole("alert")).toHaveTextContent("guide you in text");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue in text" }));
    expect(onContinueInText).toHaveBeenCalledTimes(1);
  });
});

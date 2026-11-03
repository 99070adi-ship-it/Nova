import { beforeEach, describe, expect, it, vi } from "vitest";
import * as voice from "./browserSpeech";

beforeEach(() => voice.resetForTests());

describe("browser voice download progress", () => {
  it("starts unknown, so the UI shows an indeterminate bar", () => {
    expect(voice.getProgress()).toMatchObject({ state: "not_loaded", percent: null, loadedBytes: 0, totalBytes: 0 });
  });

  it("folds per-file events into one overall percentage and byte count", () => {
    voice.onDownloadEvent({ status: "progress", file: "model.onnx", loaded: 30, total: 100 });
    expect(voice.getProgress()).toMatchObject({ percent: 30, loadedBytes: 30, totalBytes: 100 });
    voice.onDownloadEvent({ status: "progress", file: "voices.bin", loaded: 10, total: 100 });
    expect(voice.getProgress()).toMatchObject({ percent: 30, loadedBytes: 40, totalBytes: 200 }); // raw 20%, but the bar never moves back
    voice.onDownloadEvent({ status: "done", file: "voices.bin" });
    expect(voice.getProgress()).toMatchObject({ percent: 65, loadedBytes: 130, totalBytes: 200 });
  });

  it("never goes backwards when a new file starts and raises the known total", () => {
    voice.onDownloadEvent({ status: "progress", file: "a", loaded: 90, total: 100 });
    expect(voice.getProgress().percent).toBe(90);
    voice.onDownloadEvent({ status: "progress", file: "b", loaded: 0, total: 900 });
    expect(voice.getProgress().percent).toBe(90); // the raw ratio would now be 9%
  });

  it("holds at 99 until the model is really ready, then 100", () => {
    voice.onDownloadEvent({ status: "progress", file: "a", loaded: 100, total: 100 });
    expect(voice.getProgress().percent).toBe(99);
  });

  it("ignores events it cannot use (no file name, no totals, unrelated statuses)", () => {
    voice.onDownloadEvent({ status: "progress", loaded: 5, total: 10 });
    voice.onDownloadEvent({ status: "progress", file: "a" });
    voice.onDownloadEvent({ status: "initiate", file: "a" });
    expect(voice.getProgress().percent).toBeNull();
  });

  it("notifies subscribers with a new snapshot object each time, and stops after unsubscribe", () => {
    const listener = vi.fn();
    const off = voice.subscribe(listener);
    const before = voice.getProgress();
    voice.onDownloadEvent({ status: "progress", file: "a", loaded: 1, total: 10 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(voice.getProgress()).not.toBe(before);
    off();
    voice.onDownloadEvent({ status: "progress", file: "a", loaded: 2, total: 10 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reports an unsupported browser as failed straight away, without downloading anything", () => {
    // jsdom has no Worker, which is exactly the 'cannot run the voice' case
    expect(voice.isSupported()).toBe(false);
    expect(voice.status()).toMatchObject({ engine: "kokoro-browser", state: "failed", ready: false });
    expect(voice.warmUp().state).toBe("failed");
    expect(voice.getProgress().state).toBe("failed");
  });

  it("measures against the expected size, so a tiny first file cannot send the bar to ~100%", () => {
    voice.setExpectedBytes(1000);
    voice.onDownloadEvent({ status: "progress", file: "config.json", loaded: 5, total: 5 }); // finished instantly
    expect(voice.getProgress().percent).toBe(1);
    voice.onDownloadEvent({ status: "progress", file: "model.onnx", loaded: 500, total: 900 });
    expect(voice.getProgress()).toMatchObject({ percent: 51, loadedBytes: 505, totalBytes: 1000 });
  });

  it("uses the real total once it exceeds the expectation", () => {
    voice.setExpectedBytes(100);
    voice.onDownloadEvent({ status: "progress", file: "a", loaded: 100, total: 400 });
    expect(voice.getProgress()).toMatchObject({ percent: 25, totalBytes: 400 });
  });
});

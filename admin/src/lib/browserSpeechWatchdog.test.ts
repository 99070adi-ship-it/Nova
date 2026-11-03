import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A browser that *can* run the voice (workers exist), whose model download never makes progress.
async function setup(fromPretrained: (...a: unknown[]) => Promise<unknown>) {
  vi.resetModules();
  vi.stubGlobal("Worker", class {});
  vi.doMock("kokoro-js", () => ({ KokoroTTS: { from_pretrained: fromPretrained } }));
  vi.doMock("@huggingface/transformers", () => ({ env: { backends: { onnx: { wasm: {} } } } }));
  return import("./browserSpeech");
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("kokoro-js");
  vi.doUnmock("@huggingface/transformers");
});

describe("browser voice watchdog", () => {
  it("gives up cleanly when no byte arrives for a long time, so the setup screen can offer text instead of hanging", async () => {
    const voice = await setup(() => new Promise(() => {})); // never resolves
    voice.warmUp();
    await vi.advanceTimersByTimeAsync(1000);
    expect(voice.getProgress().state).toBe("loading");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(voice.getProgress().state).toBe("failed");
    await expect(voice.synthesize("hi")).rejects.toThrow();
  });

  it("does not give up on a slow download that keeps making progress", async () => {
    let finish: (v: unknown) => void = () => {};
    let progressCb: (e: unknown) => void = () => {};
    const voice = await setup((_id, opts) => {
      progressCb = (opts as { progress_callback: (e: unknown) => void }).progress_callback;
      return new Promise((resolve) => (finish = resolve));
    });
    voice.warmUp();
    await vi.advanceTimersByTimeAsync(1000);
    for (let loaded = 1; loaded <= 10; loaded++) {
      progressCb({ status: "progress", file: "model.onnx", loaded, total: 10 });
      await vi.advanceTimersByTimeAsync(30_000); // 5 minutes in total, but never 45 s without a byte
    }
    expect(voice.getProgress().state).toBe("loading");
    finish({ generate: async () => ({ toBlob: () => new Blob(["x"]) }) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(voice.getProgress()).toMatchObject({ state: "ready", percent: 100 });
  });

  it("moves to the 'starting' phase once the files are in, and is ready after the first synthesis", async () => {
    const voice = await setup(async () => ({ generate: async () => ({ toBlob: () => new Blob(["x"]) }) }));
    voice.warmUp();
    await vi.advanceTimersByTimeAsync(1000);
    expect(voice.getProgress()).toMatchObject({ state: "ready", percent: 100 });
  });
});

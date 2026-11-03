import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = { fetchSpeech: vi.fn(), warmUpSpeech: vi.fn(), getSpeechStatus: vi.fn() };
const browser = { isSupported: vi.fn(), warmUp: vi.fn(), synthesize: vi.fn(), status: vi.fn() };
const SERVER = new Blob(["server"], { type: "audio/wav" });
const BROWSER = new Blob(["browser"], { type: "audio/wav" });
const ready = { engine: "kokoro-browser", state: "ready" as const, ready: true };

async function load(engine?: string) {
  vi.resetModules();
  vi.doMock("../api/client", () => server);
  vi.doMock("./browserSpeech", () => browser);
  if (engine) vi.stubEnv("VITE_VOICE_ENGINE", engine);
  return import("./speechSource");
}

beforeEach(() => {
  vi.resetAllMocks();
  browser.isSupported.mockReturnValue(true);
  browser.warmUp.mockReturnValue(ready);
});
afterEach(() => vi.unstubAllEnvs());

describe("speechSource", () => {
  it("auto: uses the server when it works and never touches the browser engine", async () => {
    server.warmUpSpeech.mockResolvedValue({ engine: "kokoro", state: "ready", ready: true });
    server.fetchSpeech.mockResolvedValue(SERVER);
    const s = await load();
    expect((await s.warmUpAuto(true)).engine).toBe("kokoro");
    expect(await s.fetchSpeechAuto("hi")).toBe(SERVER);
    expect(browser.warmUp).not.toHaveBeenCalled();
    expect(browser.synthesize).not.toHaveBeenCalled();
  });

  it("auto: when the server has no voice model, switches to the browser engine and stays there", async () => {
    server.warmUpSpeech.mockResolvedValue({ engine: "kokoro", state: "failed", ready: false });
    browser.synthesize.mockResolvedValue(BROWSER);
    const s = await load();
    expect((await s.warmUpAuto(true)).engine).toBe("kokoro-browser");
    expect(await s.fetchSpeechAuto("hi")).toBe(BROWSER);
    expect(server.fetchSpeech).not.toHaveBeenCalled(); // no wasted round trip once resolved
    expect(await s.warmUpAuto(false)).toEqual(ready);
    expect(server.getSpeechStatus).not.toHaveBeenCalled();
  });

  it("auto: a server error also falls back to the browser engine", async () => {
    server.warmUpSpeech.mockRejectedValue(new Error("500"));
    const s = await load();
    expect((await s.warmUpAuto(true)).engine).toBe("kokoro-browser");
  });

  it("auto: if the browser cannot run it either, the original failure surfaces so the Guide carries on in text", async () => {
    browser.isSupported.mockReturnValue(false);
    server.warmUpSpeech.mockRejectedValue(new Error("500"));
    server.fetchSpeech.mockRejectedValue(new Error("503"));
    const s = await load();
    await expect(s.warmUpAuto(true)).rejects.toThrow("500");
    await expect(s.fetchSpeechAuto("hi")).rejects.toThrow("503");
  });

  it("auto: a cancelled request is not treated as a server failure", async () => {
    server.fetchSpeech.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    const s = await load();
    await expect(s.fetchSpeechAuto("hi", new AbortController().signal)).rejects.toThrow("Aborted");
    expect(browser.synthesize).not.toHaveBeenCalled();
  });

  it("VITE_VOICE_ENGINE=browser goes straight to the browser and never calls the backend", async () => {
    browser.synthesize.mockResolvedValue(BROWSER);
    const s = await load("browser");
    expect(await s.warmUpAuto(true)).toEqual(ready);
    expect(await s.fetchSpeechAuto("hi")).toBe(BROWSER);
    expect(server.warmUpSpeech).not.toHaveBeenCalled();
    expect(server.fetchSpeech).not.toHaveBeenCalled();
  });

  it("VITE_VOICE_ENGINE=server never uses the browser engine", async () => {
    server.fetchSpeech.mockResolvedValue(SERVER);
    server.getSpeechStatus.mockResolvedValue({ engine: "kokoro", state: "failed", ready: false });
    const s = await load("server");
    expect((await s.warmUpAuto(false)).state).toBe("failed");
    expect(await s.fetchSpeechAuto("hi")).toBe(SERVER);
    expect(browser.warmUp).not.toHaveBeenCalled();
  });

  it("browser engine: does not start the download until voice is actually chosen", async () => {
    browser.status.mockReturnValue({ engine: "kokoro-browser", state: "not_loaded", ready: false });
    const s = await load("browser");
    expect((await s.warmUpAuto(true, false)).state).toBe("not_loaded");
    expect(browser.warmUp).not.toHaveBeenCalled(); // someone who picks text never downloads 90 MB
    expect(await s.warmUpAuto(true, true)).toEqual(ready);
    expect(browser.warmUp).toHaveBeenCalledTimes(1);
  });

  it("paces speech by engine: whole messages and the default grace for the server, sentence by sentence and a long grace for the browser", async () => {
    const server = await load("server");
    expect(server.voiceTuning()).toEqual({ chunkChars: 480, maxChunks: 6, startGraceMs: undefined, prefetchChunks: 2 });
    expect(server.usesBrowserVoice()).toBe(false);
    const browserMode = await load("browser");
    const t = browserMode.voiceTuning();
    expect(t.chunkChars).toBeLessThan(160); // a typical two-sentence line becomes two chunks
    expect(t.startGraceMs).toBeGreaterThan(6000); // longer than the Guide's default give-up time
    expect(t.prefetchChunks).toBe(0); // synthesis is one-at-a-time on the visitor's CPU: a prefetch would queue ahead of the line being spoken
    expect(browserMode.usesBrowserVoice()).toBe(true);
  });
});

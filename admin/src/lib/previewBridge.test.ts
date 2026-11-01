import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, acceptPreviewMessage, parsePreviewEvent, sendToPreview } from "./previewBridge";

const DRAFT = "11111111-1111-4111-8111-111111111111";
const SECTION = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "http://localhost:5174";
const ok = { source: "nova-preview", v: PROTOCOL_VERSION, versionId: DRAFT };

describe("preview -> Store Builder messages", () => {
  it("accepts the four well-formed events", () => {
    expect(parsePreviewEvent({ ...ok, type: "ready" })).toEqual({ type: "ready", versionId: DRAFT });
    expect(parsePreviewEvent({ ...ok, type: "select", sectionId: SECTION, element: "hero.headline" })).toEqual({ type: "select", versionId: DRAFT, sectionId: SECTION, element: "hero.headline" });
    expect(parsePreviewEvent({ ...ok, type: "select", sectionId: null, element: "theme.style" })).toMatchObject({ sectionId: null });
    expect(parsePreviewEvent({ ...ok, type: "unsupported" })).toEqual({ type: "unsupported", versionId: DRAFT });
    expect(parsePreviewEvent({ ...ok, type: "location", path: "/products" })).toMatchObject({ path: "/products" });
  });

  it.each([
    ["wrong source", { ...ok, source: "someone", type: "ready" }],
    ["wrong protocol version", { ...ok, v: 2, type: "ready" }],
    ["no version id", { source: "nova-preview", v: 1, type: "ready" }],
    ["malformed version id", { ...ok, versionId: "<script>", type: "ready" }],
    ["unknown type", { ...ok, type: "run", code: "alert(1)" }],
    ["element key with code", { ...ok, type: "select", sectionId: SECTION, element: "hero.h');alert(1);//" }],
    ["section id that isn't an id", { ...ok, type: "select", sectionId: "javascript:1", element: "hero.headline" }],
    ["location that isn't a path", { ...ok, type: "location", path: "https://evil.example" }],
    ["a string", "select"],
    ["undefined", undefined],
  ])("rejects %s", (_n, data) => {
    expect(parsePreviewEvent(data)).toBeNull();
  });
});

describe("who Store Builder listens to", () => {
  const frameWindow = {} as Window;
  const event = (over: Partial<MessageEvent> = {}) => ({ origin: ORIGIN, source: frameWindow, data: { ...ok, type: "ready" }, ...over }) as MessageEvent;

  it("accepts a message from the preview window at the storefront's origin about THIS draft", () => {
    expect(acceptPreviewMessage(event(), frameWindow, ORIGIN, DRAFT)).toEqual({ type: "ready", versionId: DRAFT });
  });

  it("refuses another origin, another window, a missing frame, or a different draft", () => {
    expect(acceptPreviewMessage(event({ origin: "https://evil.example" }), frameWindow, ORIGIN, DRAFT)).toBeNull();
    expect(acceptPreviewMessage(event({ source: {} as Window }), frameWindow, ORIGIN, DRAFT)).toBeNull();
    expect(acceptPreviewMessage(event(), null, ORIGIN, DRAFT)).toBeNull();
    expect(acceptPreviewMessage(event(), frameWindow, ORIGIN, "99999999-9999-4999-8999-999999999999")).toBeNull();
  });
});

describe("Store Builder -> preview commands", () => {
  it("posts to the storefront origin only, with identifiers and enums", () => {
    const postMessage = vi.fn();
    sendToPreview({ postMessage } as unknown as Window, ORIGIN, { type: "select", sectionId: SECTION, element: "hero.headline" });
    expect(postMessage).toHaveBeenCalledWith({ source: "nova-admin", v: 1, type: "select", sectionId: SECTION, element: "hero.headline" }, ORIGIN);
  });
  it("does nothing without a frame", () => {
    expect(() => sendToPreview(null, ORIGIN, { type: "refresh" })).not.toThrow();
  });
});

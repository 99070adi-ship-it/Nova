import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import registry from "../../../contracts/editable-elements.json";
import { baseRoutes, collection, mockApi, product, renderApp, storefront } from "../test/helpers";
import { EditorController } from "./controller";
import { PROTOCOL_VERSION, parseAdminMessage, toParent, verifiedParentOrigin } from "./protocol";

const ORIGIN = "http://localhost:5173";
const VERSION = "33333333-3333-4333-8333-333333333333";
const SECTION = "44444444-4444-4444-8444-444444444444";

afterEach(() => vi.unstubAllGlobals());

// ---- the contract: what the renderer tags is exactly what the registry says is editable ----

describe("click-to-edit tagging matches the editable-element registry", () => {
  const richStorefront = () => storefront({
    pages: [{ slug: "home", title: "Home", order: 0, sections: [
      { id: "s1", type: "hero", order: 0, configuration: { headline: "H", subheadline: "S", cta_text: "Go", cta_href: "/products", image_url: "/static/x.svg" } },
      { id: "s2", type: "collection_grid", order: 1, configuration: { title: "Collections", limit: 4 } },
      { id: "s3", type: "product_grid", order: 2, configuration: { title: "Products", limit: 4, collection_id: null } },
      { id: "s4", type: "feature_banner", order: 3, configuration: { eyebrow: "E", heading: "Banner", body: "Body", cta_text: "More", cta_href: "/products" } },
      { id: "s5", type: "brand_story", order: 4, configuration: { heading: "Story", body: "Text" } },
    ] }],
  });

  it("every registry element is tagged by the renderer, and nothing else is", async () => {
    mockApi(baseRoutes({ "/stores/velora-x/storefront": richStorefront() }));
    renderApp();
    await screen.findByText("Banner");
    await waitFor(() => expect(document.querySelector("[data-nova-section] a[href*='/collections/']")).not.toBeNull());
    const rendered = new Set(Array.from(document.querySelectorAll("[data-nova-el]")).map((e) => e.getAttribute("data-nova-el")!));
    const expected = new Set((registry.elements as Array<{ key: string }>).map((e) => e.key));
    expect([...rendered].filter((k) => !expected.has(k))).toEqual([]); // nothing editable that the registry doesn't know
    expect([...expected].filter((k) => !rendered.has(k))).toEqual([]); // nothing in the registry that can't be clicked
  });

  it("each section is tagged with its stable id and every element sits inside its own section", async () => {
    mockApi(baseRoutes({ "/stores/velora-x/storefront": richStorefront() }));
    renderApp();
    await screen.findByText("Banner");
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-nova-section]"));
    expect(sections.map((s) => s.getAttribute("data-nova-section"))).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    for (const s of sections) {
      const type = s.getAttribute("data-section-type")!;
      for (const el of Array.from(s.querySelectorAll("[data-nova-el]"))) expect(el.getAttribute("data-nova-el")!.startsWith(`${type}.`)).toBe(true);
    }
  });

  it("section presentation settings take effect, and invalid ones fall back to the approved look", async () => {
    const sf = storefront({ pages: [{ slug: "home", title: "Home", order: 0, sections: [
      { id: "a", type: "brand_story", order: 0, configuration: { heading: "A story", body: "x", spacing: "spacious", background: "inverse", align: "left" } },
      { id: "b", type: "brand_story", order: 1, configuration: { heading: "Another", body: "y", spacing: "banana", background: "url(evil)", align: "right" } },
    ] }] });
    mockApi(baseRoutes({ "/stores/velora-x/storefront": sf }));
    renderApp();
    await screen.findByText("A story");
    const [a, b] = Array.from(document.querySelectorAll<HTMLElement>("[data-nova-section]"));
    expect(a.style.paddingBlock).toBe("7rem");
    expect(a.className).toContain("bg-canvas");
    expect(a.style.getPropertyValue("--sf-bg")).toBe("var(--sf-primary-base)"); // inverted palette
    expect(a.querySelector("div")!.className).toContain("text-left");
    expect(b.style.paddingBlock).toBe("4rem");
    expect(b.className).not.toContain("bg-canvas");
    expect(b.querySelector("div")!.className).toContain("text-center");
  });

  it("the theme's button style is applied to the whole site", async () => {
    mockApi(baseRoutes({ "/stores/velora-x/storefront": storefront({ theme: { primary_color: "#111111", background_color: "#ffffff", button_style: "outline" } }) }));
    renderApp();
    await screen.findByText("Quiet leather");
    expect(document.documentElement.dataset.buttonStyle).toBe("outline");
  });
});

// ---- the protocol ----

describe("message protocol", () => {
  const ok = { source: "nova-admin", v: PROTOCOL_VERSION };
  it("accepts only well-formed admin messages", () => {
    expect(parseAdminMessage({ ...ok, type: "mode", mode: "interact" })).toEqual({ type: "mode", mode: "interact" });
    expect(parseAdminMessage({ ...ok, type: "select", sectionId: SECTION, element: "hero.headline" })).toEqual({ type: "select", sectionId: SECTION, element: "hero.headline" });
    expect(parseAdminMessage({ ...ok, type: "select", sectionId: null, element: "theme.style" })).not.toBeNull();
    expect(parseAdminMessage({ ...ok, type: "refresh" })).toEqual({ type: "refresh" });
  });

  it.each([
    ["wrong source", { source: "evil", v: 1, type: "refresh" }],
    ["wrong version", { source: "nova-admin", v: 99, type: "refresh" }],
    ["unknown type", { ...ok, type: "eval", code: "alert(1)" }],
    ["bad mode", { ...ok, type: "mode", mode: "admin" }],
    ["bad element key", { ...ok, type: "select", sectionId: SECTION, element: "hero.headline'];alert(1);//" }],
    ["bad section id", { ...ok, type: "select", sectionId: "<img src=x>", element: "hero.headline" }],
    ["not an object", "refresh"],
    ["null", null],
  ])("ignores %s", (_name, data) => {
    expect(parseAdminMessage(data)).toBeNull();
  });

  it("what the preview sends contains identifiers only", () => {
    const m = toParent({ type: "select", versionId: VERSION, sectionId: SECTION, element: "hero.headline" });
    expect(Object.keys(m).sort()).toEqual(["element", "sectionId", "source", "type", "v", "versionId"]);
  });
});

describe("who the preview will talk to", () => {
  const frame = (parent: Window | null, origins: string[], referrer = "") => ({
    parent: parent ?? undefined, location: { ancestorOrigins: origins }, document: { referrer },
  }) as unknown as Window;
  it("is nobody unless embedded by an allowed admin origin", () => {
    const self = {} as Window;
    const w = { parent: self, location: {}, document: { referrer: "" } } as unknown as Window;
    (w as { parent: Window }).parent = w;
    expect(verifiedParentOrigin(w)).toBeNull(); // not framed
    expect(verifiedParentOrigin(frame({} as Window, [ORIGIN]), undefined)).toBe(ORIGIN);
    expect(verifiedParentOrigin(frame({} as Window, ["https://evil.example"]))).toBeNull();
    expect(verifiedParentOrigin(frame({} as Window, [], `${ORIGIN}/store-builder`))).toBe(ORIGIN); // referrer fallback
    expect(verifiedParentOrigin(frame({} as Window, [], "https://evil.example/x"))).toBeNull();
    expect(verifiedParentOrigin(frame({} as Window, ["https://admin.example"]), "https://admin.example")).toBe("https://admin.example");
  });
});

// ---- the controller (selection layer) ----

describe("EditorController", () => {
  let posted: Array<{ message: Record<string, unknown>; origin: string }>;
  let controller: EditorController;
  const parent = { postMessage: (message: unknown, origin: string) => posted.push({ message: message as Record<string, unknown>, origin }) };

  beforeEach(() => {
    posted = [];
    document.body.innerHTML = `
      <header data-nova-el="theme.style"><a href="/products" id="nav">Shop</a></header>
      <section data-nova-section="${SECTION}" data-nova-el="hero.section">
        <h1 data-nova-el="hero.headline" id="h">Quiet leather</h1>
        <p id="plain">Not editable</p>
        <a data-nova-el="hero.cta" href="/products" id="cta">Go</a>
      </section>`;
    controller = new EditorController(document, { ...window, addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window), parent: window, matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} } as unknown as Window, parent, ORIGIN, VERSION);
  });
  afterEach(() => controller.dispose());

  const click = (el: Element) => {
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
  };

  it("announces itself to the verified parent only", () => {
    expect(posted[0]).toMatchObject({ origin: ORIGIN, message: { type: "ready", versionId: VERSION } });
  });

  it("clicking an element reports its stable identifier and does not navigate", () => {
    const ev = click(document.getElementById("cta")!);
    expect(ev.defaultPrevented).toBe(true);
    expect(posted[posted.length - 1].message).toMatchObject({ type: "select", sectionId: SECTION, element: "hero.cta", versionId: VERSION });
    expect(posted[posted.length - 1].origin).toBe(ORIGIN);
    expect(controller.current).toEqual({ sectionId: SECTION, element: "hero.cta" });
  });

  it("selects the innermost element, and the section style when the section itself is clicked", () => {
    click(document.getElementById("h")!);
    expect(posted[posted.length - 1].message).toMatchObject({ element: "hero.headline" });
    click(document.querySelector("section")!);
    expect(posted[posted.length - 1].message).toMatchObject({ element: "hero.section", sectionId: SECTION });
  });

  it("the theme is selected from the site chrome and carries no section", () => {
    click(document.getElementById("nav")!);
    expect(posted[posted.length - 1].message).toMatchObject({ type: "select", element: "theme.style", sectionId: null });
  });

  it("a click on something not editable says so instead of selecting", () => {
    const outside = document.createElement("p");
    document.body.appendChild(outside);
    click(outside);
    expect(posted[posted.length - 1].message).toMatchObject({ type: "unsupported" });
    expect(controller.current).toBeNull();
  });

  it("never reports or embeds page content: only identifiers leave the preview", () => {
    click(document.getElementById("h")!);
    const sent = JSON.stringify(posted.map((p) => p.message));
    expect(sent).not.toContain("Quiet leather");
    expect(sent).not.toContain("<");
  });

  it("interact mode leaves clicks alone so links work", () => {
    controller.handle({ type: "mode", mode: "interact" });
    const before = posted.length;
    const ev = click(document.getElementById("cta")!);
    expect(ev.defaultPrevented).toBe(false);
    expect(posted.length).toBe(before);
    controller.handle({ type: "mode", mode: "select" });
    expect(click(document.getElementById("cta")!).defaultPrevented).toBe(true);
  });

  it("the outline selects: a select message highlights the element and scrolls it into view", () => {
    const h = document.getElementById("h")!;
    const scroll = vi.fn();
    h.scrollIntoView = scroll;
    controller.handle({ type: "select", sectionId: SECTION, element: "hero.headline" });
    expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "center" }); // reduced motion in this test: no smooth scroll
    const box = document.querySelectorAll<HTMLElement>("[data-nova-overlay]")[1];
    expect(box.style.display).toBe("block");
    expect(box.textContent).toBe("Hero headline");
    controller.handle({ type: "clear" });
    expect(box.style.display).toBe("none");
  });

  it("overlays live outside the storefront markup and never alter it", () => {
    const snapshot = document.querySelector("section")!.outerHTML;
    click(document.getElementById("h")!);
    controller.handle({ type: "select", sectionId: SECTION, element: "hero.headline" });
    expect(document.querySelector("section")!.outerHTML).toBe(snapshot);
    for (const o of Array.from(document.querySelectorAll<HTMLElement>("[data-nova-overlay]"))) {
      expect(o.parentElement).toBe(document.body);
      expect(o.style.pointerEvents).toBe("none");
    }
  });

  it("ignores messages from the wrong origin, the wrong window, or in the wrong shape", () => {
    const spy = vi.fn();
    controller.onRefresh = spy;
    const send = (init: MessageEventInit) => window.dispatchEvent(new MessageEvent("message", init));
    const good = { source: "nova-admin", v: 1, type: "refresh" };
    send({ data: good, origin: "https://evil.example", source: window });
    send({ data: good, origin: ORIGIN, source: null });
    send({ data: { ...good, type: "eval" }, origin: ORIGIN, source: window });
    expect(spy).not.toHaveBeenCalled();
    send({ data: good, origin: ORIGIN, source: window });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("dispose removes every listener and overlay", () => {
    controller.dispose();
    expect(document.querySelectorAll("[data-nova-overlay]").length).toBe(0);
    const before = posted.length;
    click(document.getElementById("h")!);
    expect(posted.length).toBe(before);
  });
});

describe("the bridge is inert outside Store Builder", () => {
  it("a normal preview (not framed, or no editor flag) registers no editor and keeps links working", async () => {
    const id = "55555555-5555-4555-8555-555555555555";
    mockApi({ ...baseRoutes({ "/stores/velora-x/products": [product()], "/stores/velora-x/collections": [collection()] }), [`/preview/${id}`]: storefront(), [`POST /preview/${id}/loaded`]: { status: 204, body: null } });
    renderApp(`/?preview=${id}&editor=1`); // asks for the editor, but this window is not framed by an allowed admin
    await screen.findByText("Quiet leather");
    expect((window as unknown as { __novaEditor?: unknown }).__novaEditor).toBeUndefined();
    expect(document.querySelector("[data-nova-overlay]")).toBeNull();
    await act(async () => {});
  });

  it("the public (non-preview) storefront never activates it, even with editor=1", async () => {
    mockApi(baseRoutes());
    renderApp("/?org=velora-x&editor=1");
    await screen.findByText("Quiet leather");
    expect((window as unknown as { __novaEditor?: unknown }).__novaEditor).toBeUndefined();
  });
});

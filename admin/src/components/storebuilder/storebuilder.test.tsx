import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import registry from "../../../../contracts/editable-elements.json";
import StoreBuilderPage from "../../pages/StoreBuilderPage";
import { ApiError, applyElementEdit, discardElementEdit, getEditableElements, getStorefrontDiff, getStorefrontDraft, proposeElementEdit, publishStorefront, type StorefrontVersion } from "../../api/client";
import { STOREFRONT_ORIGIN } from "../../lib/storefrontUrl";

vi.mock("../../lib/auth", () => ({ useAuth: () => ({ user: { org_slug: "velora-x" } }), useCurrentUserKey: () => "u1" }));
vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    getStorefrontDraft: vi.fn(), getStorefrontDiff: vi.fn(), getEditableElements: vi.fn(), proposeElementEdit: vi.fn(), applyElementEdit: vi.fn(),
    discardElementEdit: vi.fn(), publishStorefront: vi.fn(), addSection: vi.fn(), updateSection: vi.fn(), deleteSection: vi.fn(), updateTheme: vi.fn(),
    proposeChangePlan: vi.fn(), applyChangePlan: vi.fn(),
  };
});

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const HERO = "22222222-2222-4222-8222-222222222222";
const STORY = "33333333-3333-4333-8333-333333333333";

const draft = (over: Partial<StorefrontVersion> = {}, headline = "Quiet leather, made to last."): StorefrontVersion => ({
  id: DRAFT_ID, status: "draft", generated_by: "owner", published_at: null, revision: "rev-aaaaaaaaaaaa",
  theme: { primary_color: "#2A1D15", background_color: "#F3EEE6", font_family: "'Cormorant Garamond', Georgia, serif", border_radius: "2px" },
  pages: [
    { id: "p-home", slug: "home", title: "Home", order: 0, sections: [
      { id: HERO, type: "hero", order: 0, configuration: { headline, subheadline: "Handbags for life", cta_text: "Shop", cta_href: "/products" } },
      { id: STORY, type: "brand_story", order: 1, configuration: { heading: "Made slowly", body: "Words" } },
    ] },
    { id: "p-about", slug: "about", title: "Our story", order: 1, sections: [] },
  ],
  ...over,
});

const proposal = (over = {}) => ({
  proposal_id: "pr-1", draft_id: DRAFT_ID, revision: "rev-aaaaaaaaaaaa", section_id: HERO, element: "hero.headline", element_label: "Hero headline",
  summary: "Update the hero headline", reasoning: "More editorial.", warnings: [], state: "proposed" as const,
  changes: [{ path: "headline", label: "Headline", current: "Quiet leather, made to last.", proposed: "Considered leather. Made to last." }], ...over,
});

let queryClient: QueryClient;
function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><StoreBuilderPage /></MemoryRouter></QueryClientProvider>);
}

const frame = () => screen.getByTestId("preview-frame") as HTMLIFrameElement;
/** The iframe's window, with postMessage spied so what Store Builder sends can be asserted. */
function spyFrame() {
  const win = frame().contentWindow!;
  const spy = vi.spyOn(win, "postMessage").mockImplementation(() => {});
  return { win, spy };
}
const fromPreview = (win: Window, data: unknown, origin = STOREFRONT_ORIGIN) => act(() => { window.dispatchEvent(new MessageEvent("message", { data, origin, source: win })); });
const previewMsg = (extra: Record<string, unknown>) => ({ source: "nova-preview", v: 1, versionId: DRAFT_ID, ...extra });

beforeEach(() => {
  vi.mocked(getStorefrontDraft).mockResolvedValue(draft());
  vi.mocked(getStorefrontDiff).mockResolvedValue({ changes: ["No changes since last publish"] });
  vi.mocked(getEditableElements).mockResolvedValue(registry as never);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("workspace", () => {
  it("shows the draft in an emulator: the real storefront in a frame, DRAFT/PREVIEW marking, the preview URL, device size", async () => {
    renderPage();
    await screen.findByTestId("preview-frame");
    expect(frame().getAttribute("src")).toBe(`${STOREFRONT_ORIGIN}/?preview=${DRAFT_ID}&editor=1`);
    expect(frame().getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-forms");
    expect(screen.getByText("Draft preview")).toBeInTheDocument();
    expect(screen.getByTestId("device-size")).toHaveTextContent("Desktop · 1280 × 800px");
    expect(screen.getByText(/nothing customers see changes until you publish/i)).toBeInTheDocument();
  });

  it("device controls switch the emulator between desktop, tablet and mobile and show the size", async () => {
    renderPage();
    await screen.findByTestId("preview-frame");
    await userEvent.click(screen.getByTestId("device-mobile"));
    expect(screen.getByTestId("device-size")).toHaveTextContent("Mobile · 390 × 844px");
    expect(frame().style.width).toBe("390px");
    expect(screen.getByTestId("preview-emulator")).toHaveAttribute("data-device", "mobile");
    await userEvent.click(screen.getByTestId("device-tablet"));
    expect(screen.getByTestId("device-size")).toHaveTextContent("Tablet · 820 × 1024px");
    expect(frame().style.width).toBe("820px");
    await userEvent.click(screen.getByTestId("device-desktop"));
    expect(frame().style.width).toBe("1280px");
    expect(frame().title).toContain("desktop");
  });

  it("the outline lists this draft's pages and sections with only the editable elements that exist, and nothing unsupported", async () => {
    renderPage();
    await screen.findByTestId("outline-hero.headline");
    expect(within(screen.getByLabelText("Page")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Home", "Our story"]); // no Contact/Product pages the renderer doesn't have
    expect(screen.getByTestId("outline-hero.subheadline")).toBeInTheDocument();
    expect(screen.getByTestId("outline-hero.cta")).toBeInTheDocument();
    expect(screen.queryByTestId("outline-hero.image")).not.toBeInTheDocument(); // this hero has no image
    expect(screen.queryByTestId("outline-feature_banner.heading")).not.toBeInTheDocument(); // this page has no banner
    expect(screen.getByTestId("outline-brand_story.heading")).toBeInTheDocument();
    expect(screen.getByTestId("outline-theme.style")).toBeInTheDocument();
  });

  it("switching pages shows that page's sections", async () => {
    renderPage();
    await screen.findByTestId("outline-hero.headline");
    await userEvent.selectOptions(screen.getByLabelText("Page"), "about");
    expect(screen.queryByTestId("outline-hero.headline")).not.toBeInTheDocument();
    expect(frame().getAttribute("src")).toBe(`${STOREFRONT_ORIGIN}/pages/about?preview=${DRAFT_ID}&editor=1`);
  });

  it("shows whether the draft differs from live", async () => {
    vi.mocked(getStorefrontDiff).mockResolvedValue({ changes: ["Updated 'hero' section content on 'home'"] });
    renderPage();
    expect(await screen.findByText("Unpublished changes")).toBeInTheDocument();
  });
});

describe("selection", () => {
  it("selecting in the outline selects the element, tells the preview to highlight and scroll to it, and shows its content", async () => {
    renderPage();
    await screen.findByTestId("preview-frame");
    const { win, spy } = spyFrame();
    fromPreview(win, previewMsg({ type: "ready" }));
    spy.mockClear();
    await userEvent.click(screen.getByTestId("outline-hero.headline"));
    expect(spy).toHaveBeenCalledWith({ source: "nova-admin", v: 1, type: "select", sectionId: HERO, element: "hero.headline" }, STOREFRONT_ORIGIN);
    expect(screen.getByTestId("selected-label")).toHaveTextContent("Hero headline");
    expect(screen.getByTestId("current-headline")).toHaveTextContent("Quiet leather, made to last.");
    expect(screen.getByTestId("outline-hero.headline")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Want to change this?")).toBeInTheDocument();
  });

  it("a click inside the preview selects the same stable element (and the theme has no section)", async () => {
    renderPage();
    await screen.findByTestId("preview-frame");
    const { win } = spyFrame();
    fromPreview(win, previewMsg({ type: "select", sectionId: STORY, element: "brand_story.heading" }));
    expect(await screen.findByTestId("selected-label")).toHaveTextContent("Story heading");
    expect(screen.getByTestId("outline-brand_story.heading")).toHaveAttribute("aria-current", "true");
    fromPreview(win, previewMsg({ type: "select", sectionId: null, element: "theme.style" }));
    await waitFor(() => expect(screen.getByTestId("selected-label")).toHaveTextContent("Theme"));
    expect(screen.getByTestId("current-font_family")).toHaveTextContent("Cormorant Garamond"); // shown by name, not as a CSS stack
  });

  it("ignores selection messages from another origin, another window, another draft or in the wrong shape", async () => {
    renderPage();
    await screen.findByTestId("preview-frame");
    const { win } = spyFrame();
    const attack = { type: "select", sectionId: HERO, element: "hero.headline" };
    fromPreview(win, previewMsg(attack), "https://evil.example");
    fromPreview({} as Window, previewMsg(attack));
    fromPreview(win, { ...previewMsg(attack), versionId: "99999999-9999-4999-8999-999999999999" });
    fromPreview(win, previewMsg({ type: "select", sectionId: HERO, element: "hero.x');alert(1);//" }));
    fromPreview(win, "select");
    await act(async () => {});
    expect(screen.queryByTestId("selected-label")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-empty")).toBeInTheDocument();
  });

  it("an unsupported click says so instead of selecting", async () => {
    renderPage();
    await screen.findByTestId("preview-frame");
    const { win } = spyFrame();
    fromPreview(win, previewMsg({ type: "unsupported" }));
    expect(await screen.findByText("That part of the page isn't editable yet.")).toBeInTheDocument();
  });

  it("the mode switch tells the preview whether to select or let the site be used", async () => {
    renderPage();
    await screen.findByTestId("preview-frame");
    const { win, spy } = spyFrame();
    fromPreview(win, previewMsg({ type: "ready" }));
    expect(spy).toHaveBeenCalledWith({ source: "nova-admin", v: 1, type: "mode", mode: "select" }, STOREFRONT_ORIGIN);
    await userEvent.click(screen.getByTestId("mode-interact"));
    expect(spy).toHaveBeenCalledWith({ source: "nova-admin", v: 1, type: "mode", mode: "interact" }, STOREFRONT_ORIGIN);
    expect(screen.getByTestId("mode-interact")).toHaveAttribute("aria-pressed", "true");
  });

  it("without a selection the panel explains visual editing and offers examples", async () => {
    renderPage();
    expect(await screen.findByText("Click anything on your store")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is live until you publish/)).toBeInTheDocument();
  });
});

describe("propose, review, apply, discard", () => {
  const selectHero = async () => {
    renderPage();
    await screen.findByTestId("preview-frame");
    const frameBits = spyFrame();
    fromPreview(frameBits.win, previewMsg({ type: "ready" }));
    await userEvent.click(screen.getByTestId("outline-hero.headline"));
    return frameBits;
  };

  it("sends the selected element, draft id and revision with the instruction, and shows a structured proposal", async () => {
    vi.mocked(proposeElementEdit).mockResolvedValue(proposal());
    await selectHero();
    await userEvent.type(screen.getByLabelText(/Want to change this/), "Make it sound more premium");
    await userEvent.click(screen.getByTestId("propose-change"));
    expect(proposeElementEdit).toHaveBeenCalledWith({ draft_id: DRAFT_ID, revision: "rev-aaaaaaaaaaaa", section_id: HERO, element: "hero.headline", instruction: "Make it sound more premium" });
    expect(await screen.findByTestId("proposal-summary")).toHaveTextContent("Update the hero headline");
    expect(screen.getByTestId("change-current")).toHaveTextContent("Quiet leather, made to last.");
    expect(screen.getByTestId("change-proposed")).toHaveTextContent("Considered leather. Made to last.");
    expect(screen.getByTestId("proposal")).toHaveTextContent(/nothing has changed yet/i);
    expect(screen.getByRole("button", { name: "Apply to Draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(applyElementEdit).not.toHaveBeenCalled(); // proposing never applies
  });

  it("suggestions are relevant to the selected element and fill the prompt", async () => {
    await selectHero();
    await userEvent.click(screen.getByRole("button", { name: "Make it shorter" }));
    expect(screen.getByLabelText(/Want to change this/)).toHaveValue("Make it shorter");
  });

  it("shows a thinking state while proposing and prevents double submission", async () => {
    let resolve!: (p: ReturnType<typeof proposal>) => void;
    vi.mocked(proposeElementEdit).mockReturnValue(new Promise((r) => (resolve = r)));
    await selectHero();
    await userEvent.type(screen.getByLabelText(/Want to change this/), "shorter");
    fireEvent.click(screen.getByTestId("propose-change"));
    fireEvent.click(screen.getByTestId("propose-change"));
    expect(await screen.findByText("NOVA is thinking…")).toBeInTheDocument();
    expect(proposeElementEdit).toHaveBeenCalledTimes(1);
    resolve(proposal());
    await screen.findByTestId("proposal");
  });

  it("Apply to Draft applies the proposal with its revision, updates the draft, refreshes the preview, keeps the selection and confirms", async () => {
    vi.mocked(proposeElementEdit).mockResolvedValue(proposal());
    vi.mocked(applyElementEdit).mockResolvedValue(draft({ revision: "rev-bbbbbbbbbbbb" }, "Considered leather. Made to last."));
    const { spy } = await selectHero();
    await userEvent.type(screen.getByLabelText(/Want to change this/), "premium");
    await userEvent.click(screen.getByTestId("propose-change"));
    await screen.findByTestId("proposal");
    spy.mockClear();
    await userEvent.click(screen.getByTestId("apply-change"));
    expect(applyElementEdit).toHaveBeenCalledWith("pr-1", "rev-aaaaaaaaaaaa");
    expect(await screen.findByTestId("editor-confirmation")).toHaveTextContent(/live store is unchanged until you publish/i);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ source: "nova-admin", v: 1, type: "refresh" }, STOREFRONT_ORIGIN));
    expect(screen.getByTestId("selected-label")).toHaveTextContent("Hero headline"); // still selected
    expect(screen.getByTestId("current-headline")).toHaveTextContent("Considered leather. Made to last.");
    expect(screen.queryByTestId("proposal")).not.toBeInTheDocument();
    expect(publishStorefront).not.toHaveBeenCalled(); // applying never publishes
    await userEvent.type(screen.getByLabelText(/Want to change this/), "another"); // and another change can follow
  });

  it("Discard removes the proposal, changes nothing, and tells the server", async () => {
    vi.mocked(proposeElementEdit).mockResolvedValue(proposal());
    vi.mocked(discardElementEdit).mockResolvedValue(proposal({ state: "discarded" }));
    await selectHero();
    await userEvent.type(screen.getByLabelText(/Want to change this/), "premium");
    await userEvent.click(screen.getByTestId("propose-change"));
    await userEvent.click(await screen.findByTestId("discard-change"));
    expect(screen.queryByTestId("proposal")).not.toBeInTheDocument();
    expect(discardElementEdit).toHaveBeenCalledWith("pr-1");
    expect(applyElementEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId("current-headline")).toHaveTextContent("Quiet leather, made to last.");
  });

  it("a request NOVA can't turn into a supported change shows its explanation and the closest alternative, and the draft is untouched", async () => {
    vi.mocked(proposeElementEdit).mockRejectedValue(new ApiError(422, "unsupported_edit", "I can't add a video here. Closest supported change: Change the hero image to a catalog photo.", {}));
    await selectHero();
    await userEvent.type(screen.getByLabelText(/Want to change this/), "put a video behind it");
    await userEvent.click(screen.getByTestId("propose-change"));
    expect(await screen.findByTestId("editor-problem")).toHaveTextContent("Closest supported change");
    expect(screen.queryByTestId("proposal")).not.toBeInTheDocument();
  });

  it("a stale draft is refused with a clear way back: reload, then propose again", async () => {
    vi.mocked(proposeElementEdit).mockResolvedValue(proposal());
    vi.mocked(applyElementEdit).mockRejectedValue(new ApiError(409, "stale_draft", "The draft changed after this proposal was made, so it wasn't applied.", {}));
    await selectHero();
    await userEvent.type(screen.getByLabelText(/Want to change this/), "premium");
    await userEvent.click(screen.getByTestId("propose-change"));
    await userEvent.click(await screen.findByTestId("apply-change"));
    expect(await screen.findByTestId("editor-problem")).toHaveTextContent("The draft changed");
    expect(screen.queryByTestId("proposal")).not.toBeInTheDocument();
    vi.mocked(getStorefrontDraft).mockResolvedValue(draft({ revision: "rev-cccccccccccc" }));
    await userEvent.click(screen.getByRole("button", { name: "Reload the draft" }));
    await waitFor(() => expect(getStorefrontDraft).toHaveBeenCalledTimes(2));
  });

  it("a proposal that is out of date because the draft changed meanwhile can't be applied", async () => {
    vi.mocked(proposeElementEdit).mockResolvedValue(proposal());
    await selectHero();
    await userEvent.type(screen.getByLabelText(/Want to change this/), "premium");
    await userEvent.click(screen.getByTestId("propose-change"));
    await screen.findByTestId("proposal");
    act(() => queryClient.setQueryData(["storefront-draft"], draft({ revision: "rev-zzzzzzzzzzzz" }))); // someone edited the draft
    expect(await screen.findByText(/draft changed after this proposal was made/i)).toBeInTheDocument();
    expect(screen.getByTestId("apply-change")).toBeDisabled();
  });

  it("a network or persistence failure keeps the proposal and the draft", async () => {
    vi.mocked(proposeElementEdit).mockResolvedValue(proposal());
    vi.mocked(applyElementEdit).mockRejectedValue(new ApiError(500, "error", "Something went wrong", {}));
    await selectHero();
    await userEvent.type(screen.getByLabelText(/Want to change this/), "premium");
    await userEvent.click(screen.getByTestId("propose-change"));
    await userEvent.click(await screen.findByTestId("apply-change"));
    expect(await screen.findByTestId("editor-problem")).toBeInTheDocument();
    expect(screen.getByTestId("proposal")).toBeInTheDocument(); // can retry
    expect(screen.getByTestId("current-headline")).toHaveTextContent("Quiet leather, made to last.");
  });

  it("changing the selection starts fresh: the old proposal and text are gone", async () => {
    vi.mocked(proposeElementEdit).mockResolvedValue(proposal());
    await selectHero();
    await userEvent.type(screen.getByLabelText(/Want to change this/), "premium");
    await userEvent.click(screen.getByTestId("propose-change"));
    await screen.findByTestId("proposal");
    await userEvent.click(screen.getByTestId("outline-brand_story.heading"));
    expect(screen.queryByTestId("proposal")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Want to change this/)).toHaveValue("");
  });

  it("publishing is a separate, explicit action", async () => {
    vi.mocked(publishStorefront).mockResolvedValue(draft());
    renderPage();
    await screen.findByTestId("preview-frame");
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(publishStorefront).toHaveBeenCalledTimes(1);
  });

  it("the page-wide NOVA request and the onboarding targets are still there", async () => {
    renderPage();
    await screen.findByTestId("preview-frame");
    expect(document.querySelector('[data-nova-target="preview.open"]')).not.toBeNull();
    expect(document.querySelector('[data-nova-target="nl_edit_form.instruction"]')).not.toBeNull();
    expect(document.querySelector('[data-nova-target="nl_edit_form.propose"]')).not.toBeNull();
    expect(document.querySelector('[data-nova-target="publish_form.publish"]')).not.toBeNull();
  });
});

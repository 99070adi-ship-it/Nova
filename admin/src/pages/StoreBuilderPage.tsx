import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  ChangePlan,
  StoreSection,
  addSection,
  applyChangePlan,
  deleteSection,
  getEditableElements,
  getStorefrontDiff,
  getStorefrontDraft,
  type StorefrontVersion,
  proposeChangePlan,
  publishStorefront,
  updateSection,
  updateTheme,
} from "../api/client";
import { useAuth } from "../lib/auth";
import ElementEditor from "../components/storebuilder/ElementEditor";
import Outline from "../components/storebuilder/Outline";
import PreviewFrame from "../components/storebuilder/PreviewFrame";
import { DEVICES, type Device, type Selection } from "../components/storebuilder/types";
import { STOREFRONT_ORIGIN, liveStorefrontUrl } from "../lib/storefrontUrl";
import { setSessionFocus } from "../lib/sessionFocus";

const SECTION_LABELS: Record<string, string> = {
  hero: "Hero",
  product_grid: "Product grid",
  collection_grid: "Collections",
  feature_banner: "Feature banner",
  brand_story: "Brand story",
};

function SectionEditor({ section, pageId }: { section: StoreSection; pageId: string }) {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState(section.configuration);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["storefront-draft"] });
    queryClient.invalidateQueries({ queryKey: ["storefront-diff"] });
  };

  const saveMutation = useMutation({
    mutationFn: () => updateSection(section.id, { configuration: config }),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteSection(section.id),
    onSuccess: invalidate,
  });

  const setField = (key: string, value: string | number) => setConfig((c) => ({ ...c, [key]: value }));

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {SECTION_LABELS[section.type] ?? section.type}
        </span>
        <button onClick={() => deleteMutation.mutate()} className="text-xs text-red-600 hover:underline">
          Remove
        </button>
      </div>

      {section.type === "hero" && (
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Headline" value={(config.headline as string) ?? ""} onChange={(e) => setField("headline", e.target.value)} className="col-span-2 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
          <input placeholder="Subheadline" value={(config.subheadline as string) ?? ""} onChange={(e) => setField("subheadline", e.target.value)} className="col-span-2 rounded-md border border-neutral-300 px-2 py-1 text-sm" />
          <input placeholder="CTA text" value={(config.cta_text as string) ?? ""} onChange={(e) => setField("cta_text", e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-sm" />
          <input placeholder="CTA link" value={(config.cta_href as string) ?? ""} onChange={(e) => setField("cta_href", e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-sm" />
        </div>
      )}

      {section.type === "product_grid" && (
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Title" value={(config.title as string) ?? ""} onChange={(e) => setField("title", e.target.value)} className="rounded-md border border-neutral-300 px-2 py-1 text-sm" />
          <input
            type="number"
            placeholder="Limit"
            value={(config.limit as number) ?? 12}
            onChange={(e) => setField("limit", parseInt(e.target.value, 10))}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
        </div>
      )}

      {section.type === "brand_story" && (
        <div className="space-y-2">
          <input placeholder="Heading" value={(config.heading as string) ?? ""} onChange={(e) => setField("heading", e.target.value)} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-sm" />
          <textarea placeholder="Body" value={(config.body as string) ?? ""} onChange={(e) => setField("body", e.target.value)} className="w-full rounded-md border border-neutral-300 px-2 py-1 text-sm" rows={3} />
        </div>
      )}

      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="mt-3 rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100"
      >
        Save section
      </button>
    </div>
  );
}

function affectedArea(item: ChangePlan["plan"][number]): string {
  if (item.action === "add_section") return `Homepage → new ${item.section_type ?? "?"} section`;
  if (item.action === "update_theme") return "Homepage → theme";
  return "Nothing";
}

function AskNovaPanel() {
  const queryClient = useQueryClient();
  const [instruction, setInstruction] = useState("");
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["storefront-draft"] });
    queryClient.invalidateQueries({ queryKey: ["storefront-diff"] });
  };

  const proposeMutation = useMutation({
    mutationFn: () => proposeChangePlan(instruction),
    onSuccess: (result) => {
      setPlan(result);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to propose changes"),
  });

  const applyMutation = useMutation({
    mutationFn: () => applyChangePlan(plan!.agent_run_id),
    onSuccess: () => {
      invalidate();
      setPlan((p) => (p ? { ...p, applied: true } : p));
    },
  });

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold">Ask NOVA</h2>
      <p className="mt-1 text-xs text-neutral-500">Describe a change — NOVA proposes a plan before touching anything.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (instruction.trim()) proposeMutation.mutate();
        }}
        className="mt-3 flex gap-2"
      >
        <input
          data-nova-target="nl_edit_form.instruction"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="e.g. make it feel more premium"
          className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <button
          data-nova-target="nl_edit_form.propose"
          type="submit"
          disabled={proposeMutation.isPending}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100"
        >
          {proposeMutation.isPending ? "Thinking…" : "Propose"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {plan && (
        <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">What will change</p>
          <ul className="mt-2 space-y-2">
            {plan.plan.map((item, i) => (
              <li key={i} className="text-xs text-neutral-700">
                <p>{item.description}</p>
                <p className="mt-0.5 text-neutral-400">Affected: {affectedArea(item)}</p>
              </li>
            ))}
          </ul>

          {plan.plan.some((i) => i.action !== "none") && !plan.applied && (
            <>
              <p className="mt-3 border-t border-neutral-200 pt-2 text-[11px] text-neutral-400">
                Draft only — nothing customers see changes until you publish. Apply it, then use
                "Preview draft" above to see it as a customer would before you decide to publish.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  data-nova-target="nl_edit_form.apply"
                  onClick={() => applyMutation.mutate()}
                  disabled={applyMutation.isPending}
                  className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white"
                >
                  {applyMutation.isPending ? "Applying…" : "Apply to draft"}
                </button>
                <button
                  onClick={() => setPlan(null)}
                  className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
                >
                  Discard
                </button>
              </div>
            </>
          )}
          {plan.applied && <p className="mt-2 text-xs text-emerald-600">Applied to draft — use "Preview draft" above to see it.</p>}
        </div>
      )}
    </div>
  );
}

export default function StoreBuilderPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: draft, isLoading, refetch: refetchDraft } = useQuery({ queryKey: ["storefront-draft"], queryFn: getStorefrontDraft });
  const { data: diff } = useQuery({ queryKey: ["storefront-diff"], queryFn: getStorefrontDiff });
  const { data: registry } = useQuery({ queryKey: ["editable-elements"], queryFn: getEditableElements, staleTime: Infinity });
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedOk, setPublishedOk] = useState(false);
  const [pageSlug, setPageSlug] = useState("home");
  const [device, setDevice] = useState<Device>("desktop");
  const [mode, setMode] = useState<"select" | "interact">("select");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    setSessionFocus(selected ? { section: selected.sectionId === null ? `theme ${selected.element}` : selected.element } : undefined);
    return () => setSessionFocus(undefined);
  }, [selected]);
  const [notice, setNotice] = useState<string | null>(null);

  const invalidateDraft = () => {
    queryClient.invalidateQueries({ queryKey: ["storefront-draft"] });
    queryClient.invalidateQueries({ queryKey: ["storefront-diff"] });
  };

  const publishMutation = useMutation({
    mutationFn: publishStorefront,
    onSuccess: () => {
      invalidateDraft();
      setPublishError(null);
      setPublishedOk(true);
      setTimeout(() => setPublishedOk(false), 3000);
    },
    onError: (err) => setPublishError(err instanceof ApiError ? err.message : "Publish failed"),
  });

  const themeMutation = useMutation({
    mutationFn: (tokens: Record<string, string>) => updateTheme(tokens),
    onSuccess: () => {
      invalidateDraft();
      setRefreshKey((k) => k + 1);
    },
  });

  const addSectionMutation = useMutation({
    mutationFn: (type: string) => {
      const page = draft!.pages.find((p) => p.slug === pageSlug) ?? draft!.pages[0];
      const defaults: Record<string, Record<string, unknown>> = {
        hero: { headline: "New headline", subheadline: "", cta_text: "Shop now", cta_href: "/products" },
        product_grid: { title: "Products", limit: 12, collection_id: null },
        collection_grid: { title: "Shop by collection", limit: 6 },
        feature_banner: { eyebrow: "", heading: "A new feature", body: "", cta_text: "Learn more", cta_href: "/products" },
        brand_story: { heading: "Our story", body: "" },
      };
      return addSection({ page_id: page.id, type, order: page.sections.length, configuration: defaults[type] ?? {} });
    },
    onSuccess: () => {
      invalidateDraft();
      setRefreshKey((k) => k + 1);
    },
  });

  const onSelect = useCallback((s: Selection) => {
    setNotice(null);
    setSelected((prev) => (prev && prev.element === s.element && prev.sectionId === s.sectionId ? prev : s));
  }, []);
  const onUnsupported = useCallback(() => setNotice("That part of the page isn't editable yet."), []);
  const onApplied = useCallback((updated: StorefrontVersion) => {
    queryClient.setQueryData(["storefront-draft"], updated); // the editor works from the draft the server just returned
    queryClient.invalidateQueries({ queryKey: ["storefront-diff"] });
    setRefreshKey((k) => k + 1); // the preview re-fetches the draft in place; the selection stays
  }, [queryClient]);
  const onStale = useCallback(async () => {
    await refetchDraft();
    setRefreshKey((k) => k + 1);
  }, [refetchDraft]);

  // If the selected section disappeared (deleted, or a different draft), drop the selection rather than editing nothing.
  useEffect(() => {
    if (!draft || !selected?.sectionId) return;
    if (!draft.pages.some((p) => p.sections.some((s) => s.id === selected.sectionId))) setSelected(null);
  }, [draft, selected]);
  useEffect(() => {
    if (draft && !draft.pages.some((p) => p.slug === pageSlug)) setPageSlug(draft.pages[0]?.slug ?? "home");
  }, [draft, pageSlug]);

  if (isLoading || !draft) return <p className="text-sm text-fg-3">Loading…</p>;
  const page = draft.pages.find((p) => p.slug === pageSlug) ?? draft.pages[0];
  const previewUrl = `${STOREFRONT_ORIGIN}/?preview=${draft.id}`;
  const liveUrl = liveStorefrontUrl(user?.org_slug);
  const hasChanges = !!diff && !(diff.changes.length === 1 && /No changes since last publish/.test(diff.changes[0]));
  const selectedSection = selected?.sectionId ? draft.pages.flatMap((p) => p.sections).find((s) => s.id === selected.sectionId) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-fg">Store Builder</h1>
          <p className="mt-1 text-xs text-fg-3">
            You're editing the <span className="font-medium text-fg-2">draft</span>. Nothing customers see changes until you publish.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div role="group" aria-label="Preview mode" className="inline-flex overflow-hidden rounded-md border border-line-strong">
            {(["select", "interact"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} data-testid={`mode-${m}`}
                className={`px-3 py-1.5 text-xs font-medium transition-colors duration-instant ${mode === m ? "bg-inverse text-inverse-on" : "bg-raised text-fg-2 hover:bg-sunken"}`}>
                {m === "select" ? "Select elements" : "Interact with site"}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Device size" className="inline-flex overflow-hidden rounded-md border border-line-strong">
            {(Object.keys(DEVICES) as Device[]).map((d) => (
              <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d} data-testid={`device-${d}`}
                className={`px-3 py-1.5 text-xs font-medium transition-colors duration-instant ${device === d ? "bg-inverse text-inverse-on" : "bg-raised text-fg-2 hover:bg-sunken"}`}>
                {DEVICES[d].label}
              </button>
            ))}
          </div>
          <a data-nova-target="preview.open" href={previewUrl} target="_blank" rel="noreferrer" className="font-medium text-fg hover:underline">
            Preview draft ↗
          </a>
          <a href={liveUrl} target="_blank" rel="noreferrer" className="text-fg-3 hover:underline">
            View live site ↗
          </a>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[200px_minmax(0,1fr)_330px]">
        <aside className="order-2 xl:order-1">
          <Outline draft={draft} registry={registry} pageSlug={page.slug} onPage={(slug) => { setPageSlug(slug); setSelected(null); }} selected={selected} onSelect={onSelect} hasChanges={hasChanges} />
          <div className="mt-5 flex flex-wrap gap-1.5">
            {(registry?.section_types ?? []).map((t) => (
              <button key={t.type} type="button" onClick={() => addSectionMutation.mutate(t.type)} className="rounded-md border border-line-strong px-2 py-1 text-[11px] font-medium text-fg-2 hover:bg-sunken">
                + {t.label}
              </button>
            ))}
          </div>
        </aside>

        <section className="order-1 min-w-0 xl:order-2" aria-label="Storefront preview">
          <PreviewFrame draftId={draft.id} pageSlug={page.slug} device={device} mode={mode} selected={selected} refreshKey={refreshKey} onSelect={onSelect} onUnsupported={onUnsupported} />
          <p className="mt-2 text-center text-xs text-fg-3" role="status">
            {notice ?? (mode === "select" ? "Click a headline, button, banner or product grid to edit it. Switch to “Interact with site” to use links normally." : "Interacting: links and buttons work as they would for a customer. Switch back to select elements to edit.")}
          </p>
        </section>

        <aside className="order-3 flex flex-col gap-5">
          <div className="rounded-lg border border-line bg-raised p-5">
            <ElementEditor draft={draft} registry={registry} selection={selected} onApplied={onApplied} onStale={onStale} onClear={() => setSelected(null)} />
            {selectedSection && (
              <details className="mt-4 border-t border-line pt-3">
                <summary className="cursor-pointer text-xs font-medium text-fg-2">Edit fields manually</summary>
                <div className="mt-3">
                  <SectionEditor key={selectedSection.id + JSON.stringify(selectedSection.configuration)} section={selectedSection} pageId={page.id} />
                </div>
              </details>
            )}
          </div>

          <AskNovaPanel />

          <details className="rounded-lg border border-line bg-raised p-4">
            <summary className="cursor-pointer text-sm font-semibold text-fg">Theme colors (manual)</summary>
            <div className="mt-3 space-y-2">
              <label className="block text-xs text-fg-3">
                Primary color
                <input type="color" defaultValue={draft.theme.primary_color} onChange={(e) => themeMutation.mutate({ primary_color: e.target.value })} className="ml-2 h-6 w-10 align-middle" />
              </label>
              <label className="block text-xs text-fg-3">
                Background color
                <input type="color" defaultValue={draft.theme.background_color} onChange={(e) => themeMutation.mutate({ background_color: e.target.value })} className="ml-2 h-6 w-10 align-middle" />
              </label>
            </div>
          </details>

          <div className="rounded-lg border border-line bg-raised p-4">
            <h2 className="text-sm font-semibold text-fg">Changes since last publish</h2>
            <ul className="mt-2 space-y-1 text-xs text-fg-3">
              {diff?.changes.map((c, i) => (
                <li key={i}>• {c}</li>
              ))}
            </ul>
            <button
              data-nova-target="publish_form.publish"
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
              className="mt-4 w-full rounded-md bg-inverse px-3 py-2 text-sm font-medium text-inverse-on"
            >
              {publishMutation.isPending ? "Publishing…" : "Publish"}
            </button>
            {publishedOk && <p className="mt-2 text-xs text-ok">Published.</p>}
            {publishError && <p className="mt-2 text-xs text-bad">{publishError}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

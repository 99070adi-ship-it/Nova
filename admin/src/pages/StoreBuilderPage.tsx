import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ApiError,
  ChangePlan,
  StoreSection,
  addSection,
  applyChangePlan,
  deleteSection,
  getStorefrontDiff,
  getStorefrontDraft,
  proposeChangePlan,
  publishStorefront,
  updateSection,
  updateTheme,
} from "../api/client";

const SECTION_LABELS: Record<string, string> = {
  hero: "Hero",
  product_grid: "Product grid",
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
  const { data: draft, isLoading } = useQuery({ queryKey: ["storefront-draft"], queryFn: getStorefrontDraft });
  const { data: diff } = useQuery({ queryKey: ["storefront-diff"], queryFn: getStorefrontDiff });
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedOk, setPublishedOk] = useState(false);

  const publishMutation = useMutation({
    mutationFn: publishStorefront,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["storefront-draft"] });
      queryClient.invalidateQueries({ queryKey: ["storefront-diff"] });
      setPublishError(null);
      setPublishedOk(true);
      setTimeout(() => setPublishedOk(false), 3000);
    },
    onError: (err) => setPublishError(err instanceof ApiError ? err.message : "Publish failed"),
  });

  const themeMutation = useMutation({
    mutationFn: (tokens: Record<string, string>) => updateTheme(tokens),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["storefront-draft"] });
      queryClient.invalidateQueries({ queryKey: ["storefront-diff"] });
    },
  });

  const addSectionMutation = useMutation({
    mutationFn: (type: string) => {
      const page = draft!.pages[0];
      const defaults: Record<string, Record<string, unknown>> = {
        hero: { headline: "New headline", subheadline: "", cta_text: "Shop now", cta_href: "/shop" },
        product_grid: { title: "Products", limit: 12, collection_id: null },
        brand_story: { heading: "Our story", body: "" },
      };
      return addSection({ page_id: page.id, type, order: page.sections.length, configuration: defaults[type] ?? {} });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["storefront-draft"] });
      queryClient.invalidateQueries({ queryKey: ["storefront-diff"] });
    },
  });

  if (isLoading || !draft) return <p className="text-sm text-neutral-400">Loading…</p>;
  const page = draft.pages[0];
  const storefrontOrigin = "http://localhost:5174";
  const previewUrl = `${storefrontOrigin}/?preview=${draft.id}`;
  const liveUrl = `${storefrontOrigin}/`;

  return (
    <div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Store Builder</h1>
          <div className="flex items-center gap-4 text-sm">
            <a href={previewUrl} target="_blank" rel="noreferrer" className="font-medium text-neutral-900 hover:underline">
              Preview draft ↗
            </a>
            <a href={liveUrl} target="_blank" rel="noreferrer" className="text-neutral-500 hover:underline">
              View live site ↗
            </a>
          </div>
        </div>
        <p className="mt-1 text-xs text-neutral-400">
          You're editing the <span className="font-medium text-neutral-600">draft</span> — nothing customers see changes until you publish.
        </p>

        <div className="mt-4 space-y-3">
          {page.sections
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((s) => (
              <SectionEditor key={s.id} section={s} pageId={page.id} />
            ))}
        </div>

        <div className="mt-4 flex gap-2">
          {(["hero", "product_grid", "brand_story"] as const).map((type) => (
            <button
              key={type}
              onClick={() => addSectionMutation.mutate(type)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100"
            >
              + {SECTION_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <AskNovaPanel />

        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Theme</h2>
          <div className="mt-3 space-y-2">
            <label className="block text-xs text-neutral-500">
              Primary color
              <input
                type="color"
                defaultValue={draft.theme.primary_color}
                onChange={(e) => themeMutation.mutate({ primary_color: e.target.value })}
                className="ml-2 h-6 w-10 align-middle"
              />
            </label>
            <label className="block text-xs text-neutral-500">
              Background color
              <input
                type="color"
                defaultValue={draft.theme.background_color}
                onChange={(e) => themeMutation.mutate({ background_color: e.target.value })}
                className="ml-2 h-6 w-10 align-middle"
              />
            </label>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Changes since last publish</h2>
          <ul className="mt-2 space-y-1 text-xs text-neutral-500">
            {diff?.changes.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
          <button
            data-nova-target="publish_form.publish"
            onClick={() => publishMutation.mutate()}
            disabled={publishMutation.isPending}
            className="mt-4 w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
          >
            {publishMutation.isPending ? "Publishing…" : "Publish"}
          </button>
          {publishedOk && <p className="mt-2 text-xs text-emerald-600">Published.</p>}
          {publishError && <p className="mt-2 text-xs text-red-600">{publishError}</p>}
        </div>
      </div>
      </div>
    </div>
  );
}

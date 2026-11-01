import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  deleteStudioImage,
  fetchStudioImageBlob,
  getStudioStatus,
  listStudioHistory,
  studioEdit,
  studioGenerate,
  type StudioImage,
} from "../api/client";
import { Badge, Button, EmptyState, ErrorState, LoadingState } from "../components/ui";

type Tab = "generate" | "edit" | "enhance";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Please try again.");

/** Private images need the bearer token, so each one is fetched as a blob and shown through an object URL. */
function useImageUrl(id: string) {
  const { data } = useQuery({ queryKey: ["studio-image", id], queryFn: () => fetchStudioImageBlob(id), staleTime: Infinity, gcTime: 10 * 60_000 });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return setUrl(null);
    const u = URL.createObjectURL(data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);
  return url;
}

async function download(id: string) {
  const blob = await fetchStudioImageBlob(id, true);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `nova-${id}.${blob.type.split("/")[1] === "jpeg" ? "jpg" : blob.type.split("/")[1] ?? "img"}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Thumb({ image, onOpen, onRegenerate, onDelete }: { image: StudioImage; onOpen: () => void; onRegenerate?: () => void; onDelete: () => void }) {
  const url = useImageUrl(image.id);
  return (
    <figure className="overflow-hidden rounded-lg border border-line bg-raised">
      <button type="button" onClick={onOpen} aria-label={`Open image: ${image.prompt ?? "result"}`} className="block aspect-square w-full bg-sunken">
        {url ? <img src={url} alt={image.prompt ?? "Generated image"} className="h-full w-full object-cover" /> : <span className="block h-full animate-pulse" />}
      </button>
      <figcaption className="flex flex-col gap-2 p-3">
        <p className="line-clamp-2 text-xs text-fg-2">{image.prompt}</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => void download(image.id)}>Download</Button>
          {onRegenerate && <Button size="sm" variant="ghost" onClick={onRegenerate}>Regenerate</Button>}
          <Button size="sm" variant="ghost" onClick={onDelete}>Delete</Button>
        </div>
      </figcaption>
    </figure>
  );
}

function Lightbox({ image, onClose }: { image: StudioImage; onClose: () => void }) {
  const url = useImageUrl(image.id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Image preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="flex max-h-full max-w-4xl flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        {url && <img src={url} alt={image.prompt ?? "Generated image"} className="max-h-[80vh] rounded-lg object-contain" />}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void download(image.id)}>Download</Button>
          <Button variant="ghost" onClick={onClose} className="text-white">Close</Button>
        </div>
      </div>
    </div>
  );
}

function BeforeAfter({ original, edited }: { original: StudioImage; edited: StudioImage }) {
  const a = useImageUrl(original.id);
  const b = useImageUrl(edited.id);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[["Original", a, original], ["Edited", b, edited]].map(([label, url, img]) => (
        <figure key={label as string} className="overflow-hidden rounded-lg border border-line bg-raised">
          <div className="aspect-square bg-sunken">
            {url ? <img src={url as string} alt={`${label} image`} className="h-full w-full object-contain" /> : <span className="block h-full animate-pulse" />}
          </div>
          <figcaption className="flex items-center justify-between p-3">
            <span className="text-xs font-medium text-fg-2">{label as string}</span>
            <Button size="sm" variant="secondary" onClick={() => void download((img as StudioImage).id)}>Download</Button>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export default function PhotoStudioPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("generate");
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("none");
  const [count, setCount] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<StudioImage | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<{ original: StudioImage; edited: StudioImage } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const status = useQuery({ queryKey: ["studio-status"], queryFn: getStudioStatus });
  const history = useQuery({ queryKey: ["studio-history"], queryFn: listStudioHistory });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["studio-history"] });
    void qc.invalidateQueries({ queryKey: ["studio-status"] });
  };

  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const generate = useMutation({
    mutationFn: (v: { prompt: string; style: string; count: number }) => studioGenerate(v),
    onSuccess: (r) => { setError(null); setNotice(r.message); refresh(); },
    onError: (e) => { setNotice(null); setError(errMsg(e)); },
  });
  const edit = useMutation({
    mutationFn: () => studioEdit(editPrompt, file!),
    onSuccess: (r) => { setError(null); setEditResult(r); refresh(); },
    onError: (e) => setError(errMsg(e)),
  });
  const remove = useMutation({ mutationFn: deleteStudioImage, onSuccess: refresh, onError: (e) => setError(errMsg(e)) });

  if (status.isLoading) return <LoadingState label="Opening Photo Studio…" />;
  if (status.isError || !status.data) return <ErrorState title="Photo Studio couldn't load" body="Check your connection and try again." />;
  const s = status.data;
  const busy = generate.isPending || edit.isPending;
  const limitReached = s.used_today >= s.daily_limit;
  const tabs: { key: Tab; label: string; soon?: boolean }[] = [
    { key: "generate", label: "Generate" },
    { key: "edit", label: "Edit" },
    { key: "enhance", label: "Enhance", soon: true },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Photo Studio</h1>
          <p className="mt-1 text-sm text-fg-2">Create and edit images with AI. Everything you make is saved to your workspace history.</p>
        </div>
        {s.generate.available && (
          <p className="text-xs text-fg-3" aria-live="polite">{s.used_today} of {s.daily_limit} images used today</p>
        )}
      </header>

      {!s.generate.available && (
        <div role="status" className="rounded-lg border border-line bg-sunken p-4 text-sm text-fg-2">{s.generate.note}</div>
      )}

      <div role="tablist" aria-label="Photo Studio tools" className="flex gap-1.5 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => { setTab(t.key); setError(null); }}
            className={clsx("-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm", tab === t.key ? "border-corona font-medium text-fg" : "border-transparent text-fg-2 hover:text-fg")}
          >
            {t.label}
            {t.soon && <Badge tone="neutral">Coming soon</Badge>}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      {notice && <p role="status" className="rounded-md bg-sunken px-3 py-2 text-sm text-fg-2">{notice}</p>}

      {tab === "generate" && (
        <section className="space-y-6">
          <form
            className="space-y-4 rounded-lg border border-line bg-raised p-5"
            onSubmit={(e) => { e.preventDefault(); generate.mutate({ prompt, style, count }); }}
          >
            <div>
              <label htmlFor="studio-prompt" className="text-sm font-medium">Describe what you imagine</label>
              <textarea
                id="studio-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} rows={3}
                placeholder="A premium skincare campaign: a luxury glass bottle on a stone pedestal, warm sunlight"
                className="mt-1.5 w-full rounded-md border border-line-strong bg-raised p-3 text-sm"
              />
              <p className="mt-1 text-xs text-fg-3">{prompt.length}/500. AI often garbles text inside images, so describe the scene and add words afterwards.</p>
            </div>
            <fieldset>
              <legend className="text-sm font-medium">Style</legend>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {s.styles.map((st) => (
                  <button
                    type="button" key={st.key} aria-pressed={style === st.key} onClick={() => setStyle(st.key)}
                    className={clsx("rounded-full border px-3 py-1 text-xs", style === st.key ? "border-inverse bg-inverse text-inverse-on" : "border-line-strong text-fg-2 hover:bg-sunken")}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label htmlFor="studio-count" className="text-sm font-medium">Images</label>
                <select id="studio-count" value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-1.5 block h-9 rounded-md border border-line-strong bg-raised px-2 text-sm">
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <Button type="submit" variant="ai" disabled={busy || !s.generate.available || limitReached || prompt.trim().length < 3}>
                {generate.isPending ? "Generating…" : "Generate"}
              </Button>
              {limitReached && <p className="text-xs text-fg-3">You've reached today's limit. It resets at 00:00 UTC.</p>}
            </div>
            {generate.isPending && <p role="status" className="text-xs text-fg-3">Creating your image. This usually takes a few seconds.</p>}
          </form>

          <div>
            <h2 className="mb-3 text-sm font-semibold">Your images</h2>
            {history.isLoading ? <LoadingState rows={2} label="Loading your images…" /> : !history.data?.length ? (
              <EmptyState title="Nothing here yet" body="Describe an image above and press Generate. Your results are saved here." />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {history.data.map((img) => (
                  <Thumb
                    key={img.id} image={img} onOpen={() => setOpen(img)} onDelete={() => remove.mutate(img.id)}
                    onRegenerate={img.kind === "generated" && img.prompt ? () => { setPrompt(img.prompt!); setStyle(img.style ?? "none"); generate.mutate({ prompt: img.prompt!, style: img.style ?? "none", count: 1 }); } : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "edit" && (
        <section className="space-y-6">
          <form
            className="space-y-4 rounded-lg border border-line bg-raised p-5"
            onSubmit={(e) => { e.preventDefault(); setEditResult(null); edit.mutate(); }}
          >
            <div>
              <label htmlFor="studio-file" className="text-sm font-medium">Image to edit</label>
              <input
                id="studio-file" ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setEditResult(null); }}
                className="mt-1.5 block w-full text-sm"
              />
              <p className="mt-1 text-xs text-fg-3">JPEG, PNG or WebP, up to {s.max_upload_mb} MB. Your original is kept untouched.</p>
            </div>
            {preview && <img src={preview} alt="Your original upload" className="max-h-56 rounded-md border border-line" />}
            <div>
              <label htmlFor="studio-edit-prompt" className="text-sm font-medium">What should change?</label>
              <textarea
                id="studio-edit-prompt" value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} maxLength={500} rows={2}
                placeholder="Change the background to a plain light grey studio backdrop"
                className="mt-1.5 w-full rounded-md border border-line-strong bg-raised p-3 text-sm"
              />
              <p className="mt-1 text-xs text-fg-3">Edits are regenerated by the model: fine details such as small text or logos may change, and it sometimes ignores an instruction. If so, run it again or rephrase.</p>
            </div>
            <Button type="submit" variant="ai" disabled={busy || !s.edit.available || limitReached || !file || editPrompt.trim().length < 3}>
              {edit.isPending ? "Editing…" : "Edit image"}
            </Button>
            {edit.isPending && <p role="status" className="text-xs text-fg-3">Editing your image. This can take up to a minute.</p>}
          </form>
          {editResult && <BeforeAfter original={editResult.original} edited={editResult.edited} />}
        </section>
      )}

      {tab === "enhance" && (
        <EmptyState
          title="Enhancement is coming soon"
          body={s.enhance.note ?? "Enhancement isn't available yet."}
          action={<Button variant="secondary" onClick={() => setTab("edit")}>Try Edit instead</Button>}
        />
      )}

      {open && <Lightbox image={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

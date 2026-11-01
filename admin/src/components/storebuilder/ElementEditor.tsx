import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ApiError, applyElementEdit, discardElementEdit, proposeElementEdit, type EditableRegistry, type ElementEditProposal, type StorefrontVersion } from "../../api/client";
import Button from "../ui/Button";
import AiStatusNote from "../AiStatusNote";
import NovaFace from "../NovaFace";
import { currentValue, displayValue, elementOf, findSection, type Selection } from "./types";

type Phase = "idle" | "proposing" | "ready" | "applying" | "applied";

interface Problem {
  message: string;
  code?: string;
}

/** The right-hand panel: what is selected, what it currently says, and NOVA's "Want to change this?" flow
 * (propose -> review a structured diff -> apply to the DRAFT or discard). */
export default function ElementEditor({
  draft, registry, selection, onApplied, onStale, onClear,
}: {
  draft: StorefrontVersion;
  registry: EditableRegistry | undefined;
  selection: Selection | null;
  /** The draft after a successful apply (the page updates the preview and keeps the selection). */
  onApplied: (draft: StorefrontVersion) => void;
  /** The draft changed under a proposal: reload it. */
  onStale: () => void;
  onClear: () => void;
}) {
  const element = selection ? elementOf(registry, selection.element) : undefined;
  const [instruction, setInstruction] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [proposal, setProposal] = useState<ElementEditProposal | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionKey = selection ? `${selection.sectionId ?? "-"}:${selection.element}` : "";

  // A different element means a fresh conversation; nothing carries over from the previous one.
  useEffect(() => {
    setInstruction("");
    setPhase("idle");
    setProposal(null);
    setProblem(null);
    setConfirmation(null);
    if (selectionKey) inputRef.current?.focus({ preventScroll: true });
  }, [selectionKey]);

  if (!selection || !element) {
    return (
      <div className="flex flex-col gap-3" data-testid="editor-empty">
        <div className="flex items-center gap-3">
          <NovaFace size={32} look="center" />
          <h2 className="text-[15px] font-semibold text-fg">Click anything on your store</h2>
        </div>
        <p className="text-sm leading-relaxed text-fg-2">
          Select a headline, button, banner, product grid or the site's look right in the preview, or pick it from the list. Then tell me what you want
          and I'll propose a change for you to review. Nothing is live until you publish.
        </p>
        <ul className="space-y-1.5 text-[13px] text-fg-3">
          <li>· “Make the hero headline sound more premium”</li>
          <li>· “Show only four products in the grid”</li>
          <li>· “Use a warmer cream background”</li>
        </ul>
      </div>
    );
  }

  const section = findSection(draft, selection.sectionId);
  const stale = proposal !== null && proposal.revision !== draft.revision && phase === "ready";

  const propose = async () => {
    if (!instruction.trim() || phase === "proposing") return;
    setPhase("proposing");
    setProblem(null);
    setConfirmation(null);
    setProposal(null);
    try {
      setProposal(await proposeElementEdit({ draft_id: draft.id, revision: draft.revision, section_id: selection.sectionId, element: selection.element, instruction: instruction.trim() }));
      setPhase("ready");
    } catch (err) {
      setPhase("idle");
      if (err instanceof ApiError && err.code === "stale_draft") {
        setProblem({ message: err.message, code: "stale_draft" });
      } else if (err instanceof ApiError) {
        setProblem({ message: err.message, code: err.code });
      } else {
        setProblem({ message: "NOVA couldn't reach the server. Your draft hasn't changed." });
      }
    }
  };

  const apply = async () => {
    if (!proposal || phase !== "ready") return;
    setPhase("applying");
    setProblem(null);
    try {
      const updated = await applyElementEdit(proposal.proposal_id, proposal.revision);
      onApplied(updated);
      setConfirmation(`Applied to your draft: ${proposal.summary.toLowerCase()}. The live store is unchanged until you publish.`);
      setProposal(null);
      setInstruction("");
      setPhase("applied");
    } catch (err) {
      setPhase("ready");
      if (err instanceof ApiError && err.code === "stale_draft") {
        setProblem({ message: err.message, code: "stale_draft" });
        setProposal(null);
        setPhase("idle");
      } else {
        setProblem({ message: err instanceof ApiError ? err.message : "Something went wrong saving that. Your draft hasn't changed." });
      }
    }
  };

  const discard = async () => {
    const id = proposal?.proposal_id;
    setProposal(null);
    setPhase("idle");
    setProblem(null);
    if (id) await discardElementEdit(id).catch(() => undefined); // best effort: discarding never changes the draft either way
  };

  const busy = phase === "proposing" || phase === "applying";
  return (
    <div className="flex flex-col gap-4" data-testid="element-editor">
      <div>
        <p className="eyebrow">{section ? `${registry?.section_types.find((s) => s.type === section.section.type)?.label ?? "Section"} · selected` : "Whole site · selected"}</p>
        <div className="mt-1 flex items-start justify-between gap-2">
          <h2 className="text-[17px] font-semibold tracking-tight text-fg" data-testid="selected-label">{element.label}</h2>
          <button type="button" onClick={onClear} className="rounded px-1.5 py-0.5 text-xs text-fg-3 hover:bg-sunken hover:text-fg">Deselect</button>
        </div>
      </div>

      <dl className="rounded-md border border-line bg-sunken/60 p-3 text-[13px]" aria-label="Current content">
        {element.properties.map((p) => (
          <div key={p.path} className="grid grid-cols-[92px_1fr] gap-2 py-1">
            <dt className="text-fg-3">{p.label}</dt>
            <dd className="break-words text-fg" data-testid={`current-${p.path}`}>{displayValue(currentValue(draft, selection, p.path, registry))}</dd>
          </div>
        ))}
      </dl>

      {phase !== "ready" && phase !== "applying" && (
        <form onSubmit={(e) => { e.preventDefault(); void propose(); }} className="flex flex-col gap-2.5">
          <label htmlFor="sb-instruction" className="flex items-center gap-2 text-[14px] font-medium text-fg">
            <NovaFace size={22} look="center" /> Want to change this?
          </label>
          <textarea
            id="sb-instruction" ref={inputRef} rows={3} value={instruction} maxLength={600}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void propose(); } }}
            placeholder="Describe the change in your own words…"
            className="w-full resize-none rounded-md border border-line-strong bg-raised px-3 py-2 text-sm text-fg placeholder:text-fg-3 focus-visible:outline-none focus-visible:shadow-focus"
          />
          {element.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Suggestions">
              {element.suggestions.map((s) => (
                <button key={s} type="button" onClick={() => { setInstruction(s); inputRef.current?.focus(); }} className="rounded-full border border-line-strong bg-raised px-2.5 py-1 text-xs text-fg-2 hover:border-corona hover:text-fg">{s}</button>
              ))}
            </div>
          )}
          <Button type="submit" variant="ai" disabled={!instruction.trim() || busy} data-testid="propose-change">
            {phase === "proposing" ? "NOVA is thinking…" : "Propose change"}
          </Button>
          <AiStatusNote />
        </form>
      )}

      <div aria-live="polite" className="flex flex-col gap-3">
        {phase === "proposing" && <p role="status" className="text-xs text-fg-3">Reading the element and your brand…</p>}
        {problem && (
          <div role="alert" className="rounded-md border border-bad/50 bg-bad-soft p-3 text-[13px] text-bad" data-testid="editor-problem">
            <p>{problem.message}</p>
            {problem.code === "stale_draft" && (
              <button type="button" onClick={onStale} className="mt-2 text-xs font-medium underline underline-offset-2">Reload the draft</button>
            )}
          </div>
        )}
        {confirmation && (
          <p role="status" className="rounded-md border border-ok/50 bg-ok-soft p-3 text-[13px] text-ok" data-testid="editor-confirmation">{confirmation}</p>
        )}

        {proposal && (phase === "ready" || phase === "applying") && (
          <section aria-label="Proposed change" className={clsx("rounded-xl border-[1.5px] border-dashed bg-raised p-4", stale ? "border-warn" : "border-corona")} data-testid="proposal">
            <p className="eyebrow">Proposed · nothing has changed yet</p>
            <h3 className="mt-1 text-[15px] font-semibold text-fg" data-testid="proposal-summary">{proposal.summary}</h3>
            <ul className="mt-3 space-y-3">
              {proposal.changes.map((c) => (
                <li key={c.path} className="text-[13px]" data-testid={`change-${c.path}`}>
                  <p className="text-fg-3">{c.label}</p>
                  <p className="mt-0.5 text-fg-3 line-through decoration-line-strong" data-testid="change-current">{displayValue(c.current)}</p>
                  <p className="mt-0.5 font-medium text-fg" data-testid="change-proposed">{displayValue(c.proposed)}</p>
                </li>
              ))}
            </ul>
            {proposal.reasoning && <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-fg-2">{proposal.reasoning}</p>}
            {proposal.warnings.length > 0 && <ul className="mt-2 space-y-1 text-xs text-warn">{proposal.warnings.map((w) => <li key={w}>· {w}</li>)}</ul>}
            {stale && <p role="alert" className="mt-3 text-xs font-medium text-warn">The draft changed after this proposal was made, so it can't be applied. Discard it and propose again.</p>}
            <p className="mt-3 text-[11px] text-fg-3">Applying edits the draft only. Customers see nothing until you publish.</p>
            <div className="mt-3 flex gap-2">
              <Button variant="primary" onClick={apply} disabled={stale || phase === "applying"} data-testid="apply-change">{phase === "applying" ? "Applying…" : "Apply to Draft"}</Button>
              <Button variant="secondary" onClick={discard} disabled={phase === "applying"} data-testid="discard-change">Discard</Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

import clsx from "clsx";
import type { EditableRegistry, StorefrontVersion } from "../../api/client";
import { elementPresent, type Selection } from "./types";

const SECTION_LABEL = (registry: EditableRegistry | undefined, type: string) => registry?.section_types.find((s) => s.type === type)?.label ?? type;

/** Pages of THIS draft and the editable parts of the current page. Only what the storefront can render and the registry allows
 * is listed. Selecting something here selects (and scrolls to) the same thing in the preview. */
export default function Outline({
  draft, registry, pageSlug, onPage, selected, onSelect, hasChanges,
}: {
  draft: StorefrontVersion;
  registry: EditableRegistry | undefined;
  pageSlug: string;
  onPage: (slug: string) => void;
  selected: Selection | null;
  onSelect: (s: Selection) => void;
  hasChanges: boolean;
}) {
  const page = draft.pages.find((p) => p.slug === pageSlug) ?? draft.pages[0];
  const sections = page.sections.slice().sort((a, b) => a.order - b.order);
  const isSelected = (sectionId: string | null, element: string) => selected?.element === element && selected.sectionId === sectionId;

  return (
    <nav aria-label="Pages and elements" className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <span className={clsx("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium", hasChanges ? "border-corona border-dashed bg-corona-soft text-corona-ink" : "border-line-strong bg-sunken text-fg-2")}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {hasChanges ? "Unpublished changes" : "Draft matches live"}
        </span>
      </div>

      <div>
        <label htmlFor="sb-page" className="eyebrow">Page</label>
        <select id="sb-page" value={page.slug} onChange={(e) => onPage(e.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-line-strong bg-raised px-2.5 text-sm text-fg">
          {draft.pages.slice().sort((a, b) => a.order - b.order).map((p) => <option key={p.id} value={p.slug}>{p.title}</option>)}
        </select>
      </div>

      <div>
        <p className="eyebrow">Sections</p>
        <ol className="mt-2 space-y-1">
          {sections.map((section) => {
            const elements = (registry?.elements ?? []).filter((e) => e.section_type === section.type && elementPresent(e, section.configuration));
            const sectionActive = selected?.sectionId === section.id;
            return (
              <li key={section.id}>
                <p className={clsx("flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium", sectionActive ? "text-fg" : "text-fg-2")}>
                  <span aria-hidden className={clsx("h-1.5 w-1.5 rounded-full", sectionActive ? "bg-corona" : "bg-line-strong")} />
                  {SECTION_LABEL(registry, section.type)}
                </p>
                <ul className="ml-3.5 border-l border-line pl-2">
                  {elements.map((el) => (
                    <li key={el.key}>
                      <button
                        type="button"
                        onClick={() => onSelect({ sectionId: section.id, element: el.key })}
                        aria-current={isSelected(section.id, el.key) ? "true" : undefined}
                        data-testid={`outline-${el.key}`}
                        className={clsx(
                          "w-full rounded-md px-2 py-1 text-left text-[12.5px] transition-colors duration-instant",
                          isSelected(section.id, el.key) ? "bg-corona-soft font-medium text-corona-ink" : "text-fg-2 hover:bg-sunken hover:text-fg",
                        )}
                      >
                        {el.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>

      <div>
        <p className="eyebrow">Whole site</p>
        <button
          type="button"
          onClick={() => onSelect({ sectionId: null, element: "theme.style" })}
          aria-current={isSelected(null, "theme.style") ? "true" : undefined}
          data-testid="outline-theme.style"
          className={clsx("mt-2 w-full rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-colors duration-instant", isSelected(null, "theme.style") ? "bg-corona-soft text-corona-ink" : "text-fg-2 hover:bg-sunken hover:text-fg")}
        >
          Theme: colors, type, corners
        </button>
      </div>
    </nav>
  );
}

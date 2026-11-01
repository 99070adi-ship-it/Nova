// What the person has selected on the current screen, sent with chat messages so NOVA can answer about it.
// Pages set it while something is selected and clear it on unmount. The server only accepts product / section / step.
export type SessionFocus = Partial<Record<"product" | "section" | "step", string>>;

let current: SessionFocus | undefined;

export function setSessionFocus(focus: SessionFocus | undefined): void {
  current = focus && Object.keys(focus).length ? focus : undefined;
}

export function getSessionFocus(): SessionFocus | undefined {
  return current;
}

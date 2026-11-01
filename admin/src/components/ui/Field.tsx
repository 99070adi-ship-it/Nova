import clsx from "clsx";
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const CONTROL =
  "w-full rounded-md border bg-raised px-3 text-sm text-fg placeholder:text-fg-3 " +
  "transition-[border-color,box-shadow] duration-instant ease-settle disabled:cursor-not-allowed disabled:opacity-60";
const STATE = (invalid?: boolean) => (invalid ? "border-bad" : "border-line-strong hover:border-fg-3");

/** Label + control + hint/error wrapper. Pass `invalid` to the control as well for the red border. */
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-xs font-medium text-fg-2">
          {label}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-bad">{error}</p> : hint ? <p className="text-xs text-fg-3">{hint}</p> : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={clsx(CONTROL, "h-10", STATE(invalid), className)} {...rest} />;
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ invalid, className, ...rest }, ref) {
  return <select ref={ref} aria-invalid={invalid || undefined} className={clsx(CONTROL, "h-10", STATE(invalid), className)} {...rest} />;
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, className, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={clsx(CONTROL, "min-h-[88px] py-2", STATE(invalid), className)} {...rest} />;
});

/** Convenience: an Input with its label and message wired together by a generated id. */
export function LabeledInput({ label, hint, error, ...rest }: InputProps & { label: string; hint?: string; error?: string | null }) {
  const generated = useId();
  const id = rest.id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <Input {...rest} id={id} invalid={!!error} />
    </Field>
  );
}

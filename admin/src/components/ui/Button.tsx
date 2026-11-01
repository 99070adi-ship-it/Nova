import clsx from "clsx";
import { forwardRef, type ButtonHTMLAttributes } from "react";

/** Variants: `primary` ink (the default decisive action), `secondary` outlined, `ghost` quiet,
 * `ai` Corona (reserved for NOVA's own suggested actions), `danger` destructive. Approval is a human
 * decision and is drawn in ink, never Corona. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "ai" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-inverse text-inverse-on hover:bg-inverse/90 border border-transparent",
  secondary: "bg-raised text-fg border border-line-strong hover:bg-sunken",
  ghost: "bg-transparent text-fg-2 border border-transparent hover:bg-sunken hover:text-fg",
  ai: "bg-corona text-corona-on border border-transparent shadow-glow hover:brightness-105",
  danger: "bg-bad-soft text-bad border border-bad/40 hover:bg-bad-soft/70",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-3.5 text-[13.5px]",
};

/** For anchors / router links that should look like a button. */
export function buttonClass({ variant = "primary", size = "md" }: { variant?: ButtonVariant; size?: ButtonSize } = {}) {
  return clsx(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium",
    "transition-[background-color,box-shadow,filter,color] duration-instant ease-settle",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANT[variant],
    SIZE[size],
  );
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", className, type = "button", ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={clsx(buttonClass({ variant, size }), className)} {...rest} />;
});

export default Button;

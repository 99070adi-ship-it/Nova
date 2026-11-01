import clsx from "clsx";
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

/** Data table: sunken header row, hairline row dividers, 44px rows. Numerals use `num`. */
export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-raised">
      <table className={clsx("w-full border-collapse text-sm", className)} {...rest} />
    </div>
  );
}
export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={clsx("eyebrow bg-sunken px-4 py-2.5 text-left", className)} {...rest} />;
}
/** `highlight` marks a row NOVA is referring to (Corona edge). */
export function Tr({ highlight, className, ...rest }: HTMLAttributes<HTMLTableRowElement> & { highlight?: boolean }) {
  return (
    <tr
      className={clsx(
        "border-t border-line transition-colors duration-instant first:border-t-0 hover:bg-sunken/60",
        highlight && "bg-corona-soft/60 shadow-[inset_3px_0_0_rgb(var(--corona))]",
        className,
      )}
      {...rest}
    />
  );
}
export function Td({ num, className, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return <td className={clsx("h-11 px-4 align-middle", num && "font-mono tabular-nums", className)} {...rest} />;
}

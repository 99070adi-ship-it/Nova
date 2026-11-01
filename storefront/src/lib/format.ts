export function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

export function variantLabel(attributes: Record<string, unknown> | null | undefined): string {
  if (!attributes) return "";
  return Object.entries(attributes)
    .filter(([k, v]) => k !== "material" && typeof v === "string" && v)
    .map(([, v]) => String(v))
    .join(" / ");
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

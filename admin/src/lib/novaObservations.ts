import {
  type ActionPlan,
  type LowStockProduct,
  type SalesSummary,
  type StoreHealthReport,
  getCustomerActivity,
  getLatestActionPlan,
  getLatestStoreHealth,
  getLowStockProducts,
  getSalesSummary,
} from "../api/client";

/**
 * Lines NOVA says about the business's ACTUAL condition. The static script (novaScript.ts) never claims
 * anything about stock, customers or approvals; these are built from what the server returns at the moment
 * they are spoken, so a joke about a low-stock bestseller can only be made when there is one. If any data
 * is missing, slow or fails, the plain scripted line is used instead.
 */

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const count = (n: number, noun: string) => `${n <= 12 ? WORDS[n] : n} ${noun}${n === 1 ? "" : "s"}`;
const MAX_LINE = 170; // keep it a comfortable beat: the same text is typed and spoken

export interface HealthFacts {
  report: StoreHealthReport | null;
  lowStock: LowStockProduct[];
  sales: SalesSummary | null;
  inactiveCustomers: number;
}

/** What NOVA says right after the visitor ran the store checkup. Every claim comes from `facts`. */
export function healthReply(facts: HealthFacts, fallback: string): string {
  const needsLook = (facts.report?.findings ?? []).filter((f) => f.status !== "good").length;
  const topTitles = new Set((facts.sales?.top_products ?? []).map((p) => p.title));
  const topSellerLow = facts.lowStock.find((p) => topTitles.has(p.title));

  let detail: string | null = null;
  if (topSellerLow) {
    detail = `${topSellerLow.title} is a top seller and down to ${count(topSellerLow.on_hand, "unit")}. Selling out is a good problem, until it's an avoidable one.`;
  } else if (facts.lowStock.length > 0) {
    detail = `${count(facts.lowStock.length, "item")} ${facts.lowStock.length === 1 ? "is" : "are"} at or below the low stock mark, starting with ${facts.lowStock[0].title}.`;
  } else if (facts.inactiveCustomers > 0) {
    detail = `${count(facts.inactiveCustomers, "customer")} ${facts.inactiveCustomers === 1 ? "has" : "have"} gone quiet. Quiet isn't lost. Yet.`;
  } else if (needsLook > 0) {
    detail = `${count(needsLook, "thing")} ${needsLook === 1 ? "is" : "are"} worth a look.`;
  } else if (facts.report) {
    detail = "Everything looks healthy. Suspicious, honestly, but I'll take it.";
  }
  if (!detail) return fallback;

  let line = `Checkup done. ${detail}`;
  if (line.length + 24 <= MAX_LINE) line += " Let's fix what we can.";
  return line.length <= MAX_LINE ? line : fallback;
}

/** What NOVA says once the action plan exists: only what the plan's real item statuses show. */
export function handoffReply(plan: ActionPlan | null, fallback: string): string {
  if (!plan) return fallback;
  const handled = plan.items.filter((i) => i.status === "executed").length;
  const waiting = plan.items.filter((i) => i.status === "proposed").length;
  const tail = "That's the tour. I'm in the corner bubble if you need me.";
  if (handled === 0 && waiting === 0) return plan.items.length === 0 ? `Nothing needed fixing, which is the best kind of plan. ${tail}` : fallback;
  const parts: string[] = [];
  if (handled > 0) parts.push(`I handled ${count(handled, "small thing")} myself.`);
  if (waiting > 0) parts.push(`${count(waiting, "bigger move")} ${waiting === 1 ? "is" : "are"} waiting in Approvals, because you're the boss.`);
  const joined = `${parts.join(" ")} ${tail}`;
  const line = joined.charAt(0).toUpperCase() + joined.slice(1);
  return line.length <= MAX_LINE ? line : fallback;
}

/** Never let a slow or failed lookup hold the tour: give up after `ms` and use the scripted line. */
export async function withinTime<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((resolve) => (timer = setTimeout(() => resolve(fallback), ms)))]);
  } catch {
    return fallback;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const LOOKUP_MS = 2500;

export async function gatherHealthFacts(): Promise<HealthFacts> {
  const [report, lowStock, sales, customers] = await Promise.all([
    getLatestStoreHealth().catch(() => null),
    getLowStockProducts().catch(() => [] as LowStockProduct[]),
    getSalesSummary(30).catch(() => null),
    getCustomerActivity(30).catch(() => []),
  ]);
  return { report, lowStock, sales, inactiveCustomers: customers.filter((c) => c.inactive).length };
}

export const verifiedHealthReply = (fallback: string) =>
  withinTime(gatherHealthFacts().then((f) => healthReply(f, fallback)), LOOKUP_MS, fallback);

export const verifiedHandoff = (fallback: string) =>
  withinTime(getLatestActionPlan().then((p) => handoffReply(p, fallback)), LOOKUP_MS, fallback);

/** Lessons whose reply or completion line is built from real data (by lesson key). */
export const VERIFIED_LINES: Record<string, { respond?: (fallback: string) => Promise<string>; done?: (fallback: string) => Promise<string> }> = {
  run_business: { respond: verifiedHealthReply, done: verifiedHandoff },
};

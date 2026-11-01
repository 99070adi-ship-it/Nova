import { describe, expect, it, vi } from "vitest";
import type { ActionPlan, StoreHealthReport } from "../api/client";
import { handoffReply, healthReply, type HealthFacts, withinTime } from "./novaObservations";

// NOVA only jokes about what is true. Each line below is built from facts the server returned, so the
// tests feed it facts and check that the words follow them exactly (and that nothing is claimed otherwise).

const FALLBACK = "Checkup done. Some of this I can fix myself, and some of it needs you.";
const report = (statuses: Array<"good" | "watch" | "at_risk">): StoreHealthReport => ({
  run_id: "r", narrative: {}, trace: {}, generated_at: null,
  findings: statuses.map((status, i) => ({ category: "sales", metric: `m${i}`, status, finding: "x", severity: "low", evidence: {}, suggested_action: null })),
});
const facts = (over: Partial<HealthFacts> = {}): HealthFacts => ({ report: report(["good"]), lowStock: [], sales: null, inactiveCustomers: 0, ...over });

describe("healthReply: the checkup, in NOVA's voice, from real data", () => {
  it("jokes about a low-stock bestseller only when the low-stock item really is a top seller", () => {
    const line = healthReply(
      facts({
        lowStock: [{ title: "Structured Tote", sku: "S", on_hand: 2, low_stock_threshold: 5 }],
        sales: { revenue: 1, orders: 1, days: 30, top_products: [{ title: "Structured Tote", revenue: 1, units: 9 }] },
      }),
      FALLBACK,
    );
    expect(line).toContain("Structured Tote is a top seller and down to two units");
    expect(line).toContain("good problem");
  });

  it("states low stock plainly, without calling it a bestseller or joking, when it is not a top seller", () => {
    const line = healthReply(
      facts({
        lowStock: [{ title: "Coin Pouch", sku: "C", on_hand: 1, low_stock_threshold: 5 }],
        sales: { revenue: 1, orders: 1, days: 30, top_products: [{ title: "Something Else", revenue: 1, units: 1 }] },
      }),
      FALLBACK,
    );
    expect(line).toContain("one item is at or below the low stock mark, starting with Coin Pouch");
    expect(line).not.toMatch(/top seller|good problem/);
  });

  it("mentions quiet customers only if some really are inactive", () => {
    expect(healthReply(facts({ inactiveCustomers: 3 }), FALLBACK)).toContain("three customers have gone quiet");
    expect(healthReply(facts({ inactiveCustomers: 0 }), FALLBACK)).not.toMatch(/quiet/);
  });

  it("reports the number of findings worth a look when there is nothing more specific", () => {
    expect(healthReply(facts({ report: report(["watch", "at_risk", "good"]) }), FALLBACK)).toContain("two things are worth a look");
  });

  it("only says everything is healthy when a report exists and every finding is good", () => {
    expect(healthReply(facts({ report: report(["good", "good"]) }), FALLBACK)).toContain("Everything looks healthy");
    expect(healthReply(facts({ report: null }), FALLBACK)).toBe(FALLBACK); // nothing known: the plain scripted line
  });

  it("never invents a low-stock claim when there is none (empty store, no data)", () => {
    const line = healthReply(facts({ report: null, lowStock: [], inactiveCustomers: 0 }), FALLBACK);
    expect(line).toBe(FALLBACK);
  });

  it("stays a comfortable beat and speakable: falls back rather than run long", () => {
    const long = "A Very Long Product Title ".repeat(8).trim();
    const line = healthReply(facts({ lowStock: [{ title: long, sku: "L", on_hand: 1, low_stock_threshold: 5 }] }), FALLBACK);
    expect(line.length).toBeLessThanOrEqual(170);
  });
});

const plan = (statuses: string[]): ActionPlan => ({
  id: "p", run_id: "r", generated_at: null,
  items: statuses.map((status, i) => ({ tool_name: "t", risk: "low", auto_executable: true, status, proposal_id: `${i}`, description: "d" })),
});
const FALLBACK_DONE = "That's the tour. I'm in the corner bubble if you need me, and yes, I do accept small talk.";

describe("handoffReply: what changed, from the real action plan", () => {
  it("counts only what the plan's statuses show: executed items were handled, proposed ones wait in Approvals", () => {
    const line = handoffReply(plan(["executed", "executed", "proposed"]), FALLBACK_DONE);
    expect(line).toContain("I handled two small things myself.");
    expect(line).toContain("one bigger move is waiting in Approvals, because you're the boss.");
    expect(line).toContain("That's the tour.");
  });

  it("starts with a capital even when only waiting items exist", () => {
    expect(handoffReply(plan(["proposed"]), FALLBACK_DONE)).toMatch(/^One bigger move/);
  });

  it("does not claim anything was handled when nothing was executed", () => {
    const line = handoffReply(plan(["proposed"]), FALLBACK_DONE);
    expect(line).not.toMatch(/handled/);
    expect(line).toContain("One bigger move is waiting in Approvals");
  });

  it("an empty plan says nothing needed fixing", () => {
    expect(handoffReply(plan([]), FALLBACK_DONE)).toContain("Nothing needed fixing");
  });

  it("without a plan, or with statuses it does not understand, the scripted line is used", () => {
    expect(handoffReply(null, FALLBACK_DONE)).toBe(FALLBACK_DONE);
    expect(handoffReply(plan(["execution_failed"]), FALLBACK_DONE)).toBe(FALLBACK_DONE);
  });
});

describe("withinTime: a slow or failing lookup never holds up the tour", () => {
  it("returns the fallback after the deadline", async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r("late"), 200));
    expect(await withinTime(slow, 20, "fallback")).toBe("fallback");
  });
  it("returns the fallback when the lookup fails", async () => {
    expect(await withinTime(Promise.reject(new Error("down")), 100, "fallback")).toBe("fallback");
  });
  it("returns the real value when it arrives in time", async () => {
    expect(await withinTime(Promise.resolve("real"), 100, "fallback")).toBe("real");
  });
  it("is silent about timers once done", async () => {
    const spy = vi.spyOn(globalThis, "clearTimeout");
    await withinTime(Promise.resolve("x"), 100, "y");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

import { describe, expect, it } from "vitest";
import { LESSON_STEPS, primaryActionTarget } from "./novaLessons";

// Every lesson's demo always ends by spotlighting the exact real control the user then needs to
// press (NovaGuideWidget.tsx derives userTurnTarget from this) — these are the only two
// two-action lessons, both confirmed against the real backend completion rule they're gated by
// (backend/app/services/onboarding_service.py).
const TWO_ACTION_STEPS = new Set(["nl_edit", "run_business"]);

describe("LESSON_STEPS — every lesson defines a clear, deterministic next action (requirement 1/6)", () => {
  it("covers all ten onboarding steps, in order", () => {
    const keys = LESSON_STEPS.map((s) => s.key);
    expect(keys).toEqual([
      "brand", "products", "catalog", "review", "collections", "storefront", "preview", "nl_edit", "publish", "run_business",
    ]);
  });

  it.each(LESSON_STEPS)("$key has a meaningful title, a real target, and a non-generic next-action label", (step) => {
    expect(step.title.length).toBeGreaterThan(5);
    expect(step.path.startsWith("/")).toBe(true);
    expect(step.demoActions.length).toBeGreaterThan(0);

    // The deterministic next-action label must never be empty, and must never be a placeholder
    // like "Let's get started." — it's always the real control's own exact label text.
    expect(step.nextActionLabel.trim().length).toBeGreaterThan(0);
    expect(step.nextActionLabel.toLowerCase()).not.toContain("let's get started");

    // userTurnTarget (what NovaGuideWidget.tsx actually spotlights for the whole user_turn
    // phase) is derived from the lesson's own last demoAction with a target — must resolve to a
    // real key, not silently be undefined.
    expect(primaryActionTarget(step)).toBeTruthy();

    expect(step.intro.length).toBeGreaterThan(5);
    expect(step.explain.length).toBeGreaterThan(5);
    expect(step.done.length).toBeGreaterThan(5);
    expect(step.afterActionHint.length).toBeGreaterThan(5);
  });

  it.each([...TWO_ACTION_STEPS])("%s defines a second real action with its own exact label", (key) => {
    const step = LESSON_STEPS.find((s) => s.key === key)!;
    expect(step.secondUserTurnTarget).toBeTruthy();
    expect(step.secondActionLabel?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("every other lesson has no second action — a single real control completes it", () => {
    for (const step of LESSON_STEPS) {
      if (TWO_ACTION_STEPS.has(step.key)) continue;
      expect(step.secondUserTurnTarget).toBeUndefined();
    }
  });

  it("nl_edit's first action is Propose and its second is the real Apply control — proposing alone must never be treated as the final action", () => {
    const nlEdit = LESSON_STEPS.find((s) => s.key === "nl_edit")!;
    expect(primaryActionTarget(nlEdit)).toBe("nl_edit_form.propose");
    expect(nlEdit.secondUserTurnTarget).toBe("nl_edit_form.apply");
    expect(nlEdit.nextActionLabel).toBe("Propose");
    expect(nlEdit.secondActionLabel).toBe("Apply to draft");
  });

  it("every target referenced anywhere in the registry follows the real data-nova-target naming convention", () => {
    const allTargets = LESSON_STEPS.flatMap((s) => [
      ...s.demoActions.map((a) => a.target).filter(Boolean),
      s.secondUserTurnTarget,
    ]).filter((t): t is string => !!t);
    for (const target of allTargets) {
      expect(target).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });
});

// ---- Server contract (contracts/onboarding-steps.json, owned by backend STEP_DEFINITIONS) ----
import contract from "../../../contracts/onboarding-steps.json";

// Every line is typed (6 characters per second in Text only) and spoken, so each is written to a budget: a
// beat or two, never a paragraph. The playful copy is longer than the bare instructions it replaced, but a
// single line still stays under about 20 seconds of typing, and a whole lesson well under a minute.
const BUDGET = { intro: 115, explain: 125, done: 100, respond: 90, perStep: 300 };
const visibleChars = (t: string) => t.replace(/\s/g, "").length;
const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean).length;

describe("LESSON_STEPS narration is concise enough to type and speak", () => {
  it.each(LESSON_STEPS)("$key: every line fits its character budget, in at most three sentences", (step) => {
    expect(step.intro.length).toBeLessThanOrEqual(BUDGET.intro);
    expect(step.explain.length).toBeLessThanOrEqual(BUDGET.explain);
    expect(step.done.length).toBeLessThanOrEqual(BUDGET.done);
    if (step.respond) expect(step.respond.length).toBeLessThanOrEqual(BUDGET.respond);
    for (const text of [step.intro, step.explain, step.done, step.respond].filter((t): t is string => !!t)) {
      expect(sentences(text)).toBeLessThanOrEqual(3);
      expect(text.trim()).toBe(text);
      expect(text).toMatch(/[.!?]$/);
    }
    const total = [step.intro, step.explain, step.done, step.respond ?? ""].reduce((n, t) => n + visibleChars(t), 0);
    expect(total).toBeLessThanOrEqual(BUDGET.perStep);
    expect(total / 6).toBeLessThanOrEqual(60); // seconds of typing at 6 characters per second
  });

  it("keeps the essential instruction in the explanation where the task needs one (not just shortened away)", () => {
    const nl = LESSON_STEPS.find((l) => l.key === "nl_edit")!;
    expect(nl.explain.toLowerCase()).toMatch(/propose/);
    expect(nl.explain.toLowerCase()).toMatch(/apply/);
    const run = LESSON_STEPS.find((l) => l.key === "run_business")!;
    expect(run.explain.toLowerCase()).toMatch(/wait/); // risky actions wait for the owner
    const review = LESSON_STEPS.find((l) => l.key === "review")!;
    expect(review.explain.toLowerCase()).toMatch(/accept/);
  });
});

describe("LESSON_STEPS vs the backend's canonical onboarding steps", () => {
  it("has a lesson for every server-defined step, in the server's order", () => {
    const serverKeys = contract.steps.map((s) => s.key);
    expect(LESSON_STEPS.map((s) => s.key)).toEqual(serverKeys);
  });

  it("uses the server's titles verbatim, so the UI can never describe a step differently from the backend", () => {
    for (const server of contract.steps) {
      expect(LESSON_STEPS.find((l) => l.key === server.key)?.title).toBe(server.title);
    }
  });

  it("every server step has a meaningful, human-readable completion rule", () => {
    for (const s of contract.steps) expect(s.completion_rule.length).toBeGreaterThan(20);
  });
});

import { describe, expect, it } from "vitest";
import { LESSON_STEPS, primaryActionTarget } from "./novaLessons";

// Every lesson's demo always ends by spotlighting the exact real control the user then needs to
// press (NovaGuideWidget.tsx derives userTurnTarget from this) — these are the only two
// two-action lessons, both confirmed against the real backend completion rule they're gated by
// (backend/app/services/onboarding_service.py).
const TWO_ACTION_STEPS = new Set(["nl_edit", "run_business"]);

describe("LESSON_STEPS — every lesson defines a clear, deterministic next action (requirement 1/6)", () => {
  it("covers exactly the 8 real onboarding steps the Guide ever becomes active for", () => {
    const keys = LESSON_STEPS.map((s) => s.key);
    expect(keys).toEqual(["brand", "products", "catalog", "review", "storefront", "nl_edit", "publish", "run_business"]);
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

    expect(step.demoPrompt.length).toBeGreaterThan(10);
    expect(step.explainPrompt.length).toBeGreaterThan(10);
    expect(step.completePrompt.length).toBeGreaterThan(10);
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

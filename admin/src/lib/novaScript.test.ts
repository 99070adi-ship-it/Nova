import { describe, expect, it } from "vitest";
import { LESSON_STEPS } from "./novaLessons";
import {
  ALLOWED_CAPS, ASSISTANT_EMPTY_HINT, ASSISTANT_ERROR, BANNED_PHRASES, LESSON_COPY, NOVA_INTRO_BEATS,
} from "./novaScript";
import contract from "../../../contracts/onboarding-steps.json";
import { splitIntoChunks } from "./guideVoice";

// NOVA has ONE personality, written in ONE place. These tests are what keeps it that way: every lesson
// must carry its own playful line, the script must stay clean enough to speak, and no line may sound like
// a manual, a corporate deck, or a jab at the user.

const lines = (s: (typeof LESSON_STEPS)[number]) => [s.intro, s.explain, s.done, s.respond].filter((t): t is string => !!t);
const everyLine = [...NOVA_INTRO_BEATS, ...LESSON_STEPS.flatMap(lines), ASSISTANT_EMPTY_HINT];

describe("one source of truth", () => {
  it("every server step has its script, and every script is used by exactly one lesson", () => {
    expect(Object.keys(LESSON_COPY).sort()).toEqual(contract.steps.map((s) => s.key).sort());
    for (const step of LESSON_STEPS) {
      const copy = LESSON_COPY[step.key];
      expect(step.intro).toBe(copy.intro);
      expect(step.explain).toBe(copy.explain);
      expect(step.done).toBe(copy.done);
      expect(step.respond).toBe(copy.respond);
      expect(step.afterActionHint).toBe(copy.afterActionHint);
    }
  });

  it("the lesson definitions hold no narration of their own (mechanics only)", async () => {
    const source = (await import("./novaLessons?raw")).default as string;
    for (const field of ["intro:", "explain:", "done:", "respond:", "afterActionHint:"]) {
      expect(source).not.toMatch(new RegExp(`^\\s+${field}\\s*"`, "m"));
    }
  });
});

describe("NOVA introduces itself before the tutorial", () => {
  const intro = NOVA_INTRO_BEATS.join(" ").toLowerCase();

  it("says what NOVA actually is, in plain language", () => {
    expect(intro).toContain("i'm nova");
    expect(intro).toContain("co-founder");
    expect(intro).toContain("operating system");
    for (const part of ["storefront", "products", "stock", "customers", "sales"]) expect(intro).toContain(part);
    expect(intro).toMatch(/agents/);
    expect(intro).toMatch(/not a dashboard/);
  });

  it("promises human approval and hands over to VELORA", () => {
    expect(intro).toMatch(/approval/);
    expect(intro).toContain("velora");
    expect(NOVA_INTRO_BEATS[NOVA_INTRO_BEATS.length - 1]).toMatch(/velora/i);
  });

  it("is split into short beats, not a wall of text", () => {
    expect(NOVA_INTRO_BEATS.length).toBeGreaterThanOrEqual(4);
    for (const beat of NOVA_INTRO_BEATS) expect(beat.length).toBeLessThanOrEqual(150);
    expect(NOVA_INTRO_BEATS.join(" ").length).toBeLessThanOrEqual(650);
  });

  it("is itself playful, and only claims things the product really does (marketing is drafts, never sent)", () => {
    expect(intro).toMatch(/dictator|equity|sticker/);
    expect(intro).not.toMatch(/send(s)? (emails|campaigns)/);
  });
});

describe("personality: every lesson has its own playful line", () => {
  it.each(LESSON_STEPS)("$key carries a quip that really appears in what NOVA says", (step) => {
    expect(step.quip.length).toBeGreaterThan(8);
    expect(lines(step).some((l) => l.includes(step.quip))).toBe(true);
  });

  it("quips are varied: no two lessons share one, and none repeats another's key words", () => {
    const quips = LESSON_STEPS.map((s) => s.quip.toLowerCase());
    expect(new Set(quips).size).toBe(quips.length);
    const keyWords = quips.map((q) => new Set(q.split(/\W+/).filter((w) => w.length > 6)));
    for (let i = 0; i < keyWords.length; i++) {
      for (let j = i + 1; j < keyWords.length; j++) {
        const shared = [...keyWords[i]].filter((w) => keyWords[j].has(w));
        expect(shared, `${LESSON_STEPS[i].key} and ${LESSON_STEPS[j].key} reuse the same joke noun`).toEqual([]);
      }
    }
  });

  it("humor is sparing: no lesson puts a quip in every one of its lines", () => {
    for (const step of LESSON_STEPS) {
      const withQuip = lines(step).filter((l) => l.includes(step.quip)).length;
      expect(withQuip).toBeLessThan(lines(step).length);
    }
  });

  it("each lesson explains what it does and why before the action: intro and explain are distinct, substantive lines", () => {
    for (const step of LESSON_STEPS) {
      expect(step.intro).not.toBe(step.explain);
      expect(step.explain.length).toBeGreaterThan(40);
      expect(step.intro.length).toBeGreaterThan(40);
    }
  });

  it("every lesson names a clear next step for the user", () => {
    for (const step of LESSON_STEPS) {
      expect(step.nextActionLabel.length).toBeGreaterThan(0);
      expect(step.afterActionHint.length).toBeGreaterThan(20);
    }
  });
});

describe("tone rules", () => {
  it("never sounds like a corporate deck or a generic chatbot, and never mocks the user", () => {
    for (const line of everyLine) {
      for (const phrase of BANNED_PHRASES) expect(line.toLowerCase(), `"${phrase}" in: ${line}`).not.toContain(phrase);
    }
  });

  it("no emoji, no exclamation pile-ups, no shouting", () => {
    for (const line of everyLine) {
      expect(line, line).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(line, line).not.toMatch(/!!|\?\?|!\?/);
      for (const word of line.match(/\b[A-Z]{2,}\b/g) ?? []) expect(ALLOWED_CAPS.has(word), `${word} in: ${line}`).toBe(true);
      expect((line.match(/!/g) ?? []).length, line).toBeLessThanOrEqual(1);
    }
  });

  it("errors and recovery stay serious: the assistant's failure message carries no joke", () => {
    expect(ASSISTANT_ERROR.toLowerCase()).toMatch(/sorry|couldn't/);
    expect(ASSISTANT_ERROR).not.toMatch(/!|haha|oops/i);
  });

  it("makes no claim about the business's actual state in static lines (those are built from verified data)", () => {
    const stateClaims = /\b(\d+|two|three|four|five)\s+(products?|customers?|orders?|units?)\b|bestsell|top seller|abandoned cart|low on stock|running low|out of stock|declining|churn/i;
    for (const line of everyLine) expect(line, line).not.toMatch(stateClaims);
  });

  it("static lines never promise an outcome that verification has not confirmed", () => {
    for (const step of LESSON_STEPS) {
      // Intro and explain happen BEFORE the action: they must not claim it already succeeded.
      for (const text of [step.intro, step.explain]) expect(text.toLowerCase(), text).not.toMatch(/\b((?<!nothing )is live|saved|added|applied|created|accepted|drafted|loaded|written)\b/);
    }
  });
});

describe("text and voice read the same words, and the words are speakable", () => {
  it("only plain speakable characters: no digits, symbols, markup, parentheses or stray unicode", () => {
    for (const line of everyLine) {
      expect(line, line).toMatch(/^[A-Za-z' ,.!?:;-]+$/);
    }
  });

  it("each narration is one speech request (a short beat), so voice and text move together without chunking", () => {
    for (const line of everyLine) expect(splitIntoChunks(line)).toHaveLength(1);
  });

  it("is written with natural breathing points: commas, full stops, and no giant sentences", () => {
    for (const line of everyLine) {
      for (const sentence of line.split(/(?<=[.!?])\s+/)) expect(sentence.length, sentence).toBeLessThanOrEqual(125);
    }
    const questions = everyLine.filter((l) => l.includes("?"));
    expect(questions.length).toBeGreaterThan(0); // some rhetorical rhythm
  });
});

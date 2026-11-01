/**
 * NOVA's demo script: the ONE place the Guide's words are written. Nothing else authors narration (the
 * backend no longer carries a second copy; lesson definitions in novaLessons.ts only reference this).
 *
 * Personality. NOVA is a witty, playful, confident AI co-founder for e-commerce: clever, cheeky, warm,
 * conversational; mock drama now and then; light sarcasm aimed at business problems, never at the user;
 * self-aware one-liners; clear explanations that make features feel simple. Helpful before funny: a joke
 * exists to support the explanation. It is never a copy of a real comedian, character or brand.
 *
 * Every lesson says, in order: what the feature does, why the user should care, one natural quip, and
 * (after the real action) what changed, only once the server has verified it. Humor is varied and
 * sparing, never forced into every line.
 *
 * Facts. Static lines assert only what is true of the product itself (what a button does, that nothing goes
 * live without the owner, that risky actions need approval) or what NOVA literally typed in its own demo
 * (VELORA's brand text). Anything about the business's actual condition (low stock, quiet customers,
 * pending approvals) is built from verified data at the moment it is spoken (novaObservations.ts) and is
 * never claimed otherwise.
 *
 * Voice. The same strings are typed and spoken (Kokoro), so they are written for the ear: short sentences,
 * commas and full stops where a person would breathe, no symbols, no digits, nothing a speech engine would
 * mangle. lib/novaScript.test.ts enforces all of this.
 */

/** The opening: who NOVA is and why it matters, before any tutorial step. Shown as separate beats in the
 * centered presentation (not one wall of text), spoken and typed together. */
export const NOVA_INTRO_BEATS: string[] = [
  "Hey, I'm NOVA. Think of me as your e-commerce co-founder, minus the equity talks and the meetings that could have been a sentence.",
  "I'm an operating system for your online business. Your storefront, products, stock, customers and sales, all connected in one place.",
  "Not a dashboard with an AI sticker on it. My agents read your real numbers, tell you what needs fixing, and can even draft a campaign.",
  "And no, I won't make big calls behind your back. Anything risky waits for your approval. I'm a co-founder, not a tiny digital dictator.",
  "Enough about me. Let me introduce you to VELORA, a handbag brand with a store to build.",
];

export interface LessonCopy {
  /** Opens the step, in the centered presentation, before the demonstration. What it is and why. */
  intro: string;
  /** After the demonstration: why it matters, and what the user does next. */
  explain: string;
  /** Spoken only once the server has verified the step. Static fallback where a verified line is built. */
  done: string;
  /** Lessons with two real actions: said after the first one succeeds. */
  respond?: string;
  /** The line shown under "Next:", about what comes after. Written, not spoken. */
  afterActionHint: string;
  /** The one playful line of the lesson. It must appear verbatim in one of the narration lines, so a
   * lesson can never ship without its personality (and tests can see it). */
  quip: string;
}

export const LESSON_COPY: Record<string, LessonCopy> = {
  brand: {
    intro: "Meet VELORA, our demo brand: handbags, wallets and quiet luxury. Watch me fill in its story.",
    explain: "Everything I build starts from this brief. Check it, then continue. Pure vibes, but accurate ones.",
    done: "Brand saved. VELORA now has a personality, which is more than most spreadsheets can say.",
    afterActionHint: "Next, we add a product, because a brand with nothing to sell is just a mood board.",
    quip: "which is more than most spreadsheets can say",
  },
  products: {
    intro: "Now a product. A store with nothing to sell is just a very tidy website.",
    explain: "Title, price, SKU, category: the facts only you know. I never guess a price. Guessing is how bags get sold at a loss.",
    done: "Product added. Your catalog just stopped being theoretical.",
    afterActionHint: "Next, I'll write the product copy for it.",
    quip: "Guessing is how bags get sold at a loss",
  },
  catalog: {
    intro: "Now the part I enjoy. I write the product copy, so you never have to stare at a blank box again.",
    explain: "I write the description and SEO text from your brand. Your price and SKU stay exactly as typed. I know my lane.",
    done: "Content written. Your product now has a voice, and it didn't even ask for a raise.",
    afterActionHint: "Then you review and accept what I wrote.",
    quip: "it didn't even ask for a raise",
  },
  review: {
    intro: "Plot twist: you're the editor now. I write the copy, you decide what counts.",
    explain: "Nothing goes live until you accept it. Tweak or reject it all you like, I won't take it personally.",
    done: "Accepted. Look at you, making actual business decisions.",
    afterActionHint: "Next, I build your storefront from your brand and this product.",
    quip: "I won't take it personally",
  },
  collections: {
    intro: "Collections next. Shoppers browse by mood, not by spreadsheet row.",
    explain: "A collection groups related products under one theme, like a shelf with a point of view.",
    done: "Collection created. The spreadsheet gremlins are losing territory.",
    afterActionHint: "Next, I build your storefront from your brand and products.",
    quip: "The spreadsheet gremlins are losing territory",
  },
  storefront: {
    intro: "Time for the storefront. I'll build a homepage from your brand and products. No lorem ipsum will be harmed.",
    explain: "It lands as a draft, so nothing is live and nobody sees my first attempt. Everyone deserves a rough draft.",
    done: "Storefront drafted. It's getting its act together.",
    afterActionHint: "Next, you get the first look, then you can ask me to improve it in plain language.",
    quip: "Everyone deserves a rough draft",
  },
  preview: {
    intro: "Before anyone else sees it, you get the first look. Consider it front-row seating.",
    explain: "The preview opens in a new tab. It's the draft, not the live store, so feel free to judge it harshly.",
    done: "Preview loaded. I'll be over here, pretending not to be nervous.",
    afterActionHint: "Next, tell me what to change, in plain language.",
    quip: "pretending not to be nervous",
  },
  nl_edit: {
    intro: "Don't love something? Tell me in plain English. No design degree required.",
    explain: "I propose a plan, you read it, then you apply it. I propose, you approve. That's the deal.",
    respond: "Plan ready. I have a plan, you have the final say. This is a partnership, not a coup.",
    done: "Applied to the draft. Your storefront just got a glow-up, with receipts.",
    afterActionHint: "Once it's applied, you're ready to publish.",
    quip: "This is a partnership, not a coup",
  },
  publish: {
    intro: "The moment of truth: publishing. This is what makes the draft visible to real customers.",
    explain: "Until you publish, shoppers only see whatever was live before. Take a breath, then press the button.",
    done: "Your store is live. The internet can see you now. Act natural.",
    afterActionHint: "Next, I'll show you how I run the business.",
    quip: "Act natural",
  },
  run_business: {
    intro: "Now the fun part: a checkup. I look at sales, stock and customers, and I don't sugarcoat.",
    explain: "Press the button for the checkup. Then I fix what I safely can, and anything risky waits for your say-so.",
    respond: "Checkup done. Some of this I can fix myself, and some of it needs you.",
    done: "That's the tour. I'm in the corner bubble if you need me, and yes, I do accept small talk.",
    afterActionHint: "That's the end of the guided tour. I'll be in the corner if you need anything else.",
    quip: "I don't sugarcoat",
  },
};

// ---- Everything else NOVA says that is not a lesson line ----------------------------------------------

/** The docked assistant's opening hint, before anyone has asked anything. */
export const ASSISTANT_EMPTY_HINT = "Ask about your store, products or storefront. Small talk is also accepted.";

/** The assistant could not be reached: serious and clear, no joke. */
export const ASSISTANT_ERROR = "Sorry, I couldn't reach NOVA just now. Try again in a moment.";

// ---- Rules the script is tested against -------------------------------------------------------------------

/** Corporate or generic-chatbot phrasing NOVA never uses. */
export const BANNED_PHRASES = [
  "leverage", "utilize", "seamless", "synergy", "robust", "empower", "cutting-edge", "game-changing",
  "unlock", "supercharge", "revolutionize", "as an ai", "i'm just an ai", "delighted to", "please be advised",
  "stupid", "idiot", "dumb", "silly you", "you forgot", "you should have",
];

/** Words allowed in capitals (everything else in capitals reads as shouting, or is mispronounced). */
export const ALLOWED_CAPS = new Set(["NOVA", "VELORA", "SEO", "SKU", "AI", "I"]);

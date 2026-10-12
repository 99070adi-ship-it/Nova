import type { UIAction } from "./novaUiActions";

/**
 * The full ten-step onboarding journey (backend/app/services/onboarding_service.py's
 * `_STEP_ORDER`), expressed as one consecutive, cross-page tour. Two of the ten keys
 * (`collections`, `preview`) never actually show up as `current_step` for the public demo
 * identity — `collections` is already satisfied by VELORA's seeded catalog, and `preview` is
 * defined to complete the instant `storefront` does — so they're intentionally absent here; the
 * widget driving this list only ever needs a lesson for a key it can actually become the current
 * step for. Every value below is real VELORA brand/catalog text, matching
 * backend/app/services/demo_service.py's `_seed_velora_catalog()`/`seed_velora_demo()` exactly,
 * so the demonstration always reads as NOVA working on this store, never a generic placeholder.
 */
export interface LessonStep {
  key: string;
  /** Mirrors backend/app/services/onboarding_service.py's _STEP_TITLES exactly — shown
   * immediately as the Guide's stated objective (requirement 1) before any narration call has
   * even resolved, so there's never a silent/unexplained moment. */
  title: string;
  /** The route this step's real UI lives on — the widget navigates here first if the visitor
   * isn't already on it, so the whole ten-step tour reads as one continuous flow regardless of
   * which page a step's real action happens to live on. */
  path: string;
  demoActions: UIAction[];
  demoPrompt: string;
  explainPrompt: string;
  completePrompt: string;
  /** The EXACT label of the real control the user needs to press to perform this step's action —
   * authored here as plain data, not left to whatever an LLM's narration happens to mention, so
   * "click X" is always correct even against a real (non-fake) provider. useNovaLesson's
   * `userTurnTarget` is derived from this same lesson's own last demoAction with a target, since
   * NOVA's demo always ends by spotlighting the exact control the user then needs to press. */
  nextActionLabel: string;
  /** For a lesson needing a second real action after the first succeeds (nl_edit: propose, then
   * apply; run_business: check health, then fix) — the target NOVA spotlights once the first
   * action's result makes it exist, and its exact button label. */
  secondUserTurnTarget?: string;
  secondActionLabel?: string;
  /** One concise sentence on what happens once this step is actually done — shown alongside the
   * step's own completion message so the user always knows what's coming next, not just that
   * this one thing finished. */
  afterActionHint: string;
}

export const LESSON_STEPS: LessonStep[] = [
  {
    key: "brand",
    title: "Tell NOVA about your business",
    path: "/create-store",
    demoActions: [
      { type: "spotlight", target: "brand_form.name" },
      { type: "fill_field", target: "brand_form.name", value: "Velora" },
      { type: "spotlight", target: "brand_form.sells_what" },
      { type: "fill_field", target: "brand_form.sells_what", value: "Handbags, wallets, and leather accessories" },
      { type: "spotlight", target: "brand_form.target_customer" },
      {
        type: "fill_field",
        target: "brand_form.target_customer",
        value: "Professionals in their late 20s to 40s who value quiet, lasting quality over logos",
      },
      { type: "spotlight", target: "brand_form.positioning" },
      { type: "fill_field", target: "brand_form.positioning", value: "Quiet luxury — considered materials and construction over trend-chasing" },
      { type: "spotlight", target: "brand_form.vibe_text" },
      { type: "fill_field", target: "brand_form.vibe_text", value: "Warm neutrals, soft structure, understated confidence" },
      { type: "spotlight", target: "brand_form.save" },
    ],
    demoPrompt: "I'm about to demonstrate describing a brand. Narrate what you're about to show me and why, in one or two sentences.",
    explainPrompt: "Explain briefly what you just showed me and why NOVA needs this to generate a storefront that actually fits the brand.",
    completePrompt: "The user just described their brand successfully. Congratulate them briefly and tell them what's next.",
    nextActionLabel: "Continue to products",
    afterActionHint: "NOVA will then help you add your first product.",
  },
  {
    key: "products",
    title: "Add your products",
    path: "/create-store",
    demoActions: [
      { type: "spotlight", target: "product_form.title" },
      { type: "fill_field", target: "product_form.title", value: "Quilted Mini Crossbody" },
      { type: "spotlight", target: "product_form.price" },
      { type: "fill_field", target: "product_form.price", value: "210" },
      { type: "spotlight", target: "product_form.sku" },
      { type: "fill_field", target: "product_form.sku", value: "VEL-QMC" },
      { type: "spotlight", target: "product_form.category" },
      { type: "fill_field", target: "product_form.category", value: "Everyday Crossbody" },
      { type: "spotlight", target: "product_form.save" },
    ],
    demoPrompt: "I'm about to demonstrate adding a product. Narrate what you're about to show me and why, in one or two sentences.",
    explainPrompt: "Explain briefly what you just showed me and why NOVA tracks known vs AI-suggested fields separately.",
    completePrompt: "The user just added their own product successfully. Congratulate them briefly and tell them what's next.",
    nextActionLabel: "Add product",
    afterActionHint: "Next, NOVA will generate content for your new product.",
  },
  {
    key: "catalog",
    title: "NOVA builds your catalog",
    path: "/create-store",
    demoActions: [{ type: "spotlight", target: "draft_form.generate_first" }],
    demoPrompt: "I'm about to show the user how to have NOVA generate content for their new product. Narrate it briefly.",
    explainPrompt: "Explain briefly what generating content does — NOVA writes a description and SEO copy, but price and SKU stay exactly as the owner typed them.",
    completePrompt: "NOVA just generated content for the user's product. Congratulate them briefly and tell them what's next.",
    nextActionLabel: "Generate content",
    afterActionHint: "Then you'll review and accept what NOVA wrote.",
  },
  {
    key: "review",
    title: "Review AI-generated content",
    path: "/create-store",
    demoActions: [{ type: "spotlight", target: "draft_form.accept_first" }],
    demoPrompt: "I'm about to show the user how to review and accept NOVA's generated content. Narrate it briefly.",
    explainPrompt: "Explain briefly why the owner reviews and accepts AI-generated content before it becomes a real product.",
    completePrompt: "The user just accepted their product. Congratulate them briefly and tell them what's next.",
    nextActionLabel: "Accept",
    afterActionHint: "NOVA will then build your storefront from your brand and this product.",
  },
  {
    key: "storefront",
    title: "Build your storefront",
    path: "/create-store",
    demoActions: [{ type: "spotlight", target: "storefront_gen.generate" }],
    demoPrompt: "I'm about to show the user how to have NOVA generate their storefront. Narrate it briefly.",
    explainPrompt: "Explain briefly that NOVA is about to build a homepage from their brand and accepted products, and that they can still edit everything afterward.",
    completePrompt: "NOVA just generated the user's storefront. Congratulate them briefly and tell them what's next.",
    nextActionLabel: "Generate storefront",
    afterActionHint: "Next, you can ask NOVA to improve it in plain language.",
  },
  {
    key: "nl_edit",
    title: "Ask NOVA to improve it",
    path: "/store-builder",
    demoActions: [
      { type: "spotlight", target: "nl_edit_form.instruction" },
      { type: "fill_field", target: "nl_edit_form.instruction", value: "make the hero feel more premium" },
      { type: "spotlight", target: "nl_edit_form.propose" },
    ],
    demoPrompt: "I'm about to show the user how to ask NOVA to change their storefront in plain language. Narrate it briefly.",
    explainPrompt: "Explain briefly that NOVA proposes a change plan first — nothing customers see changes until the owner reviews it and explicitly applies it to the draft themselves. Tell them to press Propose, read what NOVA plans to change, then press Apply to draft once they're happy with it.",
    completePrompt: "The user just reviewed and applied NOVA's proposed storefront change. Congratulate them briefly and tell them what's next.",
    nextActionLabel: "Propose",
    // Once the user's own Propose click produces a real plan, "Apply to draft" exists in the DOM
    // for the first time — NOVA spotlights it so the second real action is just as guided as the
    // first, even though NOVA itself never clicks either button. Proposing alone never completes
    // this step (backend/app/repositories/ai_repo.py's has_applied_change_plan) — only a
    // successful Apply does.
    secondUserTurnTarget: "nl_edit_form.apply",
    secondActionLabel: "Apply to draft",
    afterActionHint: "Once applied, you're ready to publish your store.",
  },
  {
    key: "publish",
    title: "Publish your store",
    path: "/store-builder",
    demoActions: [{ type: "spotlight", target: "publish_form.publish" }],
    demoPrompt: "I'm about to show the user how to publish their storefront live. Narrate it briefly.",
    explainPrompt: "Explain briefly that publishing is the one step that makes the draft visible to real customers.",
    completePrompt: "The user just published their store. Congratulate them briefly and tell them what's next.",
    nextActionLabel: "Publish",
    afterActionHint: "Next, let's see NOVA actually analyze and run the business.",
  },
  {
    key: "run_business",
    title: "Learn how NOVA runs your business",
    path: "/overview",
    demoActions: [{ type: "spotlight", target: "store_health.check" }],
    demoPrompt: "I'm about to show the user how NOVA checks on how their store is doing. Narrate it briefly.",
    explainPrompt: "Explain briefly that Store Manager delegates to Sales, Inventory, and Customer agents for a real read on the business, and that once results appear, 'Fix what you can' lets NOVA act on what it finds.",
    completePrompt: "The user just saw NOVA analyze their business and act on it. Congratulate them warmly — this is the end of the tour — and tell them NOVA is always available from the chat bubble for anything else.",
    nextActionLabel: "How is my store doing?",
    // run_business only completes once BOTH a Store Health run AND an Action Plan exist
    // (onboarding_service.py) — the "Fix what you can" button only renders once Store Health
    // results are showing, so it needs the same two-action spotlight handoff as nl_edit.
    secondUserTurnTarget: "store_health.fix",
    secondActionLabel: "Fix what you can",
    afterActionHint: "That's the end of the guided tour — I'll be in the corner if you need anything else.",
  },
];

export function getLessonStep(key: string): LessonStep | undefined {
  return LESSON_STEPS.find((s) => s.key === key);
}

/** The real control NOVA's own demo ends by spotlighting — always the same one the user then
 * needs to press to actually perform the step's action, so useNovaLesson's `userTurnTarget` is
 * derived from it rather than authored twice. */
export function primaryActionTarget(step: LessonStep): string | undefined {
  for (let i = step.demoActions.length - 1; i >= 0; i--) {
    if (step.demoActions[i].target) return step.demoActions[i].target;
  }
  return undefined;
}

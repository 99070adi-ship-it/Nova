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
  /** The route this step's real UI lives on — the widget navigates here first if the visitor
   * isn't already on it, so the whole ten-step tour reads as one continuous flow regardless of
   * which page a step's real action happens to live on. */
  path: string;
  demoActions: UIAction[];
  demoPrompt: string;
  explainPrompt: string;
  completePrompt: string;
}

export const LESSON_STEPS: LessonStep[] = [
  {
    key: "brand",
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
  },
  {
    key: "products",
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
  },
  {
    key: "catalog",
    path: "/create-store",
    demoActions: [{ type: "spotlight", target: "draft_form.generate_first" }],
    demoPrompt: "I'm about to show the user how to have NOVA generate content for their new product. Narrate it briefly.",
    explainPrompt: "Explain briefly what generating content does — NOVA writes a description and SEO copy, but price and SKU stay exactly as the owner typed them.",
    completePrompt: "NOVA just generated content for the user's product. Congratulate them briefly and tell them what's next.",
  },
  {
    key: "review",
    path: "/create-store",
    demoActions: [{ type: "spotlight", target: "draft_form.accept_first" }],
    demoPrompt: "I'm about to show the user how to review and accept NOVA's generated content. Narrate it briefly.",
    explainPrompt: "Explain briefly why the owner reviews and accepts AI-generated content before it becomes a real product.",
    completePrompt: "The user just accepted their product. Congratulate them briefly and tell them what's next.",
  },
  {
    key: "storefront",
    path: "/create-store",
    demoActions: [{ type: "spotlight", target: "storefront_gen.generate" }],
    demoPrompt: "I'm about to show the user how to have NOVA generate their storefront. Narrate it briefly.",
    explainPrompt: "Explain briefly that NOVA is about to build a homepage from their brand and accepted products, and that they can still edit everything afterward.",
    completePrompt: "NOVA just generated the user's storefront. Congratulate them briefly and tell them what's next.",
  },
  {
    key: "nl_edit",
    path: "/store-builder",
    demoActions: [
      { type: "spotlight", target: "nl_edit_form.instruction" },
      { type: "fill_field", target: "nl_edit_form.instruction", value: "make the hero feel more premium" },
      { type: "spotlight", target: "nl_edit_form.propose" },
    ],
    demoPrompt: "I'm about to show the user how to ask NOVA to change their storefront in plain language. Narrate it briefly.",
    explainPrompt: "Explain briefly that NOVA proposes a change plan first — nothing customers see changes until the owner reviews and applies it.",
    completePrompt: "The user just asked NOVA to improve their storefront. Congratulate them briefly and tell them what's next.",
  },
  {
    key: "publish",
    path: "/store-builder",
    demoActions: [{ type: "spotlight", target: "publish_form.publish" }],
    demoPrompt: "I'm about to show the user how to publish their storefront live. Narrate it briefly.",
    explainPrompt: "Explain briefly that publishing is the one step that makes the draft visible to real customers.",
    completePrompt: "The user just published their store. Congratulate them briefly and tell them what's next.",
  },
  {
    key: "run_business",
    path: "/overview",
    demoActions: [{ type: "spotlight", target: "store_health.check" }],
    demoPrompt: "I'm about to show the user how NOVA checks on how their store is doing. Narrate it briefly.",
    explainPrompt: "Explain briefly that Store Manager delegates to Sales, Inventory, and Customer agents for a real read on the business, and that once results appear, 'Fix what you can' lets NOVA act on what it finds.",
    completePrompt: "The user just saw NOVA analyze their business and act on it. Congratulate them warmly — this is the end of the tour — and tell them NOVA is always available from the chat bubble for anything else.",
  },
];

export function getLessonStep(key: string): LessonStep | undefined {
  return LESSON_STEPS.find((s) => s.key === key);
}

"""The deterministic stand-in for the persistent assistant (the default, no-API-key configuration).

It answers from the ROUTED INTENT (app/ai/intent.py), exactly as a real model is told to: small talk is
answered directly with no tools; product help comes from the help articles; business questions call the one
relevant read-only tool and report what it returned; action requests propose (never execute); problems get
a serious, practical reply. Page context and onboarding state are never topics. It is a double that proves
the routing, not a language model: wording rotates by turn so it doesn't repeat itself."""

from app.ai.intent import Intent, Routed, classify
from app.ai.product_help import _CAPABILITIES, find_article
from app.ai.provider import AssistantMessage, ProviderFinal, ProviderStepResult, ToolCallRequest, ToolResultMessage

_GREETING = ["Hey! 😎 What's up?", "Hey, good to see you. What are we working on?", "Hi there. Ask me anything, or just say hello. Both are fine."]
_HOW_ARE_YOU = [
    "Doing great. Systems humming, no coffee breaks required. How about you?",
    "All good on my end. Numbers behaving, servers calm. How are you doing?",
    "Running smoothly, thanks for asking. Not many people do. How's your day going?",
]
_THANKS = ["Anytime! That's what I'm here for.", "Happy to help. That's what co-founders are for.", "You got it."]
_JOKES = [
    "I'd tell you a joke about inventory, but it's out of stock.",
    "What did the abandoned cart say to the customer? I thought we had something special.",
    "Why was the discount code so calm? It had no expiration anxiety.",
    "My favorite sales strategy? Sell things people actually want. Radical, I know.",
]
_BYE = ["Catch you later. I'll be here when you need me.", "See you soon. Go sell something."]
_ACK = ["Glad that works.", "Nice. Anything else?", "Good. I'm here if you need me."]
_IDENTITY = (
    "I'm NOVA, your AI co-founder for this store, created by Aditya. My AI is accessed through NVIDIA's API. "
    "I can explain how things work, look up your real numbers, and plan changes for you to approve."
)
_HOW_COMPUTED = {
    "low_stock": "I compare each variant's on-hand count with its low-stock threshold, straight from your live inventory. At or below the threshold counts as low.",
    "sales": "Those come from your real orders over the last thirty days: revenue and order counts, with top sellers ranked by units sold.",
    "customers": "I look at each customer's most recent order. No order in the last thirty days counts as inactive.",
    "store_summary": "They're live counts of the products, customers and orders in your store, plus how many stock lines are at or below their low-stock mark.",
    "brand": "That's the brand profile you saved in Create My Store.",
}
_TOOL_FOR_TOPIC = {
    "low_stock": "get_low_stock_products", "sales": "get_sales_metrics", "customers": "get_customer_activity",
    "brand": "get_brand_profile", "store_summary": "get_store_summary",
}


def _pick(options: list[str], turn: int) -> str:
    return options[turn % len(options)]


def _n(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def _final(text: str) -> ProviderStepResult:
    return ProviderStepResult(final=ProviderFinal(text=text))


def _routed(context: dict, message: str, previous: list[str]) -> Routed:
    if "intent" in context:
        return Routed(Intent(context["intent"]), context.get("topic"), bool(context.get("follow_up")))
    return classify(message, previous)  # used directly (tests, tools) without the service's routing


def assistant_step(
    *, context: dict, messages: list[str], tool_results: list[ToolResultMessage], available_tools: list[dict],
) -> ProviderStepResult:
    user_turns = [m for m in messages if not isinstance(m, AssistantMessage)]
    message = user_turns[-1] if user_turns else ""
    turn = len(user_turns)
    routed = _routed(context, message, user_turns[:-1])
    tools = {t["name"] for t in available_tools}

    if routed.intent is Intent.small_talk:
        return _final(_small_talk(routed, turn))
    if routed.intent is Intent.troubleshooting:
        return _final(_troubleshooting(context))
    if routed.intent is Intent.product_help:
        return _final(_product_help(message, user_turns[:-1], routed))
    if routed.intent is Intent.business_query:
        return _business(routed, tool_results, tools, turn)
    if routed.intent is Intent.action_request:
        return _action(routed, tool_results, tools)
    return _final(
        "I want to get this right. Are you asking how something works, about your store's numbers, "
        "or do you want me to change something?"
    )


def _small_talk(routed: Routed, turn: int) -> str:
    if routed.follow_up:
        return "Sure. Which part should I go into?"
    return {
        "greeting": _pick(_GREETING, turn),
        "how_are_you": _pick(_HOW_ARE_YOU, turn),
        "thanks": _pick(_THANKS, turn),
        "joke": _pick(_JOKES, turn),
        "bye": _pick(_BYE, turn),
        "ack": _pick(_ACK, turn),
        "identity": _IDENTITY,
    }.get(routed.topic or "", _pick(_GREETING, turn))


def _troubleshooting(context: dict) -> str:
    where = f" If it's about the {context['screen']} screen, say so." if context.get("screen") else ""
    return (
        "That sounds frustrating, let's sort it out. What were you doing when it happened, and what exactly did you see on screen? "
        f"Meanwhile, Activity shows recent actions and Approvals shows anything waiting on you.{where}"
    )


def _product_help(message: str, earlier: list[str], routed: Routed) -> str:
    if routed.follow_up:
        # Re-explain the article behind the previous real question, in more detail.
        for prior in reversed(earlier):
            article = find_article(prior)
            if article is not None:
                return article.detail
        return _CAPABILITIES.detail
    article = find_article(message)
    return (article or _CAPABILITIES).short


def _business(routed: Routed, tool_results: list[ToolResultMessage], tools: set[str], turn: int) -> ProviderStepResult:
    topic = routed.topic or "store_summary"
    if routed.follow_up:
        return _final(_HOW_COMPUTED.get(topic, _HOW_COMPUTED["store_summary"]))
    tool = _TOOL_FOR_TOPIC.get(topic, "get_store_summary")
    if tool not in tools:
        return _final("I can't look that up from here yet. Try the Analytics or Inventory screen for the numbers.")
    result = next((r for r in tool_results if r.name == tool), None)
    if result is None:
        return ProviderStepResult(tool_calls=[ToolCallRequest(id="call_1", name=tool, arguments={})])
    return _final(_business_reply(topic, result.content))


def _business_reply(topic: str, c: dict) -> str:
    if topic == "low_stock":
        items = c.get("low_stock_products") or []
        if not items:
            return "Nothing is at or below its low-stock mark right now. Your shelves are in good shape."
        shown = ", ".join(f"{i['title']} ({i['on_hand']} left)" for i in items[:3])
        more = f", and {len(items) - 3} more" if len(items) > 3 else ""
        return f"{_n(len(items), 'product')} {'is' if len(items) == 1 else 'are'} at or below the low-stock mark: {shown}{more}. Worth a restock look."
    if topic == "sales":
        days, orders, revenue = c.get("days", 30), c.get("orders", 0), c.get("revenue", 0)
        if not orders:
            return f"No orders in the last {days} days yet, so there's nothing to rank."
        top = (c.get("top_products") or [{}])[0]
        best = f" Top seller: {top['title']} ({top['units']} units)." if top.get("title") else ""
        return f"Over the last {days} days: {_n(orders, 'order')} and {revenue:,.2f} in revenue.{best}"
    if topic == "customers":
        rows = c.get("customers") or []
        inactive = sum(1 for r in rows if r.get("inactive"))
        if not rows:
            return "No customers yet. Once orders start, I can tell you who's gone quiet."
        return f"You have {_n(len(rows), 'customer')}, and {inactive} of them haven't ordered recently."
    if topic == "brand":
        if c.get("error"):
            return "I don't have a brand profile for you yet. Create My Store is where we fix that, and it's quick."
        sells = f", which sells {c['sells_what']}" if c.get("sells_what") else ""
        return f"Your brand is {c.get('name') or 'unnamed so far'}{sells}."
    products, customers, orders = c.get("products", 0), c.get("customers", 0), c.get("orders", 0)
    low = c.get("low_stock_variants", 0)
    text = f"Here's the lay of the land: {_n(products, 'product')}, {_n(customers, 'customer')} and {_n(orders, 'order')}."
    if low:
        text += f" {_n(low, 'stock line')} {'is' if low == 1 else 'are'} at or below the low-stock mark."
    return text


def _action(routed: Routed, tool_results: list[ToolResultMessage], tools: set[str]) -> ProviderStepResult:
    if routed.topic == "publish" and "publish_storefront" in tools:
        result = next((r for r in tool_results if r.name == "publish_storefront"), None)
        if result is None:
            return ProviderStepResult(tool_calls=[ToolCallRequest(id="call_1", name="publish_storefront", arguments={})])
        if result.content.get("status") == "proposed":
            return _final("I've proposed publishing your storefront. It's waiting in Approvals, and nothing goes live until you approve it.")
        return _final("I couldn't put that proposal together. Try publishing from Store Builder instead.")
    if routed.topic == "product_content":
        return _final(
            "I can propose product copy updates, and you approve them. Tell me which product and what you'd like the description or title to say."
        )
    return _final("Happy to. Tell me a bit more: what should I change, and where? Anything that changes your store comes to you as a plan or proposal first.")

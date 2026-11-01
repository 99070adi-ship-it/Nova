"""What NOVA can tell a merchant about using the product. Short, accurate help articles that match the
screens and flows that are actually built (the Marketing and Settings screens are not). The assistant
treats these as EVIDENCE for answering, never as instructions: they are supplied as context.help_articles
to a real model, and used directly by the deterministic fake provider."""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class HelpArticle:
    id: str
    title: str
    pattern: re.Pattern
    short: str  # the answer
    detail: str  # a slower, more detailed version for "can you explain that?"


def _p(expr: str) -> re.Pattern:
    return re.compile(expr)


ARTICLES: list[HelpArticle] = [
    HelpArticle(
        "edit_homepage", "Editing your homepage",
        _p(r"\b(edit|change|update|customi[sz]e|redesign|improve|tweak)\b.*\b(homepage|home page|storefront|hero|theme|site|website|store)\b|\b(homepage|home page|storefront|hero)\b.*\b(edit|change|update)\b|store builder"),
        "Open Store Builder, type what you want changed in plain language, for example make the hero feel more premium, and press Propose. "
        "You'll see my plan first. If you like it, press Apply to draft. Nothing goes live until you publish.",
        "Store Builder works in two safe steps. Propose shows a plan of exactly what I'd change, and changes nothing. "
        "Apply to draft makes those edits on the draft only. Customers keep seeing the live store until you press Publish, "
        "so you can experiment without worrying.",
    ),
    HelpArticle(
        "publish", "Publishing",
        _p(r"\bpublish|go live|goes live|live site|unpublish|draft vs"),
        "Your storefront has a draft and a live version. Publish in Store Builder replaces the live site with the draft. "
        "Until then, customers only see whatever was live before.",
        "Edits, including the ones I propose, always land on the draft first. Preview opens the draft in a new tab so you can inspect it. "
        "Publishing is the one step that changes what customers see, and it's yours to press.",
    ),
    HelpArticle(
        "approvals", "Approvals",
        _p(r"\bapprov|propos(al|ed)|permission|sign off|who decides"),
        "Anything risky I propose, like publishing or a campaign draft, waits in Approvals until you approve or reject it. "
        "Small, low-risk content edits can go through on their own. You can always see what happened in Activity.",
        "I never change the store on my own authority. Risky actions become proposals, and each one shows up in Approvals with what it would do. "
        "Approve and it runs, reject and it doesn't. Every action, approved or not, is recorded in Activity.",
    ),
    HelpArticle(
        "add_products", "Adding products",
        _p(r"\b(add|create|upload|import|new)\b.*\bproducts?\b|\bproducts?\b.*\b(add|create)\b|\bgenerate (product )?(content|description)"),
        "Add products in Create My Store, or see them all on the Products page. Enter the title, price, SKU and category yourself, "
        "then I can write the description and SEO text. You review and accept it before it becomes a real product.",
        "Facts only you know, like price and SKU, are never guessed. Once a product exists I can generate the description, category, tags and SEO copy from your brand. "
        "It stays a draft until you accept it.",
    ),
    HelpArticle(
        "store_health", "Store health checkup",
        _p(r"store health|health check|checkup|check.?up|how is my store|fix what you can|run my business|what needs (fixing|attention)"),
        "On Overview, press How is my store doing? and I check sales, inventory and customers. Then Fix what you can lets me handle the small stuff, "
        "while anything risky waits for your approval.",
        "The checkup asks specialist agents to read your real sales, stock and customer data. Fix what you can turns the findings into an action plan: "
        "low-risk items run, high-risk ones become proposals in Approvals.",
    ),
    HelpArticle(
        "inventory", "Inventory",
        _p(r"\b(inventory|stock|restock|on hand|low stock)\b"),
        "The Inventory page shows stock for every variant and lets you adjust it. Anything at or below its low-stock threshold counts as low, "
        "and I can list those for you if you ask.",
        "Each variant has an on-hand count and a low-stock threshold. When on-hand drops to the threshold it's flagged. Adjusting a count records a reason, so there's a trail.",
    ),
    HelpArticle(
        "analytics", "Analytics",
        _p(r"\b(analytics|reports?|sales (data|numbers)|revenue|metrics|dashboard)\b"),
        "Analytics shows revenue, orders and top sellers over a time window, plus low-stock products and customer activity. "
        "Ask me a specific question and I'll pull the numbers.",
        "It's built from your real orders and inventory. Revenue and orders cover the last thirty days by default, and customers with no recent order show as inactive.",
    ),
    HelpArticle(
        "collections", "Collections",
        _p(r"\bcollections?\b"),
        "Collections group related products under a theme so shoppers can browse them together. You create one in Create My Store and add products to it.",
        "Think of a collection as a shelf with a point of view. A product can sit in a collection without changing anything else about it.",
    ),
    HelpArticle(
        "orders_customers", "Orders and customers",
        _p(r"\b(orders?|customers?)\b"),
        "The Orders and Customers pages list everything for your store. For questions about numbers, like how many or which customers have gone quiet, just ask me.",
        "Both pages show real records. I can summarize them, or flag customers with no recent order, when you ask.",
    ),
    HelpArticle(
        "not_built", "Marketing and Settings",
        _p(r"\b(marketing|settings|campaigns?|email)\b"),
        "The Marketing and Settings screens aren't built yet. I can draft a campaign idea for you, but nothing gets sent and it needs your approval.",
        "Campaign drafting exists as a proposal, so it lands in Approvals. Sending isn't built, so nothing leaves the building.",
    ),
    HelpArticle(
        "capabilities", "What NOVA can do",
        _p(r"\b(help|do|capable|features?|abilities)\b"),
        "I can answer questions about how NOVA works, look up your real numbers like stock, sales and customers, and plan storefront changes for you to review. "
        "I can also propose product copy updates or publishing, which always wait for your approval. And yes, I do small talk.",
        "In short: ask me how something works, ask for numbers from your store, or tell me what to change. Reading data is instant. "
        "Changes become plans or proposals you approve, so you stay in charge.",
    ),
]

_CAPABILITIES = ARTICLES[-1]


def find_article(text: str, *, capabilities_question: bool = False) -> HelpArticle | None:
    """The best article for a message, or None. Capability questions ("what can you do") get the overview."""
    t = text.lower()
    if capabilities_question or re.search(r"\bwhat (can|could|do) you (help|do)|what are you able|what can nova|what do you do\b", t):
        return _CAPABILITIES
    for article in ARTICLES[:-1]:
        if article.pattern.search(t):
            return article
    return None


def articles_as_context(article: HelpArticle | None) -> list[dict]:
    """Evidence for a real model: data, not instructions."""
    return [] if article is None else [{"title": article.title, "text": article.short}]

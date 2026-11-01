"""Conversational intent routing for the persistent assistant.

Every assistant message is classified BEFORE any tool, agent or knowledge lookup, so "How are you?" gets a
conversational answer instead of whichever tool happens to come first. The router is deliberately
rule-based: it is free (no model call per message), deterministic, auditable and easy to extend. The
result is passed to the model/provider as a hint (context.intent) and decides which tools the turn may use.

Intents: small_talk, product_help, business_query, action_request, troubleshooting, ambiguous.
A short follow-up ("can you explain that?") inherits the intent and topic of the previous real question.

Order matters and is part of the contract (tests pin it): follow-up, small talk, troubleshooting,
how-to, business data, action, general product questions, else ambiguous.
"""

import re
from dataclasses import dataclass
from enum import Enum


class Intent(str, Enum):
    small_talk = "small_talk"
    product_help = "product_help"
    business_query = "business_query"
    action_request = "action_request"
    troubleshooting = "troubleshooting"
    ambiguous = "ambiguous"


@dataclass(frozen=True)
class Routed:
    intent: Intent
    topic: str | None = None
    follow_up: bool = False


def _norm(text: str) -> str:
    t = re.sub(r"[^a-z0-9' ]+", " ", text.lower().replace("’", "'"))
    return re.sub(r"\s+", " ", t).strip()


_NAME = r"(?: nova| there| friend| buddy| team| everyone)?"

_SMALL_TALK: list[tuple[str, re.Pattern]] = [
    ("how_are_you", re.compile(
        rf"^(?:(?:hey|hi|hello|yo)(?: nova)? )?(?:how are you|how are you doing|how are you today|how r you|how's it going|how is it going|how are things|how's life|how have you been|how do you do|you good|you ok|you okay|what's up|whats up|what is up|sup|wassup){_NAME}(?: today| lately| these days| right now)?(?: by the way)?$")),
    ("greeting", re.compile(rf"^(?:hey|hi|hello|hiya|howdy|yo|greetings|good morning|good afternoon|good evening|morning|afternoon|evening|hey hey|hi hi){_NAME}$")),
    ("thanks", re.compile(rf"^(?:(?:ok |okay |great |awesome |cool )?(?:thanks|thank you|thx|ty|cheers|much appreciated|appreciate it|thanks a lot|thank you so much|thanks so much)){_NAME}(?: that helps| that was helpful| for the help)?$")),
    ("joke", re.compile(r"^(?:(?:please |can you |could you |will you )?(?:tell me |tell us |say |got |have you got |do you have )?(?:a |another |one more |any )?(?:joke|jokes|funny|pun)(?: please| about .{1,30})?|make me laugh|say something funny|tell me something funny|cheer me up|another one)$")),
    ("bye", re.compile(rf"^(?:bye|goodbye|good bye|see you|see ya|later|talk later|good night|goodnight|cya|catch you later|i'm off|gotta go){_NAME}(?: soon| later| tomorrow)?$")),
    ("ack", re.compile(r"^(?:ok|okay|k|cool|nice|great|awesome|sweet|neat|lol|haha|hehe|got it|i see|right|alright|sounds good|perfect|wow|nice one|fair enough|makes sense|good one|love it|amazing)$")),
    ("identity", re.compile(r"^(?:who are you|what are you|what's your name|what is your name|are you real|are you a robot|are you an ai|are you human|are you a bot|who made you|who built you|who is nova|what is nova|what's nova)$")),
]

_FOLLOW_UP = re.compile(
    r"^(?:can you |could you |would you |please )?(?:explain|elaborate|clarify|expand|go on|continue|repeat)(?: on)?(?: that| this| it| more| again| further| a bit more| please)*$"
    r"|^(?:what do you mean|what does that mean|what did you mean|how so|why is that|why so|why|really|and|and\?|tell me more|more details?|more info|say more|i don't get it|i don't understand|can you say that again|can you rephrase that|in more detail|what do you mean by that)$"
)

_TROUBLE = re.compile(
    r"\b(error|errors|broken|bug|crash|crashed|crashing|not working|(?:isn't|isnt|aren't|arent|wasn't|weren't|don't|dont|doesn't|doesnt|didn't|didnt) (?:working|work|showing|show|loading|load|appearing|appear|updating|update|saving|save|syncing|sync|displaying|display)|won't|wont|can't|cant|cannot|couldn't|failed|failing|fails|stuck|wrong|problem with|issue with|having trouble|trouble with|something went wrong|doesn't show|not showing|missing|disappeared|won't load|not loading|blank page|500|404|timeout|timed out)\b"
)

_HOW_TO = re.compile(
    r"^(?:(?:hey |hi |nova |ok |okay |so |and )*)(?:how (?:do|can|should|would|could) (?:i|we|you)|how to|how does|where (?:do|can|should|would) i|where is|where's|show me how|walk me through|teach me|guide me|what's the (?:best )?way to|what is the (?:best )?way to|is there a way to|can i|could i|am i able to)\b"
)

_BUSINESS_Q = re.compile(
    r"\b(how many|how much|number of|count of|total|top selling|top sellers?|best sellers?|bestsellers?|worst|which (?:products?|customers?|orders?|items?)|what(?:'s| is| are) my|what were my|show me my|show my|list my|do i have|have i got|are any|is any|any of my|low on stock|low stock|out of stock|running low|running out|revenue|sales|orders?|customers?|churn|abandoned carts?|stock levels?|inventory levels?|how is my store|how's my store|how are my|store health|my numbers|my products|my customers|my orders|my inventory|my brand|my store name|what is my brand|what's my brand)\b"
)

_ACTION = re.compile(
    r"^(?:(?:hey |ok |okay |so |nova |please |go ahead and |let's |lets )*)(?:(?:can|could|would|will) you |i want to |i'd like to |i would like to |i need you to |i need to )?(?:please )?(make|change|update|edit|rewrite|redesign|publish|unpublish|add|create|set|write|generate|improve|fix|remove|delete|rename|apply|propose|draft|build|turn|switch|put|move|redo|refresh|tweak|adjust|swap|replace)\b"
)

_PRODUCT_Q = re.compile(
    r"^(?:what(?:'s| is| are| does| do| can| could)|which|who|tell me about|explain|describe|do you|does nova|can nova|is nova|are you able|what can you|what do you|help me understand)\b"
)

_STOREFRONT_WORDS = re.compile(r"\b(homepage|home page|storefront|hero|banner|theme|section|landing|website|site|page|layout|font|colou?rs?|header|footer|premium|luxur\w+|style|look|vibe)\b")
_PRODUCT_WORDS = re.compile(r"\b(product|products|description|descriptions|title|titles|copy|seo|category|tags?)\b")


def business_topic(text: str) -> str:
    if re.search(r"\b(low on stock|low stock|out of stock|running low|running out|stock levels?|inventory)\b", text):
        return "low_stock"
    if re.search(r"\b(revenue|sales|top selling|top sellers?|best sellers?|bestsellers?|worst|orders? this|how much)\b", text):
        return "sales"
    if re.search(r"\b(customers?|churn|inactive|repeat)\b", text):
        return "customers"
    if re.search(r"\b(brand|store name|business name)\b", text):
        return "brand"
    return "store_summary"


def action_topic(text: str) -> str:
    if re.search(r"\bpublish|go live\b", text):
        return "publish"
    if _STOREFRONT_WORDS.search(text) and not _PRODUCT_WORDS.search(text):
        return "storefront_change"
    if _PRODUCT_WORDS.search(text):
        return "product_content"
    if _STOREFRONT_WORDS.search(text):
        return "storefront_change"
    return "other"


def small_talk_topic(text: str) -> str | None:
    for topic, pattern in _SMALL_TALK:
        if pattern.match(text):
            return topic
    return None


def classify(message: str, previous_user_messages: tuple[str, ...] | list[str] = ()) -> Routed:
    """Classify one message. `previous_user_messages` are the earlier user turns, oldest first."""
    text = _norm(message)
    if not text:
        return Routed(Intent.ambiguous)

    # 1. A short follow-up inherits what the previous real question was about.
    if _FOLLOW_UP.match(text):
        for earlier in reversed(list(previous_user_messages)):
            prior = classify(earlier, ())
            if prior.intent is not Intent.small_talk and not prior.follow_up:
                return Routed(prior.intent, prior.topic, follow_up=True)
        return Routed(Intent.small_talk, "ack", follow_up=True) if previous_user_messages else Routed(Intent.ambiguous)

    # 2. Obvious small talk (whole-message patterns, so "how are you ... my sales" never matches).
    topic = small_talk_topic(text)
    if topic is not None:
        return Routed(Intent.small_talk, topic)

    # 3. A problem the user needs fixed.
    if _TROUBLE.search(text) and not _HOW_TO.match(text):
        return Routed(Intent.troubleshooting, None)

    # 4. How-to questions are product help, even when they mention business nouns ("how do I see my sales").
    if _HOW_TO.match(text):
        return Routed(Intent.product_help, None)

    # 5. Questions that need the store's real data.
    if _BUSINESS_Q.search(text) and not _ACTION.match(text):
        return Routed(Intent.business_query, business_topic(text))

    # 6. A request to do something.
    if _ACTION.match(text) and len(text.split()) >= 3:
        return Routed(Intent.action_request, action_topic(text))

    # 7. General questions about NOVA and what it can do.
    if _PRODUCT_Q.match(text) or "nova" in text.split() and "?" in message:
        return Routed(Intent.product_help, None)

    return Routed(Intent.ambiguous)

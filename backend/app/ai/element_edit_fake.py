"""Deterministic stand-in for the Storefront Editor model (the default, no-API-key configuration).

It reads the SAME context a real model gets (the selected element, its properties with current values, brand, theme and
catalog) and answers in the same JSON shape, using plain rules: quoted text, tone words (premium, shorter, warmer, bolder),
color names, enum keywords, numbers and catalog names. It is a double that proves the pipeline end to end, not a language
model: wording is rule-based, and anything it can't map becomes an explicit "unsupported" with the closest supported idea.
Its output is validated exactly like a real model's, so nothing here is trusted either."""

import colorsys
import json
import re

_QUOTED = re.compile(r"""["“'‘]([^"”'’]{1,200})["”'’]""")

_PREMIUM = {
    "everyday": "considered", "great": "exceptional", "best": "finest", "amazing": "remarkable", "awesome": "exceptional",
    "new": "newly considered", "cool": "refined", "nice": "refined", "shop": "discover", "buy": "choose", "cheap": "accessible",
    "stuff": "pieces", "things": "pieces", "good": "fine", "really": "", "very": "", "just": "", "super": "", "reimagined": "exceptional by design",
}
_WARM = {"discover": "come and explore", "shop": "come and browse", "buy": "take home", "best": "favorite", "products": "things we love"}
_NAMED_COLORS = {
    "cream": "#F3EEE6", "ivory": "#F8F4EA", "warm white": "#FAF6EE", "white": "#FFFFFF", "sand": "#E4D8C3", "beige": "#E8DFD0",
    "blush": "#F2DDD6", "sage": "#9CAF88", "olive": "#6B6B47", "forest": "#2F4A3A", "green": "#2F6B4A", "navy": "#1F2A44",
    "blue": "#2B5C9E", "charcoal": "#2B2B2E", "black": "#111111", "espresso": "#2A1D15", "brown": "#5A3A24", "cognac": "#A5622F",
    "terracotta": "#B8603E", "burgundy": "#6E2230", "red": "#B3261E", "gold": "#B69A64", "grey": "#8A8A8A", "gray": "#8A8A8A", "orange": "#D9622B",
}
_FONTS = [
    (("classic", "serif", "editorial", "elegant", "traditional", "cormorant"), "Cormorant Garamond"),
    (("playfair", "dramatic", "magazine", "high contrast"), "Playfair Display"),
    (("modern", "clean", "minimal", "sans", "inter", "neutral"), "Inter"),
    (("friendly", "approachable", "soft", "dm sans", "rounded type"), "DM Sans"),
    (("system", "default font", "plain"), "System"),
]


def _first_clause(text: str, words: int = 6) -> str:
    clause = re.split(r"[,;:—\-]|\. ", text)[0].strip().rstrip(".!?")
    return " ".join(clause.split()[:words])


def _swap(text: str, table: dict[str, str]) -> str:
    def repl(m: re.Match) -> str:
        word = m.group(0)
        new = table.get(word.lower(), word)
        return new.capitalize() if word[0].isupper() and new else new

    out = re.sub(r"[A-Za-z]+", repl, text)
    return re.sub(r"\s{2,}", " ", out).strip()


def _sentence(text: str) -> str:
    text = text.strip().rstrip("!")
    return text if text.endswith((".", "?")) else text + "."


def _rewrite(current: str, instruction: str, kind: str, max_length: int | None, brand: dict) -> tuple[str | None, str]:
    text = instruction.lower()
    quoted = _QUOTED.search(instruction)
    if quoted and not re.search(r"(?:call|say|label|title).{0,12}(?:it|the)", text) or (quoted and kind in ("text", "textarea")):
        return quoted.group(1).strip(), "Used the exact wording you gave."
    base = current or brand.get("name") or ""
    if re.search(r"premium|editorial|luxur|elevat|refined|upscale|sophisticat|high[- ]end|quiet", text):
        out = _swap(re.sub(r"^(your|our|the)\s+", "", base.strip(), flags=re.IGNORECASE), _PREMIUM).rstrip("!. ")
        out = re.sub(r",\s*", ". ", out)
        sentences = [x.strip() for x in re.split(r"(?<=[.!?])\s+", out) if x.strip()]
        out = " ".join(_sentence(x[:1].upper() + x[1:]) for x in sentences)
        if kind == "text" and len(sentences) < 2 and brand and len(out) < 40:
            out = out + " Made to last."
        if max_length and len(out) > max_length:
            out = _sentence(_first_clause(out, 8))
        return out, "A more editorial, restrained voice: shorter phrases and quieter vocabulary."
    if re.search(r"warm|friendl|welcom|casual|approachable|inviting|human|cozy", text):
        out = _swap(base, _WARM)
        if out == base and kind == "text" and len("Welcome in. " + base) <= (max_length or 90):
            out = "Welcome in. " + base
        return _sentence(out[:1].upper() + out[1:]), "A friendlier, more welcoming tone."
    if re.search(r"bold|punch|strong|confident|direct|urgent", text):
        out = _first_clause(base, 5).title() if kind == "text" else base
        return _sentence(out), "A more direct, confident line."
    if re.search(r"shorter|concise|brief|trim|tighter|snappier|less wordy|short", text):
        if kind == "textarea":
            first = re.split(r"(?<=[.!?]) ", base.strip())[0]
            return _sentence(first), "Kept the strongest sentence and dropped the rest."
        return _sentence(_first_clause(base)), "Cut it down to its core idea."
    return None, ""


def _hex_adjust(hex_color: str, lightness: float = 1.0, warm: float = 0.0) -> str:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    ll = min(0.97, max(0.04, ll * lightness))
    if warm:
        hh = hh + (0.08 - hh) * warm if hh > 0.08 else hh
        ss = min(1.0, ss + 0.1 * warm)
    r, g, b = colorsys.hls_to_rgb(hh % 1.0, ll, ss)
    return "#%02X%02X%02X" % (round(r * 255), round(g * 255), round(b * 255))


def _color_change(prop: dict, instruction: str, current: str | None) -> str | None:
    text = instruction.lower()
    is_bg = "background" in text or "backdrop" in text or "canvas" in text
    is_primary = bool(re.search(r"text|ink|primary|button|accent|heading|foreground", text))
    if prop["path"] == "background_color" and is_primary and not is_bg:
        return None
    if prop["path"] == "primary_color" and is_bg and not is_primary:
        return None
    if not is_bg and not is_primary and prop["path"] == "primary_color":
        return None  # a color request without a target defaults to the background only
    m = re.search(r"#[0-9a-fA-F]{6}\b", instruction)
    if m:
        return m.group(0)
    for name in sorted(_NAMED_COLORS, key=len, reverse=True):
        if re.search(rf"\b{name}\b", text):
            return _NAMED_COLORS[name]
    if current and re.search(r"dark(er)?", text):
        return _hex_adjust(current, 0.7)
    if current and re.search(r"light(er)?|brighter|softer", text):
        return _hex_adjust(current, 1.25)
    if current and re.search(r"warm(er)?", text):
        return _hex_adjust(current, 1.0, warm=0.8)
    return None


def _enum_choice(prop: dict, instruction: str) -> str | None:
    t = instruction.lower()
    path, opts = prop["path"], prop["options"]
    if path == "align":
        return "left" if re.search(r"\bleft\b|left-align", t) else "center" if re.search(r"cent(er|re)", t) else None
    if path == "spacing":
        if re.search(r"spacious|airy|breath|more (space|room|padding)|roomier|generous", t):
            return "spacious"
        if re.search(r"compact|tight|less (space|padding)|denser|snug", t):
            return "compact"
        if re.search(r"regular|standard|normal", t):
            return "regular"
        return None
    if path == "background":
        if re.search(r"dark|inverse|black|ink|contrast|bold background", t):
            return "inverse"
        if re.search(r"tint|subtle|light(er)?|soft|surface|off-white|gentle", t):
            return "surface"
        if re.search(r"plain|default|no background|clear|reset", t):
            return "default"
        return None
    if path == "border_radius":
        if re.search(r"pill|fully round|very round", t):
            return "999px"
        if re.search(r"sharp|square|no (round|radius)|crisp", t):
            return "0px"
        if re.search(r"round(er)?|soft(er)?|curv", t):
            return "12px"
        if re.search(r"subtle|slight", t):
            return "4px"
        return None
    if path == "button_style":
        return "outline" if re.search(r"outline|ghost|hollow|line button", t) else "filled" if re.search(r"fill|solid", t) else None
    if path == "font_family":
        for words, name in _FONTS:
            if any(w in t for w in words):
                return name if name in opts else None
        return None
    return None


def synthesize(context: dict) -> dict:
    instruction = context.get("instruction", "")
    text = instruction.lower()
    brand = context.get("brand") or {}
    props = {p["path"]: p for p in context.get("properties", [])}
    changes: list[dict] = []
    reasons: list[str] = []

    for path, p in props.items():
        kind, current = p["kind"], p.get("current")
        if kind in ("text", "textarea"):
            new, why = _rewrite(current or "", instruction, kind, p.get("max_length"), brand)
            if new is not None:
                changes.append({"path": path, "value": new})
                reasons.append(why)
        elif kind == "link":
            want = None
            if re.search(r"all products|shop all|everything|the shop|products page", text):
                want = "/products"
            for col in (context.get("catalog") or {}).get("collections", []):
                if col["title"].lower() in text:
                    want = f"/collections/{col['slug']}"
            if want:
                changes.append({"path": path, "value": want})
                reasons.append("Pointed the button at a page that exists in your store.")
        elif kind == "color":
            c = _color_change(p, instruction, current)
            if c:
                changes.append({"path": path, "value": c})
                reasons.append("Adjusted the color within your palette.")
        elif kind == "enum":
            choice = _enum_choice(p, instruction)
            if choice is not None:
                changes.append({"path": path, "value": choice})
                reasons.append(f"Set {p['label'].lower()} to {choice}.")
        elif kind == "int":
            m = re.search(r"\b(\d{1,2})\b", text)
            if m:
                changes.append({"path": path, "value": int(m.group(1))})
                reasons.append(f"Showing {m.group(1)}.")
        elif kind == "collection_id":
            cols = (context.get("catalog") or {}).get("collections", [])
            hit = next((c for c in cols if c["title"].lower() in text), None)
            if hit:
                changes.append({"path": path, "value": hit["id"]})
                reasons.append(f"Featured the {hit['title']} collection.")
            elif re.search(r"all (products|collections)|everything|no collection", text):
                changes.append({"path": path, "value": None})
                reasons.append("Showing products from every collection.")
        elif kind == "image_url":
            images = (context.get("catalog") or {}).get("images", [])
            hit = next((i for i in images if i.get("product") and i["product"].lower() in text), None)
            if hit:
                changes.append({"path": path, "value": hit["url"]})
                reasons.append(f"Used the existing {hit['product']} photo from your catalog.")
            elif re.search(r"remove|no image|without (an )?image|hide the image", text):
                changes.append({"path": path, "value": None})
                reasons.append("Removed the image.")

    if not changes:
        labels = ", ".join(p["label"].lower() for p in props.values())
        return {
            "summary": "", "reasoning": "", "changes": [], "warnings": [],
            "unsupported": f"I couldn't tell how to change the {context['element']['label'].lower()} from that.",
            "alternative": f"Try asking to change its {labels}" + (", or give the exact wording in quotes." if any(p["kind"] in ("text", "textarea") for p in props.values()) else "."),
        }
    return {
        "summary": f"Update the {context['element']['label'].lower()}",
        "reasoning": " ".join(dict.fromkeys(r for r in reasons if r)),
        "changes": changes, "warnings": [], "unsupported": None, "alternative": None,
    }


def synthesize_json(context: dict) -> str:
    return json.dumps(synthesize(context))

"""The explicit registry of what Store Builder's click-to-edit may touch.

Every selectable element in the preview maps to real fields of a section's `configuration` (or to the draft's
theme tokens) that the one storefront renderer actually reads. Nothing outside this registry is editable, and every
editable property has a type and a validator, so a natural-language request, however it is phrased and whatever the
model returns, can only ever produce a value that is valid for that exact field. No HTML, script, URL scheme or CSS
can pass through: text is plain text, colors are hex, fonts and radii are from approved lists, links are internal
paths or https URLs, and collections and images must already exist in the store's own catalog.

The same data is served to the admin (GET /storefront/editable-elements) and exported to
contracts/editable-elements.json, which the storefront's tests check against what it really renders, so the three
cannot drift apart."""

import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

PropKind = Literal["text", "textarea", "link", "enum", "int", "color", "collection_id", "image_url"]

FONT_OPTIONS: dict[str, str] = {
    "System": "system-ui, sans-serif",
    "Cormorant Garamond": "'Cormorant Garamond', Georgia, serif",
    "Playfair Display": "'Playfair Display', Georgia, serif",
    "Inter": "'Inter', system-ui, sans-serif",
    "DM Sans": "'DM Sans', system-ui, sans-serif",
}
RADIUS_OPTIONS = ("0px", "2px", "4px", "8px", "12px", "999px")
BUTTON_STYLES = ("filled", "outline")
BACKGROUNDS = ("default", "surface", "inverse")
SPACINGS = ("compact", "regular", "spacious")
ALIGNS = ("left", "center")


@dataclass(frozen=True)
class PropertyDef:
    path: str
    label: str
    kind: PropKind
    max_length: int | None = None
    options: tuple[str, ...] | None = None
    minimum: int | None = None
    maximum: int | None = None
    optional: bool = False  # may be cleared (empty text / null)

    def public(self) -> dict:
        return {
            "path": self.path, "label": self.label, "kind": self.kind, "max_length": self.max_length,
            "options": list(self.options) if self.options else None, "minimum": self.minimum, "maximum": self.maximum,
            "optional": self.optional,
        }


@dataclass(frozen=True)
class ElementDef:
    key: str
    section_type: str | None  # None: the theme
    label: str
    properties: tuple[PropertyDef, ...]
    suggestions: tuple[str, ...] = ()

    def prop(self, path: str) -> PropertyDef | None:
        return next((p for p in self.properties if p.path == path), None)

    def public(self) -> dict:
        return {
            "key": self.key, "section_type": self.section_type, "label": self.label,
            "properties": [p.public() for p in self.properties], "suggestions": list(self.suggestions),
        }


def _section(type_: str, *, align: bool) -> ElementDef:
    props = [
        PropertyDef("background", "Background", "enum", options=BACKGROUNDS),
        PropertyDef("spacing", "Spacing", "enum", options=SPACINGS),
    ]
    if align:
        props.insert(0, PropertyDef("align", "Alignment", "enum", options=ALIGNS))
    return ElementDef(
        f"{type_}.section", type_, "Section style", tuple(props),
        ("Give this section more breathing room", "Use a dark background", "Make it feel quieter and more spacious"),
    )


_ELEMENTS: tuple[ElementDef, ...] = (
    ElementDef("hero.headline", "hero", "Hero headline", (PropertyDef("headline", "Headline", "text", max_length=90),),
               ("Make it sound more premium and editorial, but keep it short", "Make it shorter", "Make it warmer and more welcoming")),
    ElementDef("hero.subheadline", "hero", "Hero subheadline", (PropertyDef("subheadline", "Subheadline", "textarea", max_length=220, optional=True),),
               ("Make it more concise", "Make it sound more premium", "Say that every piece is made to last")),
    ElementDef("hero.cta", "hero", "Hero button", (
        PropertyDef("cta_text", "Button label", "text", max_length=30, optional=True), PropertyDef("cta_href", "Button link", "link", max_length=300)),
        ("Change the label to 'Discover the collection'", "Make the label shorter", "Link it to all products")),
    ElementDef("hero.image", "hero", "Hero image", (PropertyDef("image_url", "Image", "image_url", max_length=500, optional=True),),
               ("Remove the image", "Use the Structured Tote photo")),
    _section("hero", align=True),
    ElementDef("product_grid.heading", "product_grid", "Product grid heading", (PropertyDef("title", "Heading", "text", max_length=70),),
               ("Make the heading more editorial", "Call it 'Best sellers'")),
    ElementDef("product_grid.products", "product_grid", "Product grid products", (
        PropertyDef("collection_id", "Collection", "collection_id", optional=True), PropertyDef("limit", "Number of products", "int", minimum=1, maximum=24)),
        ("Show only 4 products", "Feature the Signature Totes collection", "Show products from all collections")),
    _section("product_grid", align=False),
    ElementDef("collection_grid.heading", "collection_grid", "Collections heading", (PropertyDef("title", "Heading", "text", max_length=70),),
               ("Make the heading shorter", "Make it more inviting")),
    ElementDef("collection_grid.collections", "collection_grid", "Collection tiles", (PropertyDef("limit", "Number of collections", "int", minimum=1, maximum=12),),
               ("Show only 3 collections",)),
    _section("collection_grid", align=False),
    ElementDef("feature_banner.eyebrow", "feature_banner", "Banner eyebrow", (PropertyDef("eyebrow", "Eyebrow", "text", max_length=40, optional=True),),
               ("Make it shorter",)),
    ElementDef("feature_banner.heading", "feature_banner", "Banner heading", (PropertyDef("heading", "Heading", "text", max_length=110),),
               ("Make it more editorial", "Make it shorter and bolder")),
    ElementDef("feature_banner.body", "feature_banner", "Banner text", (PropertyDef("body", "Text", "textarea", max_length=240, optional=True),),
               ("Make it more concise", "Make it sound more premium")),
    ElementDef("feature_banner.cta", "feature_banner", "Banner button", (
        PropertyDef("cta_text", "Button label", "text", max_length=30, optional=True), PropertyDef("cta_href", "Button link", "link", max_length=300)),
        ("Change the label to 'Explore now'", "Link it to all products")),
    _section("feature_banner", align=True),
    ElementDef("brand_story.heading", "brand_story", "Story heading", (PropertyDef("heading", "Heading", "text", max_length=110),),
               ("Make it more editorial", "Make it shorter")),
    ElementDef("brand_story.body", "brand_story", "Story text", (PropertyDef("body", "Text", "textarea", max_length=600, optional=True),),
               ("Make it more concise", "Make it warmer", "Make it sound more premium")),
    _section("brand_story", align=True),
    ElementDef("theme.style", None, "Theme", (
        PropertyDef("primary_color", "Text and button color", "color"),
        PropertyDef("background_color", "Background color", "color"),
        PropertyDef("font_family", "Typography", "enum", options=tuple(FONT_OPTIONS)),
        PropertyDef("border_radius", "Corner radius", "enum", options=RADIUS_OPTIONS),
        PropertyDef("button_style", "Button style", "enum", options=BUTTON_STYLES)),
        ("Use a warmer cream background", "Switch to a classic serif typeface", "Make corners rounder and buttons outlined")),
)

REGISTRY: dict[str, ElementDef] = {e.key: e for e in _ELEMENTS}
SECTION_TYPES: tuple[str, ...] = tuple(dict.fromkeys(e.section_type for e in _ELEMENTS if e.section_type))

SECTION_LABELS = {
    "hero": "Hero", "product_grid": "Product grid", "collection_grid": "Collections", "feature_banner": "Feature banner",
    "brand_story": "Brand story",
}


def elements_for_section(section_type: str) -> list[ElementDef]:
    return [e for e in _ELEMENTS if e.section_type == section_type]


def public_registry() -> dict:
    return {
        "elements": [e.public() for e in _ELEMENTS],
        "section_types": [{"type": t, "label": SECTION_LABELS[t]} for t in SECTION_TYPES],
        "fonts": FONT_OPTIONS,
    }


# ---- validation ---------------------------------------------------------------------------------------------

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_INTERNAL = re.compile(r"^/(?!/)[A-Za-z0-9/_\-.?=&#%]{0,299}$")
_HTTPS = re.compile(r"^https://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%\-]{4,290}$")
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_MARKUP = re.compile(r"[<>`]|javascript:|data:text|vbscript:|&#|\bon\w+\s*=", re.IGNORECASE)


class InvalidValue(ValueError):
    """A proposed value that is not valid for its field; the message is safe to show to the user."""


@dataclass
class CatalogContext:
    """What the store really has, for properties that may only refer to existing things."""

    collection_ids: set[str] = field(default_factory=set)
    image_urls: set[str] = field(default_factory=set)


def validate_value(prop: PropertyDef, value: Any, ctx: CatalogContext, current: Any = None) -> Any:
    """Returns the normalised value, or raises InvalidValue."""
    if prop.kind in ("text", "textarea", "link"):
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise InvalidValue(f"{prop.label} must be text.")
        text = re.sub(r"[ \t]+", " ", value.strip())
        if _CONTROL.search(text):
            raise InvalidValue(f"{prop.label} contains characters that aren't allowed.")
        if not text:
            if prop.optional:
                return ""
            raise InvalidValue(f"{prop.label} can't be empty.")
        if prop.kind == "link":
            if not (_INTERNAL.match(text) or _HTTPS.match(text)) or _MARKUP.search(text):
                raise InvalidValue(f"{prop.label} must be a page on this store (starting with /) or an https link.")
            return text
        if _MARKUP.search(text):
            raise InvalidValue(f"{prop.label} must be plain text: no HTML, scripts or markup.")
        if prop.max_length and len(text) > prop.max_length:
            raise InvalidValue(f"{prop.label} is too long (at most {prop.max_length} characters).")
        if prop.kind == "text" and "\n" in text:
            raise InvalidValue(f"{prop.label} must be a single line.")
        return text
    if prop.kind == "enum":
        if value not in (prop.options or ()):
            raise InvalidValue(f"{prop.label} must be one of: {', '.join(prop.options or ())}.")
        return value
    if prop.kind == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise InvalidValue(f"{prop.label} must be a whole number.")
        if prop.minimum is not None and value < prop.minimum or prop.maximum is not None and value > prop.maximum:
            raise InvalidValue(f"{prop.label} must be between {prop.minimum} and {prop.maximum}.")
        return value
    if prop.kind == "color":
        if not isinstance(value, str) or not _HEX.match(value):
            raise InvalidValue(f"{prop.label} must be a hex color like #F3EEE6.")
        return value.upper()
    if prop.kind == "collection_id":
        if value is None or value == "":
            return None
        try:
            normalised = str(uuid.UUID(str(value)))
        except ValueError:
            raise InvalidValue("That isn't a valid collection.") from None
        if normalised not in ctx.collection_ids:
            raise InvalidValue("That collection doesn't exist in this store.")
        return normalised
    if prop.kind == "image_url":
        if value is None or value == "":
            return None
        if not isinstance(value, str) or (value not in ctx.image_urls and value != current):
            raise InvalidValue("Images can only be set to a photo that already exists in this store's catalog.")
        return value
    raise InvalidValue("Unsupported property.")  # pragma: no cover

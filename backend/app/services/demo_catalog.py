"""VELORA's catalog content: the products, prices, the deliberately seeded business problems, collection
copy, colorways and product descriptions. Pure data (no database access), shared by the demo seed and by
scripts/generate_velora_assets.py so the illustrations always match the catalog.

Descriptions are the merchant's own marketing copy for a fictional brand: they describe material, character
and use. They deliberately avoid measurements, certifications and any claim a shopper could rely on as a
fact about a real product (no dimensions, no capacities, no origin claims)."""

# (title, price, problem) — problem is one of: low_stock, dead_stock, low_conversion, declining, None
CATALOG: dict[str, list[tuple[str, float, str | None]]] = {
    "Signature Totes": [
        ("Structured Tote", 320, "low_stock"),
        ("Weekender Tote", 280, None),
        ("Canvas Everyday Tote", 140, None),
        ("Mini Structured Tote", 260, None),
        ("Oversized Shopper Tote", 240, "low_conversion"),
        ("Woven Straw Tote", 180, "dead_stock"),
    ],
    "Everyday Crossbody": [
        ("City Crossbody", 220, "low_stock"),
        ("Mini Crossbody", 180, None),
        ("Saddle Crossbody", 260, None),
        ("Quilted Crossbody", 300, None),
        ("Convertible Crossbody", 240, "low_conversion"),
        ("Belt Bag Crossbody", 160, None),
    ],
    "Evening Clutches": [
        ("Satin Evening Clutch", 190, "declining"),
        ("Beaded Clutch", 220, "declining"),
        ("Envelope Clutch", 150, "declining"),
        ("Velvet Clutch", 170, "declining"),
        ("Crystal-Embellished Clutch", 260, "low_conversion"),
    ],
    "Wallets & Cardholders": [
        ("Bifold Wallet", 95, "low_stock"),
        ("Zip-Around Wallet", 110, None),
        ("Cardholder", 60, None),
        ("Coin Pouch", 40, "dead_stock"),
        ("Passport Holder", 85, None),
    ],
    "Belts & Accessories": [
        ("Leather Belt", 90, None),
        ("Reversible Belt", 100, None),
        ("Silk Scarf", 75, None),
        ("Keychain Charm", 35, "dead_stock"),
    ],
}

MATERIALS = {
    "Signature Totes": "full-grain leather",
    "Everyday Crossbody": "pebbled leather",
    "Evening Clutches": "silk satin",
    "Wallets & Cardholders": "pebbled leather",
    "Belts & Accessories": "vegetable-tanned leather",
}

COLLECTION_DESCRIPTIONS = {
    "Signature Totes": "Structured carryalls for the days that ask a lot of a bag. Full-grain leather, quiet hardware, room for the day.",
    "Everyday Crossbody": "Hands-free and easy to live in. Soft pebbled leather in shapes that go from the commute to dinner.",
    "Evening Clutches": "Small bags for the occasions worth dressing for, in satin, velvet and a little sparkle.",
    "Wallets & Cardholders": "The things you reach for every day, made to look better the longer you carry them.",
    "Belts & Accessories": "The finishing touches: belts, a silk scarf and a leather charm for the keys.",
}

# Colorways, as a name and a hex used by the illustrations. Variants carry the NAME as {"color": name}.
COLORWAYS = {
    "Cognac": "#A5622F", "Espresso": "#3B2A20", "Sand": "#CDB89A", "Olive": "#6B6B47", "Ink": "#26262E",
    "Midnight": "#232948", "Champagne": "#D8C3A0", "Garnet": "#6E2230", "Natural": "#CBB38A", "Cream": "#E9DFCC",
}

# The colorways a product is offered in, first = the one shown in its photo. Products with a seeded stock
# problem keep a single colorway so the low-stock story stays one clear, reconcilable line.
_COLORWAYS_BY_COLLECTION = {
    "Signature Totes": ["Cognac", "Espresso", "Sand"],
    "Everyday Crossbody": ["Espresso", "Cognac", "Olive"],
    "Evening Clutches": ["Midnight", "Champagne", "Garnet"],
    "Wallets & Cardholders": ["Espresso", "Cognac", "Ink"],
    "Belts & Accessories": ["Cognac", "Espresso"],
}
_SINGLE_COLOR_OVERRIDES = {"Woven Straw Tote": "Natural", "Canvas Everyday Tote": "Cream", "Silk Scarf": "Champagne", "Keychain Charm": "Cognac"}


def product_slug(title: str) -> str:
    return title.lower().replace(" ", "-").replace("&", "and")


def default_color(collection: str, title: str) -> str:
    return _SINGLE_COLOR_OVERRIDES.get(title) or _COLORWAYS_BY_COLLECTION[collection][0]


def colorways_for(collection: str, title: str, problem: str | None) -> list[str]:
    if title in _SINGLE_COLOR_OVERRIDES or problem in ("low_stock", "dead_stock"):
        return [default_color(collection, title)]
    return list(_COLORWAYS_BY_COLLECTION[collection])


PRODUCT_COPY: dict[str, str] = {
    "Structured Tote": "The bag the whole collection is built around. A firm, upright shape in full-grain leather that holds its lines from the first day, with a clean interior and quiet hardware.",
    "Weekender Tote": "Generous without being slouchy. Full-grain leather with a soft structure, made for the two-day trip and the very full Monday.",
    "Canvas Everyday Tote": "Our lightest carryall: sturdy cream canvas with leather handles that darken gracefully. Easy to throw over a shoulder and easy to forget you're carrying.",
    "Mini Structured Tote": "All the poise of the Structured Tote in a smaller frame. Full-grain leather, a firm shape and just enough room for the essentials.",
    "Oversized Shopper Tote": "An unapologetically roomy shopper in full-grain leather. Soft enough to fold into a bigger plan, structured enough to still look composed.",
    "Woven Straw Tote": "Natural straw woven by hand and finished with leather trim. A warm-weather companion that gets better with every outing.",
    "City Crossbody": "Built for a day of moving around. Pebbled leather, a secure flap and an adjustable strap that sits comfortably across the body.",
    "Mini Crossbody": "Small, soft and always within reach. Pebbled leather with a slim profile that goes with nearly everything.",
    "Saddle Crossbody": "A classic saddle shape in pebbled leather, with a curved flap and a clean line from every angle.",
    "Quilted Crossbody": "Soft pebbled leather with a quilted front for a little texture. Polished enough for dinner, easy enough for the commute.",
    "Convertible Crossbody": "One bag, a few ways to carry it. Pebbled leather with a strap you can wear across the body or shorten to carry by hand.",
    "Belt Bag Crossbody": "A belt bag that behaves like a crossbody. Pebbled leather, a low profile and a strap you can wear at the waist or across the chest.",
    "Satin Evening Clutch": "A slim clutch in silk satin with a soft sheen. Made to slip into the smallest evening plans.",
    "Beaded Clutch": "Hand-finished beadwork over a silk satin base. A small bag that carries a lot of occasion.",
    "Envelope Clutch": "A clean envelope silhouette in silk satin. Simple, elegant and easy to carry in one hand.",
    "Velvet Clutch": "Rich velvet with a gentle shine and a slim, structured shape. Made for cooler evenings and longer ones.",
    "Crystal-Embellished Clutch": "Silk satin finished with a scatter of crystals. The one to reach for when the evening deserves a little sparkle.",
    "Bifold Wallet": "A slim bifold in pebbled leather with room for cards and notes. It starts crisp and softens with use.",
    "Zip-Around Wallet": "Everything in one place, zipped shut. Pebbled leather with a full-length zip and a tidy, organized interior.",
    "Cardholder": "The simplest way to carry what you need. Pebbled leather, a slim profile and nothing you don't use.",
    "Coin Pouch": "A small zip pouch in pebbled leather for coins, keys or earbuds. Useful on its own or tucked inside a larger bag.",
    "Passport Holder": "Pebbled leather made for travel days: a slim cover that keeps your passport and boarding pass together.",
    "Leather Belt": "A clean, classic belt in vegetable-tanned leather with a polished buckle. It develops a richer color the longer you wear it.",
    "Reversible Belt": "Two looks, one belt. Vegetable-tanned leather with a buckle that turns to show either side.",
    "Silk Scarf": "A lightweight silk scarf with a soft drape. Wear it at the neck, in the hair or tied to a handle.",
    "Keychain Charm": "A small leather tag on a polished ring. A little finishing touch for your keys or the zip of a favorite bag.",
}

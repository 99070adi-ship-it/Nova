"""Generates VELORA's product and brand illustrations as original SVG files (no stock photos, no external
URLs, nothing licensed): app/static/velora/<product-slug>.svg plus hero.svg and one image per collection.
Deterministic, so re-running produces identical files. Run from backend/:  python scripts/generate_velora_assets.py

The demo seed (app/services/demo_service.py) points each product's canonical image at these files, and the
API serves them from /static. A real merchant would upload photography; these keep the demo coherent."""

import colorsys
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services.demo_catalog import CATALOG, COLORWAYS, default_color, product_slug  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parents[1] / "app" / "static" / "velora"
BG_A, BG_B = "#F6F1E9", "#E7DDCE"


def shade(hex_color: str, factor: float) -> str:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    r, g, b = colorsys.hls_to_rgb(hh, max(0, min(1, ll * factor)), ss)
    return "#%02X%02X%02X" % (round(r * 255), round(g * 255), round(b * 255))


def wrap(body: str, color: str, label: str) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-label="{label}">
<defs>
<radialGradient id="bg" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="{BG_A}"/><stop offset="1" stop-color="{BG_B}"/></radialGradient>
<linearGradient id="body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{shade(color, 1.25)}"/><stop offset="0.55" stop-color="{color}"/><stop offset="1" stop-color="{shade(color, 0.72)}"/></linearGradient>
<linearGradient id="dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{shade(color, 0.85)}"/><stop offset="1" stop-color="{shade(color, 0.6)}"/></linearGradient>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>
<rect width="800" height="800" fill="url(#bg)"/>
{body}
</svg>
'''


def stitch(d: str, color: str) -> str:
    return f'<path d="{d}" fill="none" stroke="{shade(color, 1.45)}" stroke-width="3" stroke-dasharray="9 8" stroke-linecap="round" opacity="0.75"/>'


def shadow(cx: int, cy: int, rx: int, ry: int) -> str:
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#3a2a1d" opacity="0.28" filter="url(#soft)"/>'


def tote(c: str) -> str:
    return (shadow(400, 640, 230, 26)
        + '<path d="M270 300 C270 110 530 110 530 300" fill="none" stroke="url(#dark)" stroke-width="26" stroke-linecap="round"/>'
        + '<path d="M205 300 L595 300 L630 625 Q632 645 612 645 L188 645 Q168 645 170 625 Z" fill="url(#body)"/>'
        + '<path d="M205 300 L595 300 L600 342 L200 342 Z" fill="url(#dark)" opacity="0.55"/>'
        + stitch("M222 322 L578 322", c) + stitch("M190 610 L610 610", c)
        + f'<rect x="372" y="440" width="56" height="12" rx="6" fill="{shade(c, 1.5)}" opacity="0.8"/>')


def crossbody(c: str) -> str:
    return (shadow(400, 628, 200, 22)
        + '<path d="M232 330 C190 130 610 130 568 330" fill="none" stroke="url(#dark)" stroke-width="16" stroke-linecap="round"/>'
        + '<rect x="200" y="330" width="400" height="290" rx="44" fill="url(#body)"/>'
        + '<path d="M200 374 Q200 330 244 330 L556 330 Q600 330 600 374 L600 430 Q400 520 200 430 Z" fill="url(#dark)" opacity="0.6"/>'
        + stitch("M226 360 L574 360", c) + stitch("M226 596 L574 596", c)
        + f'<circle cx="400" cy="470" r="19" fill="{shade(c, 1.6)}"/><circle cx="400" cy="470" r="9" fill="{shade(c, 0.6)}"/>')


def clutch(c: str) -> str:
    return (shadow(400, 560, 260, 20)
        + '<rect x="130" y="270" width="540" height="280" rx="34" fill="url(#body)"/>'
        + '<path d="M130 304 Q130 270 164 270 L636 270 Q670 270 670 304 L670 340 L400 468 L130 340 Z" fill="url(#dark)" opacity="0.62"/>'
        + stitch("M156 296 L644 296", c)
        + f'<circle cx="400" cy="458" r="17" fill="{shade(c, 1.7)}"/>')


def wallet(c: str) -> str:
    return (shadow(400, 600, 190, 20)
        + '<rect x="215" y="260" width="370" height="320" rx="30" fill="url(#body)"/>'
        + f'<path d="M400 260 L400 580" stroke="{shade(c, 0.55)}" stroke-width="4" opacity="0.7"/>'
        + stitch("M236 284 L564 284", c) + stitch("M236 556 L564 556", c)
        + f'<rect x="350" y="400" width="100" height="26" rx="13" fill="{shade(c, 1.55)}" opacity="0.85"/>')


def small_wallet(c: str) -> str:
    return (shadow(400, 560, 150, 18)
        + '<rect x="265" y="300" width="270" height="200" rx="24" fill="url(#body)"/>'
        + '<path d="M265 336 Q265 300 301 300 L499 300 Q535 300 535 336 L535 372 L265 372 Z" fill="url(#dark)" opacity="0.6"/>'
        + stitch("M284 322 L516 322", c) + stitch("M284 480 L516 480", c))


def pouch(c: str) -> str:
    return (shadow(400, 590, 170, 18)
        + '<path d="M240 330 Q400 290 560 330 L580 560 Q580 590 550 590 L250 590 Q220 590 220 560 Z" fill="url(#body)"/>'
        + f'<path d="M240 330 Q400 290 560 330" fill="none" stroke="{shade(c, 0.55)}" stroke-width="6"/>'
        + f'<rect x="360" y="318" width="80" height="30" rx="12" fill="url(#dark)"/><circle cx="400" cy="333" r="6" fill="{shade(c, 1.7)}"/>'
        + stitch("M236 560 L564 560", c))


def holder(c: str) -> str:
    return (shadow(400, 640, 150, 20)
        + '<rect x="270" y="170" width="260" height="460" rx="28" fill="url(#body)"/>'
        + '<path d="M270 200 Q270 170 300 170 L500 170 Q530 170 530 200 L530 290 L270 290 Z" fill="url(#dark)" opacity="0.55"/>'
        + stitch("M290 192 L510 192", c) + stitch("M290 606 L510 606", c)
        + f'<circle cx="400" cy="400" r="46" fill="none" stroke="{shade(c, 1.5)}" stroke-width="3" opacity="0.7"/>')


def belt(c: str) -> str:
    return (shadow(400, 480, 300, 16)
        + '<path d="M120 400 Q400 340 680 400 L680 450 Q400 390 120 450 Z" fill="url(#body)"/>'
        + stitch("M130 412 Q400 354 670 412", c) + stitch("M130 438 Q400 380 670 438", c)
        + '<rect x="560" y="360" width="86" height="110" rx="14" fill="none" stroke="#B69A64" stroke-width="12"/>'
        + '<rect x="596" y="396" width="52" height="8" rx="4" fill="#B69A64"/>')


def scarf(c: str) -> str:
    return (shadow(400, 640, 230, 18)
        + '<path d="M180 220 Q400 150 620 230 L600 560 Q400 640 200 560 Z" fill="url(#body)"/>'
        + "".join(f'<path d="M{200 + i * 62} {240 + (i % 2) * 8} Q{230 + i * 62} 400 {205 + i * 62} 560" fill="none" stroke="{shade(c, 1.35)}" stroke-width="3" opacity="0.45"/>' for i in range(7))
        + f'<path d="M200 560 L200 610 M250 568 L250 620 M300 574 L300 628 M350 578 L350 632 M400 580 L400 634 M450 578 L450 632 M500 574 L500 628 M550 568 L550 620 M600 560 L600 610" stroke="{c}" stroke-width="6" stroke-linecap="round"/>')


def charm(c: str) -> str:
    return (shadow(400, 640, 120, 14)
        + '<circle cx="400" cy="200" r="62" fill="none" stroke="#B69A64" stroke-width="14"/>'
        + '<path d="M400 262 L400 330" stroke="#B69A64" stroke-width="10"/>'
        + '<path d="M340 330 L460 330 L478 560 Q478 600 440 600 L360 600 Q322 600 322 560 Z" fill="url(#body)"/>'
        + stitch("M346 352 L454 352", c) + f'<circle cx="400" cy="480" r="26" fill="none" stroke="{shade(c, 1.5)}" stroke-width="3" opacity="0.7"/>')


def kind(title: str) -> str:
    t = title.lower()
    for key, fn in [("belt bag", "crossbody"), ("belt", "belt"), ("scarf", "scarf"), ("charm", "charm"), ("passport", "holder"),
                    ("cardholder", "small_wallet"), ("pouch", "pouch"), ("wallet", "wallet"), ("clutch", "clutch"),
                    ("crossbody", "crossbody"), ("tote", "tote"), ("shopper", "tote")]:
        if key in t:
            return fn
    return "tote"


SHAPES = {"tote": tote, "crossbody": crossbody, "clutch": clutch, "wallet": wallet, "small_wallet": small_wallet, "pouch": pouch,
          "holder": holder, "belt": belt, "scarf": scarf, "charm": charm}


def hero() -> str:
    body = (f'<g transform="translate(-60 40) scale(1.1)">{tote(COLORWAYS["Cognac"])}</g>'
            f'<g transform="translate(330 220) scale(0.62)">{crossbody(COLORWAYS["Espresso"])}</g>'
            f'<g transform="translate(110 380) scale(0.5)">{wallet(COLORWAYS["Sand"])}</g>')
    return wrap(body, "#A5622F", "VELORA leather goods, a tote, crossbody and wallet arranged on warm cream").replace('viewBox="0 0 800 800"', 'viewBox="0 0 800 800"')


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    count = 0
    for collection, items in CATALOG.items():
        for title, _price, _problem in items:
            color_name = default_color(collection, title)
            svg = wrap(SHAPES[kind(title)](COLORWAYS[color_name]), COLORWAYS[color_name], f"{title} in {color_name}")
            (OUT / f"{product_slug(title)}.svg").write_text(svg)
            count += 1
    (OUT / "hero.svg").write_text(hero())
    print(f"wrote {count} product images and hero.svg to {OUT}")


if __name__ == "__main__":
    main()

"""Make an animated Teto SVG sticker for the Doki Theme (doki.sticker.path).

The skin's art is static; this adds SVG (SMIL) animations to it: a slow bob,
drills that sway joint by joint like a wave, an ahoge wiggle, a head tilt and
a blink. SVG used as an image can animate but can never run scripts, so the
sticker is safe to put in VS Code's CSS. Ids and pivots come from the skin's
manifest, exactly like the desktop UI.

Output: %LOCALAPPDATA%\\Teto\\sticker\\teto-animated.svg (outside OneDrive)
"""

import json
import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path

SKIN = Path(__file__).resolve().parents[3] / "assets" / "skins" / "teto-chibi"


def spin(values: str, dur: float, begin: float = 0.0) -> str:
    """A rotation added on top of the element's own transform (additive="sum")."""
    return (f'<animateTransform attributeName="transform" type="rotate" values="{values}" dur="{dur}s" '
            f'begin="{-begin:.2f}s" repeatCount="indefinite" additive="sum" calcMode="spline" '
            f'keySplines="0.45 0 0.55 1;0.45 0 0.55 1" keyTimes="0;0.5;1"/>')


def after_open_tag(svg: str, element_id: str, insert: str) -> str:
    """Put `insert` right after the opening tag of the element with this id."""
    pattern = re.compile(rf'(<(\w+)\b[^>]*\bid="{re.escape(element_id)}"[^>]*?)(/?)>')
    m = pattern.search(svg)
    if not m:
        raise ValueError(f"skin has no element #{element_id}")
    if m[3]:  # self-closing <path .../>: open it up so it can hold an animation
        return svg[:m.start()] + f"{m[1]}>{insert}</{m[2]}>" + svg[m.end():]
    return svg[:m.end()] + insert + svg[m.end():]


def animate(svg: str, manifest: dict) -> str:
    # Drills: each joint sways a little more than the one above it, slightly later: a wave.
    for chain in manifest["chains"]:
        side = 0.6 if chain["mirror"] else 0.0
        for j in range(chain["joints"]):
            a = 2.0 + 1.2 * j
            svg = after_open_tag(svg, f"{chain['prefix']}-{j}", spin(f"{-a};{a};{-a}", 2.6, side + 0.22 * j))
    parts = manifest["parts"]
    x, y = parts["ahoge"]["pivot"]
    svg = after_open_tag(svg, parts["ahoge"]["id"], spin(f"-8 {x} {y};8 {x} {y};-8 {x} {y}", 1.8))
    x, y = parts["head"]["pivot"]
    svg = after_open_tag(svg, parts["head"]["id"], spin(f"-2 {x} {y};2 {x} {y};-2 {x} {y}", 4.2))
    # Blink: every 4 s the open eyes hide and the closed eyes show for ~0.15 s.
    blink = 'keyTimes="0;0.95;0.99" calcMode="discrete" dur="4s" repeatCount="indefinite"'
    svg = svg.replace('<g class="eyes-open">',
                      f'<g class="eyes-open"><animate attributeName="display" values="inline;none;inline" {blink}/>')
    # A presentation attribute (not style="...") so the animation can override it.
    svg = svg.replace('<g class="eyes-closed" style="display:none">',
                      f'<g class="eyes-closed" display="none"><animate attributeName="display" values="none;inline;none" {blink}/>')
    # Whole body: a slow bob.
    body = ('<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="3s" '
            'repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>')
    svg = re.sub(r"(<svg\b[^>]*>)", lambda m: m[1] + body, svg, count=1)
    # Room around the art so swinging drill tips and the bob aren't clipped at the edges.
    w, h = manifest["size"]
    pad = 24
    svg = svg.replace(f'viewBox="0 0 {w} {h}" width="{w}" height="{h}"',
                      f'viewBox="{-pad} {-pad} {w + 2 * pad} {h + 2 * pad}" width="{w + 2 * pad}" height="{h + 2 * pad}"', 1)
    return svg.replace("</svg>", "</g></svg>")


def main() -> Path:
    manifest = json.loads((SKIN / "manifest.json").read_text(encoding="utf-8"))
    svg = animate((SKIN / manifest["svg"]).read_text(encoding="utf-8"), manifest)
    root = ET.fromstring(svg)  # self-check: still well-formed XML, animations present, no scripts
    ns = "{http://www.w3.org/2000/svg}"
    assert len(root.findall(f".//{ns}animateTransform")) >= 16, "missing animations"
    assert not root.findall(f".//{ns}script"), "a sticker must never contain a script"
    out = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Teto" / "sticker" / "teto-animated.svg"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg, encoding="utf-8")
    print(f"wrote {out}")
    return out


if __name__ == "__main__":
    main()

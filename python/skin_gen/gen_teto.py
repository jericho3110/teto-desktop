"""Generate the original chibi Teto-style skin as a layered SVG.

Why a generator instead of a hand-written SVG?
- The two drills are mirror images; generating them from one function
  keeps them identical and makes the segment count/size easy to tweak.
- Every animatable part gets a stable id that the TypeScript animator
  looks up (see assets/skins/teto-chibi/manifest.json).

Run:  python python/skin_gen/gen_teto.py
Writes assets/skins/teto-chibi/teto.svg next to its manifest.
"""

from pathlib import Path

# --- palette -----------------------------------------------------------
HAIR = "#d8344e"
HAIR_DARK = "#a11f37"
HAIR_LIGHT = "#f47a8a"
SKIN = "#ffe6d6"
SKIN_SHADE = "#f7c9b4"
IRIS = "#c8223e"
IRIS_DARK = "#6b0f20"
LINE = "#3b141c"
CLOTH = "#3b3e48"
CLOTH_DARK = "#2a2c34"
ACCENT = "#d8344e"
WHITE = "#ffffff"

# Drill chain: (half-width, length) per segment, top (at the hair tie) to tip.
DRILL_SEGMENTS = [(13, 20), (24, 26), (27, 26), (25, 26), (21, 25), (16, 23), (10, 20)]


def drill(side: str, x: float, y: float) -> str:
    """One drill as nested <g> segments so each joint can rotate.

    side "L" hangs on the left, "R" is mirrored with scale(-1,1); the
    animator flips the angle sign for "R" (manifest: chains[].mirror).
    """
    mirror = " scale(-1,1)" if side == "R" else ""
    out = [f'<g id="drill-{side}" transform="translate({x},{y}){mirror}">']
    for i, (w, h) in enumerate(DRILL_SEGMENTS):
        offset = 0 if i == 0 else DRILL_SEGMENTS[i - 1][1]
        out.append(f'<g id="drill-{side}-{i}" transform="translate(0,{offset}) rotate(0)">')
        if i == 0:
            # hair tie
            out.append(f'<ellipse cx="0" cy="0" rx="9" ry="6" fill="{CLOTH}"/>')
            out.append(f'<ellipse cx="0" cy="{h/2+3}" rx="{w}" ry="{h/2+2}" fill="{HAIR}"/>')
        elif i == len(DRILL_SEGMENTS) - 1:
            # pointed curly tip
            out.append(
                f'<path d="M{-w},2 Q{-w},{h} 2,{h+10} Q{w*0.4},{h*0.6} {w},2 Z" '
                f'fill="{HAIR}" stroke="{HAIR_DARK}" stroke-width="2"/>'
            )
        else:
            # one coil: tilted band, darker underside, glossy highlight
            out.append(
                f'<path d="M{-w},{h*0.15} Q0,{-h*0.35} {w},{h*0.35} '
                f'Q{w+2},{h*0.95} {w*0.6},{h*1.05} Q0,{h*0.75} {-w},{h*0.85} '
                f'Q{-w-3},{h*0.5} {-w},{h*0.15} Z" fill="{HAIR}" stroke="{HAIR_DARK}" stroke-width="2"/>'
            )
            out.append(
                f'<path d="M{-w+2},{h*0.8} Q0,{h*0.62} {w-1},{h*0.98}" '
                f'fill="none" stroke="{HAIR_DARK}" stroke-width="4" stroke-linecap="round" opacity=".7"/>'
            )
            out.append(
                f'<path d="M{-w*0.6},{h*0.18} Q{-w*0.1},{-h*0.05} {w*0.45},{h*0.25}" '
                f'fill="none" stroke="{HAIR_LIGHT}" stroke-width="3" stroke-linecap="round"/>'
            )
    out.append("</g>" * len(DRILL_SEGMENTS))
    out.append("</g>")
    return "\n".join(out)


def eye(cx: float, cy: float, side: str) -> str:
    """Three eye states; the animator shows exactly one group at a time."""
    return f"""
<g id="eye-{side}" transform="translate({cx},{cy})">
  <g class="eyes-open">
    <ellipse rx="19" ry="23" fill="{WHITE}"/>
    <g class="look">
      <ellipse cy="2" rx="16" ry="20" fill="{IRIS}"/>
      <ellipse cy="9" rx="13" ry="11" fill="#e8566c" opacity=".8"/>
      <ellipse cy="0" rx="7" ry="10" fill="{IRIS_DARK}"/>
      <circle cx="-6" cy="-8" r="6" fill="{WHITE}"/>
      <circle cx="6" cy="9" r="2.8" fill="{WHITE}"/>
    </g>
    <path d="M-21,-4 C-19,-28 19,-28 21,-4 L25,-10" fill="none" stroke="{LINE}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g class="eyes-closed" style="display:none">
    <path d="M-19,2 Q0,13 19,2" fill="none" stroke="{LINE}" stroke-width="4.5" stroke-linecap="round"/>
  </g>
  <g class="eyes-happy" style="display:none">
    <path d="M-17,6 Q0,-13 17,6" fill="none" stroke="{LINE}" stroke-width="4.5" stroke-linecap="round"/>
  </g>
  <g class="eyes-half" style="display:none">
    <path d="M-19,-2 L19,-2 A19,21 0 0 1 -19,-2 Z" fill="{WHITE}"/>
    <path d="M-15,-2 L15,-2 A15,18 0 0 1 -15,-2 Z" fill="{IRIS}"/>
    <path d="M-7,-2 L7,-2 A7,9 0 0 1 -7,-2 Z" fill="{IRIS_DARK}"/>
    <path d="M-22,-1 Q0,-6 23,-4" fill="none" stroke="{LINE}" stroke-width="5" stroke-linecap="round"/>
  </g>
</g>"""


def build() -> str:
    mouth_y = 210
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400">',
        # back hair
        f'<path id="hair-back" d="M50,142 C40,30 260,30 250,142 L246,238 Q228,252 212,236 '
        f'L88,236 Q72,252 54,238 Z" fill="{HAIR_DARK}"/>',
        drill("L", 34, 100),
        drill("R", 266, 100),
        # body
        '<g id="body">',
        f'<rect x="140" y="224" width="20" height="18" fill="{SKIN_SHADE}"/>',
        f'<path d="M112,246 Q150,230 188,246 L194,304 L106,304 Z" fill="{CLOTH}"/>',
        f'<path d="M132,238 L150,262 L168,238 Z" fill="{WHITE}"/>',
        f'<path d="M145,250 L155,250 L158,282 L150,292 L142,282 Z" fill="{ACCENT}"/>',
        f'<path d="M104,300 L196,300 L212,338 L88,338 Z" fill="{CLOTH_DARK}"/>',
        f'<path d="M89,334 L211,334 L212,338 L88,338 Z" fill="{ACCENT}"/>',
        f'<g id="arm-L" transform="translate(116,246) rotate(0)">'
        f'<path d="M0,0 Q-14,22 -16,48 L-4,50 Q-2,28 8,10 Z" fill="{CLOTH}"/>'
        f'<circle cx="-10" cy="54" r="8" fill="{SKIN}"/></g>',
        f'<g id="arm-R" transform="translate(184,246) rotate(0)">'
        f'<path d="M0,0 Q14,22 16,48 L4,50 Q2,28 -8,10 Z" fill="{CLOTH}"/>'
        f'<circle cx="10" cy="54" r="8" fill="{SKIN}"/></g>',
        f'<rect x="124" y="338" width="16" height="30" fill="{SKIN}"/>',
        f'<rect x="160" y="338" width="16" height="30" fill="{SKIN}"/>',
        f'<rect x="124" y="352" width="16" height="16" fill="{CLOTH_DARK}"/>',
        f'<rect x="160" y="352" width="16" height="16" fill="{CLOTH_DARK}"/>',
        f'<ellipse cx="130" cy="372" rx="13" ry="7" fill="{HAIR_DARK}"/>',
        f'<ellipse cx="170" cy="372" rx="13" ry="7" fill="{HAIR_DARK}"/>',
        "</g>",
        # head (one group so idle bob/tilt moves face + hair together)
        '<g id="head" transform="rotate(0 150 200)">',
        f'<ellipse id="face" cx="150" cy="146" rx="90" ry="84" fill="{SKIN}"/>',
        f'<ellipse cx="96" cy="196" rx="13" ry="7" fill="#ff8fa0" opacity=".45" id="blush-L"/>',
        f'<ellipse cx="204" cy="196" rx="13" ry="7" fill="#ff8fa0" opacity=".45" id="blush-R"/>',
        eye(112, 170, "L"),
        eye(188, 170, "R"),
        f'<g id="mouth" transform="translate(150,{mouth_y})">',
        f'<path class="mouth-smile" d="M-8,-1 Q0,6 8,-1" fill="none" stroke="{LINE}" stroke-width="3" stroke-linecap="round"/>',
        f'<g class="mouth-talk" style="display:none"><path d="M-9,-3 Q0,-5 9,-3 Q7,10 0,10 Q-7,10 -9,-3 Z" fill="{IRIS_DARK}"/>'
        f'<ellipse cy="6" rx="5" ry="3" fill="#ff7d8e"/></g>',
        f'<g class="mouth-grin" style="display:none"><path d="M-14,-4 Q0,-2 14,-4 Q9,13 0,13 Q-9,13 -14,-4 Z" fill="{IRIS_DARK}"/>'
        f'<path d="M-11,-3 L11,-3 L10,1 L-10,1 Z" fill="{WHITE}"/><ellipse cy="9" rx="7" ry="3" fill="#ff7d8e"/></g>',
        f'<ellipse class="mouth-o" style="display:none" rx="5" ry="6" fill="{IRIS_DARK}"/>',
        f'<path class="mouth-flat" style="display:none" d="M-7,1 L7,1" stroke="{LINE}" stroke-width="3" stroke-linecap="round"/>',
        "</g>",
        # side locks + bangs (in front of the face)
        f'<path d="M62,112 Q46,190 66,240 Q82,214 86,150 Z" fill="{HAIR}"/>',
        f'<path d="M238,112 Q254,190 234,240 Q218,214 214,150 Z" fill="{HAIR}"/>',
        f'<path id="bangs" d="M58,138 C48,22 252,22 242,138 Q236,148 228,156 Q222,128 212,112 '
        f'Q206,138 194,150 Q188,118 176,104 Q170,130 156,142 Q152,116 146,104 Q136,130 120,146 '
        f'Q118,120 108,108 Q100,136 86,152 Q80,130 76,118 Q70,140 66,156 Q60,150 58,138 Z" '
        f'fill="{HAIR}" stroke="{HAIR_DARK}" stroke-width="2"/>',
        f'<path d="M90,84 Q120,64 150,70" fill="none" stroke="{HAIR_LIGHT}" stroke-width="5" stroke-linecap="round"/>',
        f'<path id="ahoge" d="M150,64 C140,18 186,8 184,34 C182,50 162,46 166,32" fill="none" '
        f'stroke="{HAIR}" stroke-width="7" stroke-linecap="round"/>',
        # effect overlays, toggled by the animator (all hidden at rest)
        '<g id="fx-sweat" style="display:none"><path d="M244,104 Q234,122 238,130 Q244,138 250,130 '
        'Q254,122 244,104 Z" fill="#9edcff" stroke="#4aa3d8" stroke-width="2"/></g>',
        f'<text id="fx-question" style="display:none" x="236" y="72" font-family="Segoe UI, sans-serif" '
        f'font-size="44" font-weight="800" fill="{ACCENT}" stroke="{WHITE}" stroke-width="2">?</text>',
        '<g id="fx-sparkle" style="display:none" fill="#ffd84a" stroke="#e0a800" stroke-width="1.5">'
        + "".join(
            f'<path transform="translate({x},{y}) scale({k})" d="M0,-10 L3,-3 L10,0 L3,3 L0,10 L-3,3 L-10,0 L-3,-3 Z"/>'
            for x, y, k in ((58, 58, 1.3), (246, 84, 1.0), (226, 40, 0.7))
        )
        + "</g>",
        f'<text id="fx-zzz" style="display:none" x="206" y="64" font-family="Segoe UI, sans-serif" '
        f'font-size="26" font-weight="700" fill="#6b7aa8">Z<tspan font-size="20" dy="-10">z</tspan>'
        f'<tspan font-size="15" dy="-9">z</tspan></text>',
        "</g>",
        "</svg>",
    ]
    return "\n".join(parts)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    target = root / "assets" / "skins" / "teto-chibi" / "teto.svg"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(build(), encoding="utf-8")
    print(f"wrote {target.relative_to(root)}")

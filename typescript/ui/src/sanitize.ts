// Skin sanitizer. Skins are files people share, so an SVG might contain
// <script>, onload="...", <foreignObject> (arbitrary HTML), or links that
// fetch remote content. We use an ALLOW-list: anything not known to be
// harmless drawing markup is removed. (A block-list would always miss a
// trick, e.g. <animate attributeName="href" to="javascript:...">.)
//
// Works on a minimal element interface instead of the real DOM so Node can
// unit-test it (sanitize.test.ts); the real DOM satisfies the interface.

export interface SanitizableElement {
  readonly tagName: string;
  readonly attributes: ArrayLike<{ name: string; value: string }>;
  readonly children: ArrayLike<SanitizableElement>;
  removeAttribute(name: string): void;
  remove(): void;
}

const ALLOWED_TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "defs", "lineargradient", "radialgradient", "stop", "clippath",
  "mask", "title", "desc",
]);

const ALLOWED_ATTRS = new Set([
  "id", "class", "style", "xmlns", "viewbox", "width", "height", "transform", "opacity",
  "d", "x", "y", "dx", "dy", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "points",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-opacity", "stroke-dasharray",
  "font-family", "font-size", "font-weight", "text-anchor",
  "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform",
  "clip-path", "mask",
]);

/** url(...) may only point inside the same SVG: url(#id). */
const EXTERNAL_URL = /url\(\s*['"]?(?!#)/i;
/** Inline styles: plain declarations only (our skin uses "display:none"). */
const SAFE_STYLE = /^[\w\s:;.%#,()-]*$/;

/** Removes unsafe elements/attributes in place. Returns what was removed (for logging). */
export function sanitizeSvg(root: SanitizableElement): string[] {
  const removed: string[] = [];
  const visit = (el: SanitizableElement) => {
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      removed.push(`<${tag}>`);
      el.remove();
      return;
    }
    for (const { name, value } of Array.from(el.attributes)) {
      const n = name.toLowerCase();
      const ok = ALLOWED_ATTRS.has(n) && !EXTERNAL_URL.test(value) && (n !== "style" || SAFE_STYLE.test(value));
      if (!ok) {
        removed.push(`${tag}@${n}`);
        el.removeAttribute(name);
      }
    }
    // Copy first: removing children while iterating a live list skips some.
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(root);
  return removed;
}

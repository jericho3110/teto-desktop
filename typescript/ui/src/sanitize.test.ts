import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeSvg, type SanitizableElement } from "./sanitize.ts";

// A tiny fake DOM: just enough of the interface to exercise the sanitizer.
class FakeEl implements SanitizableElement {
  parent: FakeEl | null = null;
  attrs: { name: string; value: string }[];
  kids: FakeEl[] = [];
  tagName: string;
  // No `constructor(public tagName: string)` shorthand here: that "parameter
  // property" needs code generation, which Node's type stripping can't do.
  constructor(tagName: string, attrs: Record<string, string> = {}, kids: FakeEl[] = []) {
    this.tagName = tagName;
    this.attrs = Object.entries(attrs).map(([name, value]) => ({ name, value }));
    for (const k of kids) { k.parent = this; this.kids.push(k); }
  }
  get attributes() { return this.attrs; }
  get children() { return this.kids; }
  removeAttribute(name: string) { this.attrs = this.attrs.filter((a) => a.name !== name); }
  remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); }
  attr(name: string) { return this.attrs.find((a) => a.name === name)?.value; }
}

test("keeps ordinary drawing markup untouched", () => {
  const path = new FakeEl("path", { d: "M0,0 L1,1", fill: "#d8344e", class: "mouth-talk", style: "display:none" });
  const svg = new FakeEl("svg", { viewBox: "0 0 300 400", xmlns: "http://www.w3.org/2000/svg" }, [new FakeEl("g", { id: "head", transform: "rotate(0 150 200)" }, [path])]);
  assert.deepEqual(sanitizeSvg(svg), []);
  assert.equal(path.attr("style"), "display:none");
});

test("removes scripts, foreignObject, images, links and SMIL animation", () => {
  const svg = new FakeEl("svg", {}, [
    new FakeEl("script", {}),
    new FakeEl("foreignObject", {}),
    new FakeEl("image", { href: "https://evil.example/track.png" }),
    new FakeEl("a", { href: "javascript:alert(1)" }),
    new FakeEl("animate", { attributeName: "href", to: "javascript:alert(1)" }),
    new FakeEl("circle", { r: "3" }),
  ]);
  const removed = sanitizeSvg(svg);
  assert.deepEqual(svg.kids.map((k) => k.tagName), ["circle"]);
  assert.equal(removed.length, 5);
});

test("strips event handlers, hrefs, external url() and fancy styles", () => {
  const rect = new FakeEl("rect", {
    onload: "alert(1)", onclick: "x()", href: "#a", "xlink:href": "https://evil.example",
    fill: "url(https://evil.example/x.svg#g)", stroke: "url(#local)", style: "background:url(//evil.example)",
    width: "5",
  });
  sanitizeSvg(new FakeEl("svg", {}, [rect]));
  assert.deepEqual(rect.attrs.map((a) => a.name).sort(), ["stroke", "width"]);
});

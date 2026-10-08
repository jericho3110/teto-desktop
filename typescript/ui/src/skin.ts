// A skin = manifest.json + one layered SVG. This module is the only code
// that knows about SVG element ids; everything else talks in "parts",
// "eyes", "mouth", so a new skin only needs a new manifest + SVG.
import { sanitizeSvg } from "./sanitize";
import type { SkinManifest } from "./types";

interface Posable {
  el: SVGGraphicsElement;
  base: string; // the transform the artist wrote (e.g. "translate(116,246)")
  pivot: [number, number];
}

export class Skin {
  readonly root: SVGSVGElement;
  private parts = new Map<string, Posable>();
  private chainJoints: Posable[][] = [];
  private eyeStates: Map<string, SVGGElement[]>;
  private looks: SVGGElement[];
  private mouthStates: Map<string, SVGGraphicsElement[]>;
  private current = { eyes: "", mouth: "" };

  private constructor(readonly manifest: SkinManifest, container: HTMLElement, svgText: string) {
    // Skins can be shared files: sanitize BEFORE the SVG enters the live page.
    // (DOMParser output is an inert document; nothing in it runs until imported.)
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const removed = sanitizeSvg(doc.documentElement);
    if (removed.length) console.warn(`skin "${manifest.name}": removed unsafe markup`, removed);
    this.root = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
    this.root.removeAttribute("width");
    this.root.removeAttribute("height");
    container.replaceChildren(this.root);

    for (const [name, spec] of Object.entries(manifest.parts)) {
      this.parts.set(name, this.posable(spec.id, spec.pivot));
    }
    for (const chain of manifest.chains) {
      const joints: Posable[] = [];
      for (let i = 0; i < chain.joints; i++) joints.push(this.posable(`${chain.prefix}-${i}`, [0, 0]));
      this.chainJoints.push(joints);
    }

    const eyeGroups = manifest.eyes.groups.map((id) => this.byId<SVGGElement>(id));
    this.eyeStates = new Map(
      manifest.eyes.states.map((s) => [s, eyeGroups.map((g) => g.querySelector<SVGGElement>(`.eyes-${s}`)!)]),
    );
    this.looks = eyeGroups.map((g) => g.querySelector<SVGGElement>(`.${manifest.eyes.look}`)!);
    const mouth = this.byId<SVGGElement>(manifest.mouth.group);
    this.mouthStates = new Map(
      manifest.mouth.states.map((s) => [s, [...mouth.querySelectorAll<SVGGraphicsElement>(`.mouth-${s}`)]]),
    );
  }

  static async load(baseUrl: string, container: HTMLElement): Promise<Skin> {
    const manifest: SkinManifest = await (await fetch(`${baseUrl}/manifest.json`)).json();
    const svg = await (await fetch(`${baseUrl}/${manifest.svg}`)).text();
    return new Skin(manifest, container, svg);
  }

  private byId<T extends Element>(id: string): T {
    const el = this.root.querySelector<T>(`#${CSS.escape(id)}`);
    if (!el) throw new Error(`skin "${this.manifest.name}" has no element #${id}`);
    return el;
  }

  private posable(id: string, pivot: [number, number]): Posable {
    const el = this.byId<SVGGraphicsElement>(id);
    // Strip the rotate(...) the generator leaves as a placeholder; keep the rest.
    const base = (el.getAttribute("transform") ?? "").replace(/\s*rotate\([^)]*\)/, "").trim();
    return { el, base, pivot };
  }

  private apply(p: Posable, rotDeg: number, dx = 0, dy = 0) {
    const [px, py] = p.pivot;
    p.el.setAttribute(
      "transform",
      `${p.base} translate(${dx.toFixed(2)},${dy.toFixed(2)}) rotate(${rotDeg.toFixed(2)} ${px} ${py})`,
    );
  }

  pose(part: "head" | "armL" | "armR" | "ahoge", rotDeg: number, dx = 0, dy = 0) {
    this.apply(this.parts.get(part)!, rotDeg, dx, dy);
  }

  /** Physics angles are radians; see cpp/physics/src/exports.cpp for the sign. */
  poseChain(chain: number, anglesRad: number[]) {
    this.chainJoints[chain]?.forEach((j, i) => this.apply(j, (-anglesRad[i] * 180) / Math.PI));
  }

  setEyes(state: string) {
    if (state === this.current.eyes || !this.eyeStates.has(state)) return;
    for (const [s, els] of this.eyeStates) for (const el of els) el.style.display = s === state ? "" : "none";
    this.current.eyes = state;
  }

  setMouth(state: string) {
    if (state === this.current.mouth || !this.mouthStates.has(state)) return;
    for (const [s, els] of this.mouthStates) for (const el of els) el.style.display = s === state ? "" : "none";
    this.current.mouth = state;
  }

  /** Move the irises toward a direction; dx, dy in [-1, 1]. */
  look(dx: number, dy: number) {
    const r = this.manifest.eyes.lookRange;
    for (const g of this.looks) g.setAttribute("transform", `translate(${(dx * r).toFixed(2)},${(dy * r).toFixed(2)})`);
  }

  setBlush(opacity: number) {
    for (const id of this.manifest.blush) this.byId<SVGElement>(id).setAttribute("opacity", opacity.toFixed(2));
  }

  setFx(active: string[]) {
    for (const id of this.manifest.fx) this.byId<SVGElement>(id).style.display = active.includes(id) ? "" : "none";
  }
}

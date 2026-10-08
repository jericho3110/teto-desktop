// Typed wrappers around physics.wasm (C++ compiled with clang): the hair
// spring chains and the particle effects share ONE module instance and
// therefore one linear memory.
// The module is freestanding: it imports nothing, so the import object is {}.

interface PhysicsExports {
  memory: WebAssembly.Memory;
  phys_init(chains: number, joints: number, stiffness: number, damping: number, falloff: number): number;
  phys_step_chain(chain: number, dt: number, ax: number, ay: number, gravity: number): void;
  phys_impulse(chain: number, strength: number): void;
  phys_angle(chain: number, joint: number): number;
  fx_init(seed: number): number;
  fx_burst(kind: number, x: number, y: number, count: number): number;
  fx_stream(kind: number, rate: number, x: number, y: number): void;
  fx_step(dt: number): void;
  fx_capacity(): number;
  fx_field(which: number): number;
}

/** Load physics.wasm once; both wrappers below use the same exports. */
export async function loadPhysics(url: string): Promise<PhysicsExports> {
  // instantiateStreaming compiles while downloading; needs Content-Type application/wasm.
  const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {});
  return instance.exports as unknown as PhysicsExports;
}

export class HairPhysics {
  private x: PhysicsExports;
  private chains: { joints: number; mirror: boolean }[];
  private gravity: number;

  constructor(
    x: PhysicsExports,
    chains: { joints: number; mirror: boolean }[],
    cfg: { stiffness: number; damping: number; falloff: number; gravity: number },
  ) {
    this.x = x;
    this.chains = chains;
    this.gravity = cfg.gravity;
    const joints = Math.max(...chains.map((c) => c.joints));
    x.phys_init(chains.length, joints, cfg.stiffness, cfg.damping, cfg.falloff);
  }

  /** ax, ay: how the head accelerated this frame, in px/s². */
  step(dt: number, ax: number, ay: number): number[][] {
    return this.chains.map((c, i) => {
      // A mirrored chain's local x axis points the other way.
      this.x.phys_step_chain(i, dt, c.mirror ? -ax : ax, ay, this.gravity);
      return Array.from({ length: c.joints }, (_, j) => this.x.phys_angle(i, j));
    });
  }

  impulse(strength: number) {
    this.chains.forEach((c, i) => this.x.phys_impulse(i, c.mirror ? -strength : strength));
  }
}

export type EffectKind = "sparkle" | "heart" | "sweat" | "zzz";
const KIND: Record<EffectKind, number> = { sparkle: 0, heart: 1, sweat: 2, zzz: 3 };

/**
 * The C++ particle system. The particle arrays live in wasm memory; we
 * keep typed-array VIEWS of them (no copies). That's only safe because
 * the C++ side never grows memory: growth would detach these views.
 */
export class Effects {
  private x: PhysicsExports;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly kind: Uint8Array;

  constructor(x: PhysicsExports, seed = Date.now() >>> 0) {
    this.x = x;
    x.fx_init(seed);
    const n = x.fx_capacity();
    const view = (field: number) => new Float32Array(x.memory.buffer, x.fx_field(field), n);
    this.px = view(0);
    this.py = view(1);
    this.size = view(2);
    this.alpha = view(3);
    this.kind = new Uint8Array(x.memory.buffer, x.fx_field(4), n);
  }

  burst(kind: EffectKind, x: number, y: number, count: number) { this.x.fx_burst(KIND[kind], x, y, count); }
  stream(kind: EffectKind, rate: number, x = 0, y = 0) { this.x.fx_stream(KIND[kind], rate, x, y); }
  step(dt: number) { this.x.fx_step(dt); }
}

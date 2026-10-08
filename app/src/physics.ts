// Thin typed wrapper around physics.wasm (C++ compiled with clang).
// The module is freestanding: it imports nothing, so the import object is {}.

interface PhysicsExports {
  phys_init(chains: number, joints: number, stiffness: number, damping: number, falloff: number): number;
  phys_step_chain(chain: number, dt: number, ax: number, ay: number, gravity: number): void;
  phys_impulse(chain: number, strength: number): void;
  phys_angle(chain: number, joint: number): number;
}

export class HairPhysics {
  private constructor(
    private x: PhysicsExports,
    private chains: { joints: number; mirror: boolean }[],
    private gravity: number,
  ) {}

  static async load(
    url: string,
    chains: { joints: number; mirror: boolean }[],
    cfg: { stiffness: number; damping: number; falloff: number; gravity: number },
  ): Promise<HairPhysics> {
    // instantiateStreaming compiles while downloading; needs Content-Type application/wasm.
    const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {});
    const x = instance.exports as unknown as PhysicsExports;
    const joints = Math.max(...chains.map((c) => c.joints));
    x.phys_init(chains.length, joints, cfg.stiffness, cfg.damping, cfg.falloff);
    return new HairPhysics(x, chains, cfg.gravity);
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

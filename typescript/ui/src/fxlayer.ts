// Draws the C++ particles on a transparent <canvas> above Teto. The
// simulation runs in wasm; this file only reads the shared arrays and paints.
import type { Effects } from "./physics";

const COLORS = ["#ffd84a", "#ff6f8e", "#3d9be0", "#6b7aa8"]; // sparkle, heart, sweat, zzz

export class FxLayer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement, readonly effects: Effects) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize() {
    // Match the canvas's pixel buffer to the screen's pixel density so
    // shapes stay crisp at 125%/150% Windows scaling.
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(dt: number) {
    this.effects.step(dt);
    const { ctx } = this;
    const { px, py, size, alpha, kind } = this.effects;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = 0; i < px.length; i++) {
      const a = alpha[i];
      if (a <= 0.01) continue; // free slots have alpha 0
      ctx.globalAlpha = Math.min(1, a);
      ctx.fillStyle = COLORS[kind[i]] ?? "#fff";
      const s = size[i];
      switch (kind[i]) {
        case 0: star(ctx, px[i], py[i], s); break;
        case 1: heart(ctx, px[i], py[i], s); break;
        case 2: drop(ctx, px[i], py[i], s); break;
        case 3:
          ctx.font = `700 ${Math.round(s * 1.8)}px "Segoe UI", sans-serif`;
          ctx.fillText("z", px[i], py[i]);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.beginPath();
  for (let k = 0; k < 8; k++) {
    const rad = k % 2 === 0 ? r : r * 0.35;
    const ang = (k * Math.PI) / 4;
    c.lineTo(x + rad * Math.sin(ang), y - rad * Math.cos(ang));
  }
  c.closePath();
  c.fill();
}

function heart(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  c.beginPath();
  c.moveTo(x, y + s * 0.35);
  c.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.4, y - s, x, y - s * 0.4);
  c.bezierCurveTo(x + s * 0.4, y - s, x + s, y - s * 0.4, x, y + s * 0.35);
  c.fill();
}

function drop(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  c.beginPath();
  c.moveTo(x, y - s * 1.6);
  c.quadraticCurveTo(x + s, y, x, y + s);
  c.quadraticCurveTo(x - s, y, x, y - s * 1.6);
  c.fill();
}

// The animation loop: every frame, read the Mind (what she's doing),
// decide the pose (face.ts), and push it into the skin and physics.
import type { HairPhysics } from "./physics";
import type { Skin } from "./skin";
import type { Emotion } from "./types";
import {
  approach, currentFace, emotionDuration, eyesFor, mouthFor, newMind, nextBlinkGap, type Mind,
} from "./face";

export class Animator {
  readonly mind: Mind = newMind(performance.now());
  /** Cursor in window CSS pixels (from the native C module), or null. */
  cursor: { x: number; y: number } | null = null;

  private last = performance.now();
  private nextBlink = this.last + 2000;
  private waveUntil = 0;
  // smoothed pose values
  private tilt = 0;
  private drop = 0;
  private arms = 0;
  private lookX = 0;
  private lookY = 0;
  // head anchor motion for physics (screen px)
  private win = { x: 0, y: 0 };
  private prevPos: { x: number; y: number } | null = null;
  private prevVel = { x: 0, y: 0 };
  private acc = { x: 0, y: 0 };

  constructor(
    private skin: Skin,
    private physics: HairPhysics | null, // null if the wasm failed to load: she still works, hair stays still
    private stage: HTMLElement, // the element the SVG lives in (for hop + eye tracking)
  ) {}

  start() {
    const loop = (t: number) => {
      this.frame(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---- inputs ------------------------------------------------------------
  setThinking(on: boolean) { this.mind.thinking = on; }
  talk() { this.mind.talkingUntil = performance.now() + 260; }
  emote(emotion: Emotion, intensity = 0.6) {
    this.mind.emotion = emotion;
    this.mind.emotionUntil = performance.now() + emotionDuration(intensity);
    if (emotion === "excited" || emotion === "happy") this.physics?.impulse(1.5 * intensity);
  }
  sleep(on: boolean) { this.mind.sleeping = on; }
  wave(ms = 2500) { this.waveUntil = performance.now() + ms; }
  poke(strength = 2.2) { this.physics?.impulse(strength); }
  windowMoved(x: number, y: number) { this.win = { x, y }; }

  // ---- the frame ---------------------------------------------------------
  private frame(now: number) {
    const dt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;
    const m = this.mind;
    m.now = now;

    if (now >= this.nextBlink) {
      m.blinkUntil = now + 130;
      this.nextBlink = now + nextBlinkGap(Math.random());
    }

    const face = currentFace(m);
    const expr = this.skin.manifest.expressions[face];
    this.skin.setEyes(eyesFor(expr, m));
    this.skin.setMouth(mouthFor(expr, m));
    this.skin.setBlush(expr.blush);
    this.skin.setFx(expr.fx);

    const s = now / 1000;
    // Idle "breathing": slow bob + gentle sway; sleeping breathes slower and deeper.
    const bob = m.sleeping ? Math.sin(s * 0.9) * 2.5 : Math.sin(s * 2.1) * 1.6;
    const sway = Math.sin(s * 0.7) * 1.5;
    this.tilt = approach(this.tilt, expr.headTilt + sway, 6, dt);
    this.drop = approach(this.drop, expr.headDrop ?? 0, 6, dt);
    this.skin.pose("head", this.tilt, 0, bob + this.drop);

    const hop = expr.hop ? -Math.abs(Math.sin(s * 9)) * 10 : 0;
    this.stage.style.transform = `translateY(${hop.toFixed(2)}px)`;

    const thinkingWiggle = face === "thinking" ? Math.sin(s * 7) * 12 : 0;
    this.skin.pose("ahoge", expr.ahoge + Math.sin(s * 3) * 4 + thinkingWiggle);

    this.arms = approach(this.arms, expr.arms ?? 0, 8, dt);
    const armSway = Math.sin(s * 1.3) * 2;
    this.skin.pose("armL", this.arms + armSway);
    const waving = now < this.waveUntil;
    this.skin.pose("armR", waving ? -95 + Math.sin(s * 12) * 25 : -this.arms - armSway);

    this.updateLook(expr.lookUp === true, dt);
    this.updateHair(dt, bob + this.drop + hop);
  }

  private updateLook(lookUp: boolean, dt: number) {
    let tx = 0, ty = 0;
    if (lookUp) {
      tx = 0.4; ty = -1;
    } else if (this.cursor) {
      // Direction from the face centre to the cursor, softened with distance.
      const r = this.stage.getBoundingClientRect();
      const fx = r.left + r.width / 2, fy = r.top + r.height * 0.42;
      const dx = this.cursor.x - fx, dy = this.cursor.y - fy;
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, d / 250);
      tx = (dx / d) * reach; ty = (dy / d) * reach;
    }
    this.lookX = approach(this.lookX, tx, 10, dt);
    this.lookY = approach(this.lookY, ty, 10, dt);
    this.skin.look(this.lookX, this.lookY);
  }

  /** Feed the head's acceleration (window drag + bob + head tilt) to the hair. */
  private updateHair(dt: number, headY: number) {
    if (!this.physics || dt <= 0) return;
    // Rotating the head around its pivot (y=200) moves the drill anchors (y~100) sideways.
    const tiltShift = Math.sin((this.tilt * Math.PI) / 180) * 100;
    const pos = { x: this.win.x - tiltShift, y: this.win.y + headY };
    if (this.prevPos) {
      const vel = { x: (pos.x - this.prevPos.x) / dt, y: (pos.y - this.prevPos.y) / dt };
      // Light smoothing: OS move events arrive in bursts, raw acceleration is spiky.
      this.acc.x = approach(this.acc.x, (vel.x - this.prevVel.x) / dt, 25, dt);
      this.acc.y = approach(this.acc.y, (vel.y - this.prevVel.y) / dt, 25, dt);
      this.prevVel = vel;
    }
    this.prevPos = pos;
    const angles = this.physics.step(dt, this.acc.x, this.acc.y);
    angles.forEach((a, i) => this.skin.poseChain(i, a));
  }
}

// Pure decision logic for the animator: given what Teto is doing right
// now, which face, eyes and mouth should she show? No DOM, no clocks:
// time comes in as `now`, so tests can drive it (see face.test.ts).
// Only `import type` here, so Node can run this file by stripping types.
import type { Emotion, Expression, Face } from "./types";

export interface Mind {
  now: number; // ms
  thinking: boolean; // brain is working on a prompt
  talkingUntil: number; // mouth flaps until this time (extended by each text chunk)
  sleeping: boolean;
  emotion: Emotion;
  emotionUntil: number;
  blinkUntil: number;
}

export const newMind = (now = 0): Mind => ({
  now, thinking: false, talkingUntil: 0, sleeping: false,
  emotion: "neutral", emotionUntil: 0, blinkUntil: 0,
});

/** Priority: asleep > a fresh emotion > talking > thinking > neutral. */
export function currentFace(m: Mind): Face {
  if (m.sleeping) return "sleeping";
  if (m.emotion !== "neutral" && m.emotionUntil > m.now) return m.emotion;
  if (m.talkingUntil > m.now) return "neutral";
  if (m.thinking) return "thinking";
  return "neutral";
}

export function eyesFor(expr: Expression, m: Mind): string {
  // Blinking only makes sense over open eyes.
  return expr.eyes === "open" && m.blinkUntil > m.now ? "closed" : expr.eyes;
}

/** While talking, alternate an open mouth with the face's own mouth (~5.5 flaps/s). */
export function mouthFor(expr: Expression, m: Mind): string {
  if (m.talkingUntil <= m.now) return expr.mouth;
  return Math.floor(m.now / 90) % 2 === 0 ? "talk" : expr.mouth === "grin" ? "grin" : "smile";
}

/** Stronger emotions last longer: 2.5 s .. 6.5 s. */
export const emotionDuration = (intensity: number) => 2500 + 4000 * Math.min(1, Math.max(0, intensity));

/** Random gap until the next blink: people blink every 2-6 s. */
export const nextBlinkGap = (rand: number) => 2000 + rand * 4000;

/**
 * Frame-rate-independent smoothing: move `current` toward `target` so that
 * after one second only e^-rate of the gap remains, whatever the fps.
 */
export function approach(current: number, target: number, rate: number, dtSec: number): number {
  return target + (current - target) * Math.exp(-rate * dtSec);
}

// Run: npm test   (Node runs .ts directly by stripping the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Expression } from "./types";
import { approach, currentFace, emotionDuration, eyesFor, mouthFor, newMind } from "./face.ts";

const open: Expression = { eyes: "open", mouth: "smile", blush: 0, fx: [], headTilt: 0, ahoge: 0 };
const happy: Expression = { ...open, eyes: "happy", mouth: "grin" };

test("face priority: sleeping > emotion > talking > thinking > neutral", () => {
  const m = { ...newMind(1000), thinking: true };
  assert.equal(currentFace(m), "thinking");
  m.talkingUntil = 2000;
  assert.equal(currentFace(m), "neutral", "talking hides the thinking face");
  m.emotion = "happy"; m.emotionUntil = 1500;
  assert.equal(currentFace(m), "happy");
  m.sleeping = true;
  assert.equal(currentFace(m), "sleeping");
});

test("emotions expire", () => {
  const m = { ...newMind(5000), emotion: "sad" as const, emotionUntil: 4999 };
  assert.equal(currentFace(m), "neutral");
});

test("blinks close open eyes only", () => {
  const m = { ...newMind(100), blinkUntil: 200 };
  assert.equal(eyesFor(open, m), "closed");
  assert.equal(eyesFor(happy, m), "happy", "^^ eyes don't blink");
  m.now = 300;
  assert.equal(eyesFor(open, m), "open");
});

test("mouth flaps while talking, then returns to the expression", () => {
  const m = { ...newMind(0), talkingUntil: 1000 };
  const shapes = new Set([0, 90, 180, 270].map((t) => mouthFor(open, { ...m, now: t })));
  assert.deepEqual([...shapes].sort(), ["smile", "talk"]);
  assert.equal(mouthFor(happy, { ...m, now: 90 }), "grin", "a happy face keeps grinning between flaps");
  assert.equal(mouthFor(open, { ...m, now: 1000 }), "smile");
});

test("emotion duration grows with intensity and is clamped", () => {
  assert.equal(emotionDuration(0), 2500);
  assert.equal(emotionDuration(1), 6500);
  assert.equal(emotionDuration(7), 6500);
});

test("approach is frame-rate independent", () => {
  let a = 0, b = 0;
  for (let i = 0; i < 60; i++) a = approach(a, 10, 3, 1 / 60); // 60 fps for 1 s
  for (let i = 0; i < 30; i++) b = approach(b, 10, 3, 1 / 30); // 30 fps for 1 s
  assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  assert.ok(Math.abs(a - 10 * (1 - Math.exp(-3))) < 1e-9);
});

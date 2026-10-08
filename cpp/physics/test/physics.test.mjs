// Loads the real physics.wasm in Node, the same way the webview does.
// Run: npm test  (after npm run build)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bytes = await readFile(new URL("../dist/physics.wasm", import.meta.url));
// No imports object: the module is freestanding and needs nothing from JS.
const { instance } = await WebAssembly.instantiate(bytes, {});
const p = instance.exports;

const angles = (chain, n) => Array.from({ length: n }, (_, j) => p.phys_angle(chain, j));
const run = (frames, ax = 0) => { for (let i = 0; i < frames; i++) p.phys_step_chain(0, 1 / 60, ax, 0, 900); };

test("exports only what we declared", () => {
  assert.deepEqual(Object.keys(p).sort(), [
    "fx_alive", "fx_arena_used", "fx_burst", "fx_capacity", "fx_field", "fx_init", "fx_step", "fx_stream",
    "memory", "phys_angle", "phys_impulse", "phys_init", "phys_step_chain",
  ]);
  assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(bytes)).length, 0, "imports nothing");
});

test("init clamps the chain count", () => {
  assert.equal(p.phys_init(99, 7, 60, 12, 0.8), 4);
  assert.equal(p.phys_init(2, 7, 60, 12, 0.8), 2);
});

test("at rest, hair stays at rest", () => {
  p.phys_init(2, 7, 60, 12, 0.8);
  run(120);
  for (const a of angles(0, 7)) assert.ok(Math.abs(a) < 1e-6);
});

test("moving the head left swings the hair the other way, then it settles", () => {
  p.phys_init(1, 7, 60, 12, 0.8);
  run(10, -3000); // anchor accelerates toward -x
  const swung = angles(0, 7);
  assert.ok(swung.every((a) => a > 0), `all joints swing positive: ${swung}`);
  assert.ok(swung[6] > swung[0], "tip swings more than root");
  run(600); // 10 s with no motion: damping wins
  for (const a of angles(0, 7)) assert.ok(Math.abs(a) < 0.01, `settled: ${a}`);
});

test("huge input never folds the hair through itself", () => {
  p.phys_init(1, 7, 60, 12, 0.8);
  run(60, 1e7);
  for (const a of angles(0, 7)) assert.ok(Math.abs(a) <= 1.2 + 1e-6 && Number.isFinite(a));
});

test("impulse and out-of-range access are safe", () => {
  p.phys_init(1, 7, 60, 12, 0.8);
  p.phys_impulse(0, 2);
  p.phys_impulse(9, 2); // ignored
  run(1);
  assert.ok(p.phys_angle(0, 0) !== 0);
  assert.equal(p.phys_angle(9, 0), 0);
  assert.equal(p.phys_angle(0, 99), 0);
});

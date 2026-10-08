// Tests for the particle system's MEMORY behavior, on the real physics.wasm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bytes = await readFile(new URL("../dist/physics.wasm", import.meta.url));
const SPARKLE = 0, HEART = 1, SWEAT = 2, ZZZ = 3;

// A fresh instance per test: each gets its own linear memory.
const load = async () => (await WebAssembly.instantiate(bytes, {})).instance.exports;
const step = (x, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) x.fx_step(1 / 60); };

test("calls before fx_init are harmless (no null dereference)", async () => {
  const x = await load();
  x.fx_step(1 / 60);
  assert.equal(x.fx_burst(SPARKLE, 0, 0, 10), 0);
  assert.equal(x.fx_alive(), 0);
});

test("the emitters are placement-new'ed into the arena", async () => {
  const x = await load();
  const used = x.fx_init(1);
  assert.ok(used > 0 && used <= 4096, `arena bytes used: ${used}`);
  assert.equal(x.fx_arena_used(), used);
  assert.equal(x.fx_init(1), used, "fx_init resets the arena: same usage, no growth");
});

test("the pool is fixed-size: it fills up and then refuses", async () => {
  const x = await load();
  x.fx_init(1);
  const cap = x.fx_capacity();
  assert.equal(x.fx_burst(SPARKLE, 100, 100, cap + 50), cap, "only `capacity` particles fit");
  assert.equal(x.fx_alive(), cap);
  assert.equal(x.fx_burst(HEART, 0, 0, 5), 0, "pool exhausted: nothing allocated, nothing crashes");
});

test("expired particles return to the free list and slots are reused", async () => {
  const x = await load();
  x.fx_init(1);
  const cap = x.fx_capacity();
  x.fx_burst(SWEAT, 0, 0, cap);
  step(x, 1.5); // sweat lives < 1 s
  assert.equal(x.fx_alive(), 0, "all released");
  assert.equal(x.fx_burst(ZZZ, 0, 0, cap), cap, "every slot reusable");
});

test("JavaScript reads C++ memory directly: a zero-copy view", async () => {
  const x = await load();
  x.fx_init(7);
  const cap = x.fx_capacity();
  const ys = new Float32Array(x.memory.buffer, x.fx_field(1), cap); // a VIEW, not a copy
  const kinds = new Uint8Array(x.memory.buffer, x.fx_field(4), cap);
  x.fx_burst(ZZZ, 50, 300, 1);
  const i = kinds.findIndex((k) => k === ZZZ);
  assert.ok(i >= 0);
  const before = ys[i];
  step(x, 0.5);
  assert.ok(ys[i] < before, "the same view sees C++ move the particle up (no re-reading, no copying)");
});

test("memory never grows (so JS views never get detached)", async () => {
  const x = await load();
  const size = x.memory.buffer.byteLength;
  x.fx_init(3);
  for (let n = 0; n < 50; n++) { x.fx_burst(n % 4, 0, 0, 20); step(x, 0.2); }
  assert.equal(x.memory.buffer.byteLength, size);
});

test("streams emit at their rate; polymorphic updates behave per kind", async () => {
  const x = await load();
  x.fx_init(5);
  x.fx_stream(SPARKLE, 30, 100, 100); // 30 per second
  step(x, 0.5);
  const alive = x.fx_alive();
  assert.ok(alive >= 12 && alive <= 16, `~15 sparkles after 0.5 s, got ${alive}`);
  x.fx_stream(SPARKLE, 0, 0, 0);

  // Sweat falls (gravity in Sweat::update), Zzz rises (Zzz::update): same loop, different code.
  x.fx_init(5);
  const cap = x.fx_capacity();
  const ys = new Float32Array(x.memory.buffer, x.fx_field(1), cap);
  const kinds = new Uint8Array(x.memory.buffer, x.fx_field(4), cap);
  x.fx_burst(SWEAT, 0, 200, 1);
  x.fx_burst(ZZZ, 0, 200, 1);
  step(x, 0.55);
  const sweat = kinds.indexOf(SWEAT), zzz = kinds.indexOf(ZZZ);
  assert.ok(ys[sweat] > 200, `sweat fell: ${ys[sweat]}`);
  assert.ok(ys[zzz] < 200, `zzz rose: ${ys[zzz]}`);
});

test("bad input is refused at the boundary", async () => {
  const x = await load();
  x.fx_init(1);
  assert.equal(x.fx_burst(99, 0, 0, 5), 0);
  assert.equal(x.fx_burst(-1, 0, 0, 5), 0);
  assert.equal(x.fx_field(42), 0);
  x.fx_stream(99, 10, 0, 0); // ignored
  x.fx_stream(SPARKLE, 1e9, 0, 0); // clamped to 120/s
  for (let n = 0; n < 6; n++) x.fx_step(1 / 60); // exactly 0.1 s (a float-summing loop can run 7 frames)
  assert.equal(x.fx_alive(), 12, "120/s for 0.1 s: the absurd rate was clamped");
});

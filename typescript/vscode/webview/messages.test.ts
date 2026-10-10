// Run: npm test   (Node runs .ts directly by stripping the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMessage } from "./messages.ts";

test("accepts every well-formed message", () => {
  assert.deepEqual(parseMessage({ type: "typing" }), { type: "typing" });
  assert.deepEqual(parseMessage({ type: "wave" }), { type: "wave" });
  assert.deepEqual(parseMessage({ type: "sleep", on: true }), { type: "sleep", on: true });
  assert.deepEqual(parseMessage({ type: "emote", emotion: "happy", intensity: 0.7 }),
    { type: "emote", emotion: "happy", intensity: 0.7 });
});

test("clamps intensity and defaults a missing one", () => {
  assert.equal((parseMessage({ type: "emote", emotion: "sad", intensity: 9 }) as { intensity: number }).intensity, 1);
  assert.equal((parseMessage({ type: "emote", emotion: "sad", intensity: Number.NaN }) as { intensity: number }).intensity, 0.6);
});

test("drops anything unexpected", () => {
  for (const bad of [null, "wave", 42, {}, { type: "eval" }, { type: "sleep", on: "yes" },
    { type: "emote", emotion: "__proto__" }, { type: "emote", emotion: "angry" }]) {
    assert.equal(parseMessage(bad), null, JSON.stringify(bad));
  }
});

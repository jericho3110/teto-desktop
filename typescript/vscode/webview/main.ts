// The page inside VS Code's sidebar: the desktop UI's Teto, driven by editor events.
// Reuses typescript/ui unchanged: skin, animator, drill physics and particles.
import { Animator } from "../../ui/src/animator.ts";
import { FxLayer } from "../../ui/src/fxlayer.ts";
import { Effects, HairPhysics, loadPhysics } from "../../ui/src/physics.ts";
import { Skin } from "../../ui/src/skin.ts";
import type { Emotion as UiEmotion } from "../../ui/src/types.ts";
import { parseMessage } from "./messages.ts";

type Physics = Awaited<ReturnType<typeof loadPhysics>>;

// The host puts resource URLs on our <script> tag (they're webview-only URLs).
const urls = (document.currentScript as HTMLScriptElement).dataset;

async function physics(url: string): Promise<Physics | null> {
  try {
    return await loadPhysics(url);
  } catch {
    // instantiateStreaming needs Content-Type application/wasm; compile from bytes instead.
    try {
      const bytes = await (await fetch(url)).arrayBuffer();
      return (await WebAssembly.instantiate(bytes, {})).instance.exports as unknown as Physics;
    } catch {
      return null; // she still works; the drills just don't swing
    }
  }
}

async function main() {
  const stage = document.getElementById("character")!;
  const skin = await Skin.load(urls.skin!, stage);
  const wasm = await physics(urls.wasm!);
  const hair = wasm ? new HairPhysics(wasm, skin.manifest.chains, skin.manifest.physics) : null;
  const fx = wasm ? new FxLayer(document.querySelector<HTMLCanvasElement>("#fx")!, new Effects(wasm)) : null;
  const teto = new Animator(skin, hair, stage, fx);
  teto.start();
  teto.wave();

  // Her eyes follow the mouse while it's over the panel.
  addEventListener("mousemove", (e) => (teto.cursor = { x: e.clientX, y: e.clientY }));
  document.addEventListener("mouseleave", () => (teto.cursor = null));
  stage.addEventListener("click", () => {
    teto.poke();
    teto.emote("happy", 0.5);
  });

  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  addEventListener("message", (event) => {
    const msg = parseMessage(event.data);
    if (!msg) return;
    switch (msg.type) {
      case "typing":
        // The thinking face alone is subtle: also move her mouth and nudge the drills.
        teto.setThinking(true);
        teto.talk();
        teto.poke(0.35);
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => teto.setThinking(false), 2500);
        break;
      case "emote": {
        const emotion: UiEmotion = msg.emotion; // compile-time check: our list matches the UI's
        teto.emote(emotion, msg.intensity);
        break;
      }
      case "sleep":
        teto.sleep(msg.on);
        break;
      case "wave":
        teto.wave();
        break;
    }
  });
}

main().catch((err) => {
  document.body.textContent = `Teto couldn't load: ${err instanceof Error ? err.message : String(err)}`;
});

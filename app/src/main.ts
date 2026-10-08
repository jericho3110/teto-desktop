// Entry point: load the pieces, then wire brain events, native events
// and user input to the animator, bubble and quirks.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Animator } from "./animator";
import { Brain } from "./brain";
import { Bubble } from "./bubble";
import { CommandBar } from "./commandbar";
import { HairPhysics } from "./physics";
import { Quirks } from "./quirks";
import { Skin } from "./skin";
import type { BrainEvent } from "./types";

interface Config { brainUrl: string; token: string; skin: string }

const SLEEP_AFTER_MS = 5 * 60_000;

async function loadConfig(): Promise<Config> {
  if (isTauri()) return invoke<Config>("get_config");
  // Plain browser (npm run dev without Tauri): pass ?token=... yourself.
  const q = new URLSearchParams(location.search);
  return { brainUrl: q.get("brain") ?? "http://127.0.0.1:47800", token: q.get("token") ?? "", skin: q.get("skin") ?? "teto-chibi" };
}

async function main() {
  const cfg = await loadConfig();
  const stage = document.querySelector<HTMLElement>("#character")!;
  const skin = await Skin.load(`/skins/${cfg.skin}`, stage);
  const physics = await HairPhysics.load("/physics.wasm", skin.manifest.chains, skin.manifest.physics).catch((err) => {
    console.warn("hair physics unavailable", err);
    return null;
  });
  const animator = new Animator(skin, physics, stage);
  animator.start();

  const bubble = new Bubble(document.querySelector("#bubble")!);
  const brain = new Brain(cfg.brainUrl, cfg.token);
  let busy = false;
  const bar = new CommandBar(
    document.querySelector("#bar")!,
    async (text) => {
      animator.sleep(false);
      const problem = await brain.prompt(text);
      if (problem) {
        bubble.say(problem);
        animator.emote("worried");
      }
    },
    () => void brain.cancel(),
  );
  bar.setBusy(false);

  const quirks = new Quirks({
    say: (text, ms) => { bubble.say(text, ms); animator.talk(); },
    emote: (e, i) => animator.emote(e, i),
    bounce: (s) => animator.poke(s),
    wave: () => animator.wave(),
    isBusy: () => busy,
  });

  // ---- brain → UI ----------------------------------------------------------
  let warnedOffline = false;
  brain.connect(
    (ev: BrainEvent) => {
      switch (ev.type) {
        case "status":
          busy = ev.state === "thinking";
          animator.setThinking(busy);
          bar.setBusy(busy);
          if (busy) bubble.thinking();
          break;
        case "text_delta":
          bubble.stream(ev.text);
          animator.talk();
          break;
        case "tool_use":
          bubble.toolStatus(`🔧 ${ev.tool}: ${ev.summary}`);
          break;
        case "permission_request":
          animator.emote("confused", 0.2);
          bubble.ask(ev.id, ev.tool, ev.summary, (allow) => void brain.answer(ev.id, allow));
          break;
        case "permission_expired":
          bubble.removeAsk(ev.id);
          break;
        case "reply_done":
          bubble.finish(ev.text);
          if (ev.is_error) animator.emote("worried");
          quirks.emit("reply", ev.text);
          break;
        case "mood":
          animator.emote(ev.emotion, ev.intensity);
          quirks.emit("mood", ev);
          break;
        case "reminder":
          bubble.say(`⏰ ${ev.text}`, 20_000);
          animator.wave(4000);
          animator.emote("excited", 0.8);
          break;
      }
    },
    (up) => {
      if (up) warnedOffline = false;
      else if (!warnedOffline) {
        warnedOffline = true;
        bubble.say("I can't reach my brain... (is the Go daemon running?)");
        animator.emote("worried");
      }
    },
  );

  // ---- pointer: drag to move, click to poke --------------------------------
  let down: { x: number; y: number } | null = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.button === 0) down = { x: e.screenX, y: e.screenY };
  });
  stage.addEventListener("pointermove", (e) => {
    if (down && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
      down = null;
      if (isTauri()) void getCurrentWindow().startDragging();
    }
  });
  stage.addEventListener("pointerup", () => {
    if (!down) return;
    down = null;
    animator.sleep(false);
    animator.poke();
    bar.toggle();
    quirks.emit("poke");
  });

  // ---- native events from Rust + the C module ------------------------------
  if (isTauri()) {
    const win = getCurrentWindow();
    const scale = await win.scaleFactor();
    const p0 = await win.outerPosition();
    animator.windowMoved(p0.x / scale, p0.y / scale);
    await win.onMoved(({ payload }) => animator.windowMoved(payload.x / scale, payload.y / scale));

    // Click-through: the window ignores the mouse except over "solid" things
    // (her body, the bubble, the bar). The webview gets no mouse events
    // while ignoring, so the native side reports the cursor instead.
    let ignoring: boolean | null = null;
    await listen<{ x: number; y: number }>("native://cursor", ({ payload }) => {
      animator.cursor = payload;
      const el = document.elementFromPoint(payload.x, payload.y);
      const solid = !!el?.closest("[data-solid]");
      if (ignoring !== !solid) {
        ignoring = !solid;
        void win.setIgnoreCursorEvents(ignoring);
      }
    });

    await listen<{ ms: number }>("native://idle", ({ payload }) => {
      if (payload.ms >= SLEEP_AFTER_MS && !animator.mind.sleeping && !busy) {
        animator.sleep(true);
        quirks.emit("sleep");
      } else if (payload.ms < 3000 && animator.mind.sleeping) {
        animator.sleep(false);
        quirks.emit("wake");
      }
    });

    await listen("native://hotkey", () => {
      animator.sleep(false);
      bar.show();
      void win.setFocus();
    });
  }

  // Dev-only handle so tools/ui_probe.mjs can drive states for screenshots.
  // import.meta.env.DEV is false in production builds, so this is stripped.
  if (import.meta.env.DEV) Object.assign(window, { teto: { animator, bubble, bar, quirks } });

  await quirks.load("/quirks");
  quirks.emit("start");
}

main().catch((err) => {
  console.error(err);
  document.body.dataset.error = String(err);
});

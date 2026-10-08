// Quirks are plain JavaScript files in quirks/ that give Teto personality
// without touching the app's code. Each one default-exports a function
// that receives this API. They are loaded at runtime with import(), so
// adding a quirk needs no rebuild of the TypeScript.
import type { Emotion } from "./types";

export type QuirkEvent = "start" | "poke" | "reply" | "mood" | "sleep" | "wake" | "tick";

export interface QuirkAPI {
  on(event: QuirkEvent, fn: (data?: unknown) => void): void;
  say(text: string, ms?: number): void;
  emote(emotion: Emotion, intensity?: number): void;
  bounce(strength?: number): void;
  wave(): void;
  isBusy(): boolean;
}

type Listener = (data?: unknown) => void;

export class Quirks {
  private listeners = new Map<QuirkEvent, Listener[]>();

  constructor(private api: Omit<QuirkAPI, "on">) {
    // A once-a-minute heartbeat for time-based quirks.
    window.setInterval(() => this.emit("tick", new Date()), 60_000);
  }

  async load(baseUrl: string) {
    let files: string[] = [];
    try {
      files = await (await fetch(`${baseUrl}/index.json`)).json();
    } catch {
      return; // no quirks: fine
    }
    const api: QuirkAPI = { ...this.api, on: (ev, fn) => this.add(ev, fn) };
    for (const file of files) {
      try {
        // @vite-ignore: the path is only known at runtime, Vite must not bundle it.
        const mod = await import(/* @vite-ignore */ `${baseUrl}/${file}`);
        mod.default(api);
        console.info(`quirk loaded: ${file}`);
      } catch (err) {
        console.warn(`quirk ${file} failed to load`, err); // one broken quirk can't break Teto
      }
    }
  }

  private add(ev: QuirkEvent, fn: Listener) {
    this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), fn]);
  }

  emit(ev: QuirkEvent, data?: unknown) {
    for (const fn of this.listeners.get(ev) ?? []) {
      try {
        fn(data);
      } catch (err) {
        console.warn(`quirk ${ev} handler threw`, err);
      }
    }
  }
}

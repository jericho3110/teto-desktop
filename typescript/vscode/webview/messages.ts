// The messages the extension host sends to the webview, and their validation.
// No imports, so both sides (Node host and browser webview) can use it.

export const EMOTIONS = ["neutral", "happy", "excited", "sad", "worried", "confused", "smug"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export type HostMessage =
  | { type: "emote"; emotion: Emotion; intensity: number }
  | { type: "typing" }
  | { type: "sleep"; on: boolean }
  | { type: "wave" };

/** A well-formed message, or null. Anything unexpected is dropped, never acted on. */
export function parseMessage(data: unknown): HostMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case "typing":
    case "wave":
      return { type: m.type };
    case "sleep":
      return typeof m.on === "boolean" ? { type: "sleep", on: m.on } : null;
    case "emote": {
      if (!(EMOTIONS as readonly unknown[]).includes(m.emotion)) return null;
      const raw = typeof m.intensity === "number" && Number.isFinite(m.intensity) ? m.intensity : 0.6;
      return { type: "emote", emotion: m.emotion as Emotion, intensity: Math.min(1, Math.max(0, raw)) };
    }
    default:
      return null;
  }
}

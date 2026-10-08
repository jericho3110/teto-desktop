// Shared types: the skin manifest format and the brain's event protocol.
// Keep in sync with assets/skins/*/manifest.json and docs/PROTOCOL.md.

export type Emotion =
  | "neutral" | "happy" | "excited" | "sad" | "worried" | "confused" | "smug";

/** Emotions plus the "activity" faces the animator uses on its own. */
export type Face = Emotion | "sleeping" | "thinking";

export interface Expression {
  eyes: string;
  mouth: string;
  blush: number;
  fx: string[];
  headTilt: number; // degrees, + = toward her left shoulder (viewer's right)
  ahoge: number; // degrees
  headDrop?: number; // px, + = down
  hop?: boolean;
  arms?: number; // degrees both arms raise outward
  lookUp?: boolean;
}

export interface PartSpec {
  id: string;
  pivot: [number, number];
}

export interface SkinManifest {
  name: string;
  version: number;
  svg: string;
  size: [number, number];
  parts: Record<"head" | "armL" | "armR" | "ahoge", PartSpec>;
  eyes: { groups: string[]; states: string[]; look: string; lookRange: number };
  mouth: { group: string; states: string[] };
  blush: string[];
  fx: string[];
  chains: { prefix: string; joints: number; mirror: boolean }[];
  physics: { stiffness: number; damping: number; falloff: number; gravity: number };
  expressions: Record<Face, Expression>;
  credits?: string;
}

export type BrainEvent =
  | { type: "status"; state: "thinking" | "idle" }
  | { type: "text_delta"; text: string }
  | { type: "reply_done"; text: string; is_error?: boolean }
  | { type: "tool_use"; tool: string; summary: string }
  | { type: "permission_request"; id: string; tool: string; summary: string; detail?: string }
  | { type: "permission_expired"; id: string }
  | { type: "mood"; emotion: Emotion; intensity: number }
  | { type: "reminder"; text: string };

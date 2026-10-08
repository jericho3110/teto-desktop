// Client for the Go brain: Server-Sent Events in, small JSON POSTs out.
import type { BrainEvent } from "./types";

export class Brain {
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, "");
    this.token = token;
  }

  /**
   * EventSource reconnects automatically (every ~3 s) if the brain restarts,
   * so the UI survives the daemon going away and coming back.
   */
  connect(onEvent: (e: BrainEvent) => void, onConnection: (up: boolean) => void): () => void {
    // EventSource can't send headers, so the token rides in the query string.
    const es = new EventSource(`${this.url}/events?token=${encodeURIComponent(this.token)}`);
    es.onopen = () => onConnection(true);
    es.onerror = () => onConnection(false);
    es.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data) as BrainEvent);
      } catch (err) {
        console.warn("brain: bad event", err, m.data);
      }
    };
    return () => es.close();
  }

  private async post(path: string, body?: unknown): Promise<Response> {
    return fetch(this.url + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** Resolves to null on success, or a short reason she can say out loud. */
  async prompt(text: string): Promise<string | null> {
    try {
      const r = await this.post("/prompt", { text });
      if (r.ok) return null;
      if (r.status === 409) return "Wait wait, I'm still on the last thing!";
      return `My brain said ${r.status}: ${(await r.text()).trim()}`;
    } catch {
      return "I can't reach my brain... is the Go daemon running?";
    }
  }

  answer(id: string, allow: boolean) { return this.post("/permission", { id, allow }); }
  cancel() { return this.post("/cancel"); }
}

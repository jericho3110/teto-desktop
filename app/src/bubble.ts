// The speech bubble: streamed replies, a tool-status line, and
// Allow/Deny permission cards. All model text goes in via textContent,
// never innerHTML, so a reply can never inject HTML or scripts.

export class Bubble {
  private text: HTMLElement;
  private status: HTMLElement;
  private asks: HTMLElement;
  private hideTimer = 0;
  private streaming = false;
  private cards = new Map<string, HTMLElement>();

  constructor(private root: HTMLElement) {
    this.text = root.querySelector(".bubble-text")!;
    this.status = root.querySelector(".bubble-status")!;
    this.asks = root.querySelector(".bubble-asks")!;
  }

  private show() {
    window.clearTimeout(this.hideTimer);
    this.root.hidden = false;
  }

  private hideLater(ms: number) {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (this.cards.size === 0) this.root.hidden = true;
    }, ms);
  }

  /** Reading time: ~4 s plus 45 ms per character, at most 25 s. */
  static readingTime(text: string) { return Math.min(25_000, 4000 + text.length * 45); }

  thinking() {
    this.show();
    this.streaming = false;
    this.text.textContent = "…";
    this.text.classList.add("dots");
    this.status.textContent = "";
  }

  stream(delta: string) {
    this.show();
    if (!this.streaming) {
      this.streaming = true;
      this.text.textContent = "";
      this.text.classList.remove("dots");
    }
    this.text.textContent += delta;
    this.text.scrollTop = this.text.scrollHeight;
  }

  /** The final text is authoritative (some replies arrive without deltas). */
  finish(text: string) {
    this.streaming = false;
    this.say(text || "(done)");
  }

  say(text: string, ms = Bubble.readingTime(text)) {
    this.show();
    this.text.classList.remove("dots");
    this.text.textContent = text;
    this.status.textContent = "";
    this.hideLater(ms);
  }

  toolStatus(line: string) {
    this.show();
    this.status.textContent = line;
  }

  /** A permission card. Stays until answered or expired. */
  ask(id: string, tool: string, summary: string, onAnswer: (allow: boolean) => void) {
    this.show();
    const card = document.createElement("div");
    card.className = "ask";
    const title = document.createElement("div");
    title.className = "ask-title";
    title.textContent = `Can I use ${tool}?`;
    const detail = document.createElement("code");
    detail.textContent = summary;
    const allow = document.createElement("button");
    allow.textContent = "Allow";
    allow.className = "allow";
    const deny = document.createElement("button");
    deny.textContent = "Deny";
    const answer = (yes: boolean) => {
      this.removeAsk(id);
      onAnswer(yes);
    };
    allow.onclick = () => answer(true);
    deny.onclick = () => answer(false);
    const row = document.createElement("div");
    row.className = "ask-buttons";
    row.append(deny, allow);
    card.append(title, detail, row);
    this.asks.append(card);
    this.cards.set(id, card);
  }

  removeAsk(id: string) {
    this.cards.get(id)?.remove();
    this.cards.delete(id);
    if (this.cards.size === 0 && !this.streaming) this.hideLater(4000);
  }
}

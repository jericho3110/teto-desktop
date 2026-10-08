// The command bar under Teto's feet: Enter sends, Esc hides,
// Up/Down walk through what you typed before (like a shell).

export class CommandBar {
  private input: HTMLInputElement;
  private stop: HTMLButtonElement;
  private history: string[] = [];
  private cursor = 0;

  constructor(
    private form: HTMLFormElement,
    onSubmit: (text: string) => void,
    onStop: () => void,
  ) {
    this.input = form.querySelector("input")!;
    this.stop = form.querySelector(".stop")!;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.history.push(text);
      this.cursor = this.history.length;
      this.input.value = "";
      onSubmit(text);
    });
    this.stop.addEventListener("click", onStop);
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hide();
      else if (e.key === "ArrowUp" && this.cursor > 0) this.recall(-1, e);
      else if (e.key === "ArrowDown" && this.cursor < this.history.length) this.recall(1, e);
    });
  }

  private recall(step: number, e: KeyboardEvent) {
    e.preventDefault();
    this.cursor += step;
    this.input.value = this.history[this.cursor] ?? "";
  }

  setBusy(busy: boolean) {
    this.stop.hidden = !busy;
    this.input.placeholder = busy ? "Teto is working… (Stop to interrupt)" : "Ask Teto anything…  (/remind 10m stretch)";
  }

  show() {
    this.form.hidden = false;
    this.input.focus();
  }

  hide() { this.form.hidden = true; }
  toggle() { if (this.form.hidden) this.show(); else this.hide(); }
}

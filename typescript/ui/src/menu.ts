// Teto's right-click menu: the first piece of her control GUI.
// Each item is just a label + an action, so new controls (voice, sing,
// settings…) are one line each.

export interface MenuItem {
  label: string;
  action: () => void;
}

export class ContextMenu {
  constructor(private root: HTMLElement) {
    // Close when clicking anywhere else or pressing Escape.
    document.addEventListener("pointerdown", (e) => {
      if (!this.root.hidden && !this.root.contains(e.target as Node)) this.hide();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hide();
    });
  }

  /** Show the items at (x, y), kept inside the window. */
  open(x: number, y: number, items: MenuItem[]) {
    this.root.replaceChildren(
      ...items.map((item) => {
        const button = document.createElement("button");
        button.textContent = item.label; // textContent: labels are never parsed as HTML
        button.addEventListener("click", () => {
          this.hide();
          item.action();
        });
        return button;
      }),
    );
    this.root.hidden = false;
    const { width, height } = this.root.getBoundingClientRect();
    this.root.style.left = `${Math.min(x, innerWidth - width - 4)}px`;
    this.root.style.top = `${Math.min(y, innerHeight - height - 4)}px`;
  }

  hide() {
    this.root.hidden = true;
  }
}

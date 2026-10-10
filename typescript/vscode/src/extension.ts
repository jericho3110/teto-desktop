// The extension host side: listens to editor events and tells the webview how Teto feels.
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { HostMessage } from "../webview/messages";

const IDLE_MS = 5 * 60_000; // no activity for this long: she falls asleep
const TYPING_EVERY_MS = 400; // at most one "typing" message per this many ms

class TetoView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly root: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const dirs = ["out", "media", "static"].map((d) => vscode.Uri.joinPath(this.root, d));
    // The page may load files only from these folders; no network access at all.
    view.webview.options = { enableScripts: true, localResourceRoots: dirs };
    view.webview.html = page(view.webview, this.root);
  }

  post(msg: HostMessage) {
    void this.view?.webview.postMessage(msg);
  }
}

function page(w: vscode.Webview, root: vscode.Uri): string {
  const uri = (...p: string[]) => w.asWebviewUri(vscode.Uri.joinPath(root, ...p)).toString();
  const nonce = randomBytes(16).toString("base64");
  // CSP: only our nonce'd script runs; wasm may compile; files only from the extension.
  // 'unsafe-inline' styles: the skin SVG uses style="..." attributes.
  const csp = [
    "default-src 'none'",
    `img-src ${w.cspSource} data:`,
    `style-src ${w.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `connect-src ${w.cspSource}`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${uri("static", "webview.css")}">
</head>
<body>
  <div id="character" title="Click me!"></div>
  <canvas id="fx"></canvas>
  <script nonce="${nonce}" src="${uri("out", "webview.js")}"
    data-skin="${uri("media", "skins", "teto-chibi")}" data-wasm="${uri("media", "physics.wasm")}"></script>
</body>
</html>`;
}

function countErrors(): number {
  let n = 0;
  for (const [, diags] of vscode.languages.getDiagnostics()) {
    for (const d of diags) if (d.severity === vscode.DiagnosticSeverity.Error) n++;
  }
  return n;
}

export function activate(ctx: vscode.ExtensionContext) {
  const teto = new TetoView(ctx.extensionUri);
  let lastActivity = Date.now();
  let lastTyping = 0;
  let sleeping = false;
  let errors = countErrors();

  const wake = () => {
    lastActivity = Date.now();
    if (!sleeping) return;
    sleeping = false;
    teto.post({ type: "sleep", on: false });
    teto.post({ type: "wave" });
  };

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider("teto.view", teto, {
      webviewOptions: { retainContextWhenHidden: true }, // keep her animation state when the panel is hidden
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== "file" || e.contentChanges.length === 0) return;
      wake();
      const now = Date.now();
      if (now - lastTyping >= TYPING_EVERY_MS) {
        lastTyping = now;
        teto.post({ type: "typing" });
      }
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      wake();
      teto.post({ type: "emote", emotion: "happy", intensity: 0.7 });
    }),
    vscode.languages.onDidChangeDiagnostics(() => {
      const now = countErrors();
      if (now > errors) teto.post({ type: "emote", emotion: "worried", intensity: 0.6 });
      else if (errors > 0 && now === 0) teto.post({ type: "emote", emotion: "excited", intensity: 0.8 });
      errors = now;
    }),
    vscode.window.onDidChangeWindowState((s) => s.focused && wake()),
    vscode.window.onDidChangeActiveTextEditor(wake),
    vscode.commands.registerCommand("teto.wave", () => {
      wake();
      teto.post({ type: "wave" });
    }),
  );

  const idle = setInterval(() => {
    if (!sleeping && Date.now() - lastActivity > IDLE_MS) {
      sleeping = true;
      teto.post({ type: "sleep", on: true });
    }
  }, 30_000);
  ctx.subscriptions.push({ dispose: () => clearInterval(idle) });
}

export function deactivate() {}

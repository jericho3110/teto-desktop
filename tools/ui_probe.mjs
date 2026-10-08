// UI probe: open the Teto UI in headless Edge/Chrome via the DevTools
// Protocol, print console output + exceptions, optionally run JS steps,
// and save a screenshot. Dependency-free (Node 24 has fetch + WebSocket).
//
//   node tools/ui_probe.mjs "http://localhost:1420/?token=devtoken" out.png [steps.js]
//
// steps.js (optional) is evaluated in the page after load; it may be async.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out = "probe.png", stepsFile] = process.argv.slice(2);
if (!url) {
  console.error("usage: node tools/ui_probe.mjs <url> [out.png] [steps.js]");
  process.exit(2);
}
const browser = process.env.BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const port = 9333;
const profile = mkdtempSync(join(tmpdir(), "teto-probe-")); // throwaway profile: never touches your real browser data
const proc = spawn(browser, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--disable-extensions",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=360,640", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch { /* browser still starting */ }
  }
  if (!target) throw new Error("browser did not start");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ");
      console.log(`[console.${msg.params.type}] ${text}`);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      console.log(`[exception] ${d.exception?.description ?? d.text}`);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 143, g: 163, b: 184, a: 1 } });
  // --window-size isn't exact in headless mode (found: 360 became 496), so pin
  // the viewport to the real Tauri window size instead.
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 640, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await sleep(2500);

  if (stepsFile) {
    const r = await send("Runtime.evaluate", {
      expression: `(async () => { ${readFileSync(stepsFile, "utf8")} })()`,
      awaitPromise: true, returnByValue: true,
    });
    const res = r.result;
    if (res.exceptionDetails) console.log("[steps exception]", res.exceptionDetails.exception?.description);
    else if (res.result?.value !== undefined) console.log("[steps result]", JSON.stringify(res.result.value));
  }

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log(`screenshot → ${out}`);
  ws.close();
} finally {
  proc.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold files briefly */ }
}

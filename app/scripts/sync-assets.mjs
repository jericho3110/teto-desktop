// Copies the shared, language-neutral assets into app/public so Vite
// serves them (dev) and bundles them (build):
//   skins/*            → public/skins/
//   quirks/*.js        → public/quirks/ (+ index.json listing them)
//   physics/dist/*.wasm → public/physics.wasm
// Runs automatically before `npm run dev` and `npm run build` (npm "pre" scripts).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(app, "..");
const pub = join(app, "public");

for (const dir of ["skins", "quirks"]) rmSync(join(pub, dir), { recursive: true, force: true });
mkdirSync(pub, { recursive: true });

cpSync(join(repo, "skins"), join(pub, "skins"), { recursive: true });

mkdirSync(join(pub, "quirks"), { recursive: true });
const quirks = readdirSync(join(repo, "quirks")).filter((f) => f.endsWith(".js")).sort();
for (const f of quirks) cpSync(join(repo, "quirks", f), join(pub, "quirks", f));
writeFileSync(join(pub, "quirks", "index.json"), JSON.stringify(quirks, null, 2));

const wasm = join(repo, "physics", "dist", "physics.wasm");
if (existsSync(wasm)) cpSync(wasm, join(pub, "physics.wasm"));
else console.warn("sync-assets: physics.wasm not built yet (cd physics && npm run build); hair will not move");

console.log(`sync-assets: skins, ${quirks.length} quirks${existsSync(wasm) ? ", physics.wasm" : ""}`);

// Copy Teto's skin and the C++ physics wasm into media/ (build output, git-ignored).
import { cpSync, existsSync, mkdirSync } from "node:fs";

const repo = new URL("../../../", import.meta.url);
const media = new URL("../media/", import.meta.url);
const wasm = new URL("cpp/physics/dist/physics.wasm", repo);

if (!existsSync(wasm)) {
  console.error("physics.wasm is missing: build it first (cd cpp/physics && npm run build)");
  process.exit(1);
}
mkdirSync(new URL("skins/", media), { recursive: true });
cpSync(new URL("assets/skins/teto-chibi/", repo), new URL("skins/teto-chibi/", media), { recursive: true });
cpSync(wasm, new URL("physics.wasm", media));

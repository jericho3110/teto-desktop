// Bundle the webview (and the desktop UI modules it reuses) into one script.
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "out",
    emptyOutDir: false, // out/host holds the compiled extension
    target: "es2022",
    lib: { entry: "webview/main.ts", formats: ["iife"], name: "TetoBuddy", fileName: () => "webview.js" },
  },
});

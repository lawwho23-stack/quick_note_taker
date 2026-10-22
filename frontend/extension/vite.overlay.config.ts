// Build pass 2 of 2: overlay.js, the content script injected with
// chrome.scripting.executeScript. It must be ONE classic script (IIFE) with
// no `import` statements, so everything is inlined.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false, // keep pass 1's output
    target: "chrome120",
    lib: {
      entry: "src/overlay.ts",
      name: "QuickNoteOverlay",
      formats: ["iife"],
      fileName: () => "overlay.js",
    },
  },
});

// Build pass 1 of 2: the background service worker (ES module) and the
// capture page. Pass 2 (vite.overlay.config.ts) builds overlay.js as an IIFE,
// because Rollup cannot mix output formats in one build.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { buildManifest } from "./src/lib/manifest.ts";

const root = fileURLToPath(new URL(".", import.meta.url));

function manifestPlugin(apiBase: string | undefined, webBase: string | undefined): Plugin {
  return {
    name: "quick-note-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: `${JSON.stringify(buildManifest({ apiBase, webBase }), null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, root, "VITE_"), ...pickViteEnv(process.env) };
  return {
    root,
    publicDir: "public",
    plugins: [manifestPlugin(env.VITE_API_BASE, env.VITE_WEB_BASE)],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "chrome120",
      // The preload helper touches `document`, which a service worker lacks.
      modulePreload: false,
      rollupOptions: {
        input: {
          background: resolve(root, "src/background.ts"),
          capture: resolve(root, "capture.html"),
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
    test: {
      environment: "jsdom",
      include: ["test/**/*.test.ts"],
    },
  };
});

function pickViteEnv(e: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e)) if (k.startsWith("VITE_") && v) out[k] = v;
  return out;
}

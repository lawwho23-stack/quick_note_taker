// Builds manifest.json. Runs in the Vite config (Node) at build time, and in
// tests. Keep it pure: no `chrome`, no `import.meta`.
import { DEFAULT_API_BASE, DEFAULT_WEB_BASE, LOCAL_API_ORIGIN, LOCAL_WEB_ORIGINS, originOf } from "./defaults.ts";

/**
 * The public key that pins the extension ID to mpnpdndkgajhjmlefflhemibjmkkcnha.
 * Never change it: the website and the API allowlist that ID.
 */
export const EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAj79t7Qsx18Bbw2iIRoa+LEx7SRt0Adkei6AsCH9v0xRk6CWMcKOvVYGVZnuy0Oa7Gd/nlhoYOMp27nsdHvWnW0SFPUsB9tJ9Gf5BM7NPNNwnUsjZx997MVnbeZVpaBU/sst/w+MLSOTX3NZFA++/FPvXIkHfKTHCV2rkGR1NzCAiSu/cNDr0ZfRy4iOVtlqX0ZNV+fwK359mB5AzlAsmc2xcNTkLSPJXran5mi8nBEi7fDwe/qBDym2KhsaVX1JC75RbXUyGmjEvSMBnF5PsVZpKWV0FNaPp0sMWr44IGnDI8lruyMJjuWp3eOPbA9gGaDmfnPR7zodPTzOUwIHkWwIDAQAB";

export const EXTENSION_ID = "mpnpdndkgajhjmlefflhemibjmkkcnha";

export interface ManifestEnv {
  apiBase?: string;
  webBase?: string;
  version?: string;
}

export function buildManifest(env: ManifestEnv = {}) {
  const apiOrigin = originOf(env.apiBase || DEFAULT_API_BASE);
  const webOrigin = originOf(env.webBase || DEFAULT_WEB_BASE);

  const hostPermissions = [...new Set([`${apiOrigin}/*`, `${LOCAL_API_ORIGIN}/*`])];
  const externalMatches = [...new Set([`${webOrigin}/*`, ...LOCAL_WEB_ORIGINS.map((o) => `${o}/*`)])];

  return {
    manifest_version: 3,
    name: "Quick Note",
    version: env.version || "0.2.0",
    description: "Press a shortcut, type a thought, press Enter. Saved to your Quick Note account.",
    key: EXTENSION_KEY,
    icons: { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" },
    background: { service_worker: "background.js", type: "module" },
    action: {
      default_title: "Quick Note",
      default_icon: { "16": "icons/icon16.png", "48": "icons/icon48.png" },
    },
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: hostPermissions,
    commands: {
      "open-capture": {
        suggested_key: { default: "Ctrl+Shift+7", mac: "MacCtrl+Shift+7" },
        description: "Open Quick Note capture",
        global: true,
      },
    },
    externally_connectable: { matches: externalMatches },
    web_accessible_resources: [{ resources: ["capture.html"], matches: ["<all_urls>"] }],
  };
}

// Zips dist/ into release/quick-note-extension.zip for the website's download
// button. Run with `npm run package` (it builds first). The zip holds one
// folder, quick-note-extension/, which users pick in "Load unpacked".
//
// Before zipping it checks the built manifest, so a dev build can never ship:
// the key (pins the extension ID) must be there, the production API and website
// must be allowed, and the version must match package.json (and RELEASE_TAG,
// e.g. "ext-v0.2.0", when CI passes one).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_API_BASE, DEFAULT_WEB_BASE } from "../src/lib/defaults.ts";
import { EXTENSION_KEY } from "../src/lib/manifest.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const release = join(root, "release");
const folderName = "quick-note-extension";
const zipName = `${folderName}.zip`;

function fail(message) {
  console.error(`package: ${message}`);
  process.exit(1);
}

if (!existsSync(join(dist, "manifest.json"))) {
  fail("dist/manifest.json is missing. Run `npm run build` first.");
}

const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (manifest.key !== EXTENSION_KEY) {
  fail("the manifest key is missing or changed, so the extension ID would change.");
}
if (manifest.version !== pkg.version) {
  fail(`manifest version ${manifest.version} does not match package.json ${pkg.version}.`);
}
const tag = process.env.RELEASE_TAG;
if (tag && tag !== `ext-v${pkg.version}`) {
  fail(`tag ${tag} does not match version ${pkg.version} (expected ext-v${pkg.version}).`);
}
if (!manifest.host_permissions.includes(`${new URL(DEFAULT_API_BASE).origin}/*`)) {
  fail(`the production API (${DEFAULT_API_BASE}) is not allowed. Check VITE_API_BASE / .env files.`);
}
if (!manifest.externally_connectable.matches.includes(`${new URL(DEFAULT_WEB_BASE).origin}/*`)) {
  fail(`the production website (${DEFAULT_WEB_BASE}) is not allowed. Check VITE_WEB_BASE / .env files.`);
}

rmSync(release, { recursive: true, force: true });
mkdirSync(release);
cpSync(dist, join(release, folderName), { recursive: true });
// -X leaves out macOS extra file attributes; the zip is the same on any machine.
execFileSync("zip", ["-r", "-X", "-q", zipName, folderName], { cwd: release, stdio: "inherit" });
rmSync(join(release, folderName), { recursive: true });

console.log(`package: release/${zipName} (Quick Note ${pkg.version})`);

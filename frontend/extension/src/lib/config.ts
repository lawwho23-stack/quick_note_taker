// Runtime config, fixed at build time. A web page can never change these.
import { DEFAULT_API_BASE, DEFAULT_WEB_BASE, normalizeBase } from "./defaults";

export const API_BASE = normalizeBase(import.meta.env.VITE_API_BASE || DEFAULT_API_BASE);
export const WEB_BASE = normalizeBase(import.meta.env.VITE_WEB_BASE || DEFAULT_WEB_BASE);

/** Where "Not connected" sends the user. */
export const SETUP_URL = `${WEB_BASE}/quick-note`;

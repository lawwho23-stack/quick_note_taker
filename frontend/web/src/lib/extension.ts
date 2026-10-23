/**
 * Talk to the Quick Note browser extension (Contract 2).
 *
 * The page calls `chrome.runtime.sendMessage(EXTENSION_ID, msg, callback)`.
 * That API only exists in Chrome/Edge, and only when an installed extension
 * lists this site in `externally_connectable`. Every failure (no API, no
 * extension, `lastError`, a bad reply, no reply in time) comes back as a
 * result object instead of a thrown error.
 */
import {
  DEFAULT_EXTENSION_ID,
  type ConnectReply,
  type DisconnectReply,
  type ExtensionRequest,
  type PingReply,
} from "@quick-note/shared";

export const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID || DEFAULT_EXTENSION_ID;

/** Store listing. Until it is published, the setup page offers the zip download below. */
export const EXTENSION_STORE_URL = process.env.NEXT_PUBLIC_EXTENSION_STORE_URL || null;

/** The extension zip, built by .github/workflows/extension-release.yml. */
export const EXTENSION_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_EXTENSION_DOWNLOAD_URL ||
  "https://github.com/lawwho23-stack/quick_note_taker/releases/latest/download/quick-note-extension.zip";

export type ExtensionStatus = "checking" | "not-installed" | "installed" | "connected";

export type SendResult<T> =
  | { ok: true; reply: T }
  | { ok: false; reason: "no-runtime" | "not-installed" | "timeout" | "bad-reply" };

type ChromeRuntime = {
  sendMessage: (
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void,
  ) => void;
  lastError?: { message?: string };
};

function getRuntime(): ChromeRuntime | null {
  if (typeof window === "undefined") {
    return null;
  }
  const chrome = (globalThis as { chrome?: { runtime?: Partial<ChromeRuntime> } }).chrome;
  const runtime = chrome?.runtime;
  if (!runtime || typeof runtime.sendMessage !== "function") {
    return null;
  }
  return runtime as ChromeRuntime;
}

/** Send one message and wait for the reply, at most `timeoutMs`. */
function send(message: ExtensionRequest, timeoutMs: number): Promise<SendResult<unknown>> {
  const runtime = getRuntime();
  if (!runtime) {
    return Promise.resolve({ ok: false, reason: "no-runtime" });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SendResult<unknown>) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(result);
      }
    };
    const timer = window.setTimeout(() => finish({ ok: false, reason: "timeout" }), timeoutMs);
    try {
      runtime.sendMessage(EXTENSION_ID, message, (response) => {
        // Reading lastError also stops Chrome logging an "unchecked" warning.
        if (runtime.lastError) {
          finish({ ok: false, reason: "not-installed" });
          return;
        }
        finish({ ok: true, reply: response });
      });
    } catch {
      // Chrome throws synchronously for an unknown ID in some versions.
      finish({ ok: false, reason: "not-installed" });
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPingReply(value: unknown): value is PingReply {
  return (
    isRecord(value) &&
    value.ok === true &&
    typeof value.connected === "boolean" &&
    (value.lastOpenedAt === null || typeof value.lastOpenedAt === "number")
  );
}

export async function pingExtension(timeoutMs = 1500): Promise<SendResult<PingReply>> {
  const result = await send({ type: "ping" }, timeoutMs);
  if (!result.ok) {
    return result;
  }
  return isPingReply(result.reply)
    ? { ok: true, reply: result.reply }
    : { ok: false, reason: "bad-reply" };
}

/** The extension checks the token with the API before replying, so allow more time. */
export async function connectExtension(
  token: string,
  timeoutMs = 10_000,
): Promise<SendResult<ConnectReply>> {
  const result = await send({ type: "connect", token }, timeoutMs);
  if (!result.ok) {
    return result;
  }
  const reply = result.reply;
  if (isRecord(reply) && typeof reply.ok === "boolean") {
    return { ok: true, reply: reply as ConnectReply };
  }
  return { ok: false, reason: "bad-reply" };
}

export async function disconnectExtension(
  timeoutMs = 3000,
): Promise<SendResult<DisconnectReply>> {
  const result = await send({ type: "disconnect" }, timeoutMs);
  if (!result.ok) {
    return result;
  }
  return isRecord(result.reply) && result.reply.ok === true
    ? { ok: true, reply: { ok: true } }
    : { ok: false, reason: "bad-reply" };
}

/** Map a ping result to the sidebar badge state. */
export function statusFromPing(result: SendResult<PingReply>): ExtensionStatus {
  if (!result.ok) {
    return "not-installed";
  }
  return result.reply.connected ? "connected" : "installed";
}

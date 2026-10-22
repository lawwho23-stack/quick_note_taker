// Drafts: unsent text, kept per connected account.
//
// The API never tells the extension which account a token belongs to, so the
// "account" is identified by a short hash of the token (see accountKeyFor).
// Text typed while not connected lives under the "anon" scope and moves to
// the account when the user connects.
import type { KV } from "./storage";

export const DRAFT_PREFIX = "draft:";
export const ANON_SCOPE = "anon";

export function draftKey(accountKey: string | null | undefined): string {
  return `${DRAFT_PREFIX}${accountKey || ANON_SCOPE}`;
}

export async function getDraft(kv: KV, accountKey: string | null | undefined): Promise<string> {
  const v = await kv.get<string>(draftKey(accountKey));
  return typeof v === "string" ? v : "";
}

export async function setDraft(kv: KV, accountKey: string | null | undefined, text: string): Promise<void> {
  if (text === "") {
    await kv.remove(draftKey(accountKey));
  } else {
    await kv.set(draftKey(accountKey), text);
  }
}

export async function clearDraft(kv: KV, accountKey: string | null | undefined): Promise<void> {
  await kv.remove(draftKey(accountKey));
}

/** Remove every draft of every account (used on disconnect). */
export async function clearAllDrafts(kv: KV): Promise<void> {
  const all = await kv.getAll();
  const keys = Object.keys(all).filter((k) => k.startsWith(DRAFT_PREFIX));
  if (keys.length) await kv.remove(keys);
}

/** On connect: move the anonymous draft into the account, unless the account already has one. */
export async function adoptAnonDraft(kv: KV, accountKey: string): Promise<void> {
  const anon = await getDraft(kv, null);
  if (!anon) return;
  const existing = await getDraft(kv, accountKey);
  if (!existing) await setDraft(kv, accountKey, anon);
  await clearDraft(kv, null);
}

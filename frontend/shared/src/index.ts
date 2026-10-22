/**
 * Types and constants shared by the website (and later the extension).
 *
 * The API's OpenAPI document stays the source of truth; a generated client
 * replaces these hand-written types during Integration.
 */

export type UserOut = {
  id: string;
  email: string | null;
};

export type AccountOut = {
  id: string;
  email: string | null;
  created_at: string;
};

export type AuthResponse = {
  status: "signed_in";
  user: UserOut;
  account: AccountOut;
  access_token_expires_at: number | null;
};

export type RegisterResponse = {
  status: "signed_in" | "confirmation_required";
  user: UserOut | null;
  account: AccountOut | null;
  access_token_expires_at: number | null;
};

export type SessionInfo = {
  authenticated: boolean;
  user: UserOut | null;
  access_token_expires_at: number | null;
};

export type MeResponse = {
  user: UserOut;
  account: AccountOut;
};

export type ApiErrorDetail = {
  code: string;
  message: string;
  request_id: string;
};

// Notes ----------------------------------------------------------------------
// Hand-written for now; Integration swaps these for types generated from
// backend/openapi.json. Names match the backend Pydantic models.

/** Longest note body the API accepts (characters). */
export const NOTE_MAX_CHARS = 20_000;

export type NoteOut = {
  id: string;
  body: string;
  version: number;
  source: string;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type NoteCreate = {
  id: string;
  body: string;
  source?: string;
  meta?: Record<string, unknown>;
};

export type NoteUpdate = {
  body: string;
  base_version: number;
};

/** What a create returns. No body, so an extension token cannot read notes. */
export type NoteCreateAck = {
  id: string;
  version: number;
  created_at: string;
};

export type NoteList = {
  items: NoteOut[];
  next_cursor: string | null;
};

/** 409 version_conflict body: the usual error plus the note as it is now. */
export type VersionConflictBody = {
  error: ApiErrorDetail;
  current: NoteOut;
};

// Extension tokens (Contract 1) ----------------------------------------------

export type ExtensionTokenCreate = {
  label?: string;
};

export type ExtensionTokenOut = {
  id: string;
  label: string | null;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
};

/** Only the create response carries the secret, and only once. */
export type ExtensionTokenCreated = {
  id: string;
  label: string | null;
  scopes: string[];
  created_at: string;
  token: string;
};

export type ExtensionTokenList = {
  items: ExtensionTokenOut[];
};

export type ExtensionStatusOut = {
  status: "connected";
};

// Export and account deletion (Contract 1) -----------------------------------

export type ExportFormat = "json" | "markdown";

export type ExportJson = {
  exported_at: string;
  count: number;
  notes: NoteOut[];
};

export type DeleteAccountRequest = {
  confirm: "DELETE";
};

// Website <-> extension messages (Contract 2) --------------------------------

export type ExtensionRequest =
  | { type: "ping" }
  | { type: "connect"; token: string }
  | { type: "disconnect" };

export type PingReply = {
  ok: true;
  version: string;
  connected: boolean;
  /** ms since epoch of the last time the capture card opened. */
  lastOpenedAt: number | null;
};

export type ConnectReply = { ok: true } | { ok: false; error: "invalid_token" | string };

export type DisconnectReply = { ok: true };

/** Default ID, stable because of the `key` in the extension manifest. */
export const DEFAULT_EXTENSION_ID = "mpnpdndkgajhjmlefflhemibjmkkcnha";

/** Cookie the website reads and echoes back as CSRF_HEADER_NAME. */
export const CSRF_COOKIE_NAME = "qn_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

/** Website path where the API forwards browser requests. */
export const API_BASE_PATH = "/api/v1";

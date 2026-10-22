/**
 * Types and constants shared by the website (and later the extension).
 *
 * API request and response shapes are aliases of the types generated from
 * backend/openapi.json (`npm run gen:api --workspace @quick-note/shared`).
 */

import type { components } from "./api.gen";

export type { components, paths } from "./api.gen";

type Schemas = components["schemas"];

export type UserOut = Schemas["UserOut"];

export type AccountOut = Schemas["AccountOut"];

export type AuthResponse = Schemas["AuthResponse"];

export type RegisterResponse = Schemas["RegisterResponse"];

export type SessionInfo = {
  authenticated: boolean;
  user: UserOut | null;
  access_token_expires_at: number | null;
};

export type MeResponse = Schemas["MeResponse"];

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

export type NoteOut = Schemas["NoteOut"];

export type NoteCreate = Schemas["NoteCreate"];

export type NoteUpdate = Schemas["NoteUpdate"];

/** What a create returns. No body, so an extension token cannot read notes. */
export type NoteCreateAck = Schemas["NoteCreateAck"];

export type NoteList = Schemas["NoteList"];

/** 409 version_conflict body: the usual error plus the note as it is now. */
export type VersionConflictBody = {
  error: ApiErrorDetail;
  current: NoteOut;
};

// Extension tokens (Contract 1) ----------------------------------------------

export type ExtensionTokenCreate = Schemas["ExtensionTokenCreate"];

export type ExtensionTokenOut = Schemas["ExtensionTokenOut"];

/** Only the create response carries the secret, and only once. */
export type ExtensionTokenCreated = Schemas["ExtensionTokenCreated"];

export type ExtensionTokenList = Schemas["ExtensionTokenList"];

export type ExtensionStatusOut = Schemas["ExtensionStatus"];

// Export and account deletion (Contract 1) -----------------------------------

export type ExportFormat = "json" | "markdown";

export type ExportJson = Schemas["NoteExport"];

export type DeleteAccountRequest = Schemas["DeleteAccountRequest"];

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

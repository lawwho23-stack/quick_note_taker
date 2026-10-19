/**
 * Types and constants shared by the website (and later the extension).
 *
 * The API's OpenAPI document stays the source of truth; a generated client
 * replaces these hand-written types in M2.
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

/** Cookie the website reads and echoes back as CSRF_HEADER_NAME. */
export const CSRF_COOKIE_NAME = "qn_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

/** Website path where the API forwards browser requests. */
export const API_BASE_PATH = "/api/v1";

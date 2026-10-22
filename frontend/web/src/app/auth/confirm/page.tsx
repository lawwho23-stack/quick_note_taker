"use client";

import type { AuthResponse } from "@quick-note/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { apiJson } from "@/lib/api";

const GENERIC_LINK_ERROR = "Sign-in didn't finish. Please try again.";

/** Fixed messages for Supabase's fragment error codes; the raw URL text is never shown. */
const LINK_ERROR_MESSAGES: Record<string, string> = {
  otp_expired: "This link has expired or was already used. Sign in to request a new one.",
  access_denied: "This link is no longer valid. Sign in to request a new one.",
};

function linkErrorMessage(code: string): string {
  return Object.hasOwn(LINK_ERROR_MESSAGES, code) ? LINK_ERROR_MESSAGES[code] : GENERIC_LINK_ERROR;
}

/**
 * Handles email-confirmation and sign-in links.
 *
 * Supabase can return either a PKCE `code` in the query string or tokens in the
 * URL fragment. The fragment never reaches the server, so this page posts the
 * material to the API, which sets the session cookies. Tokens are removed from
 * the URL and browser history before the exchange.
 */
export default function AuthConfirmPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const code = query.get("code");
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const expiresIn = hash.get("expires_in");
    const hashError = hash.get("error_code") ?? hash.get("error");

    window.history.replaceState(null, "", "/auth/confirm");

    if (hashError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount effect reading the URL fragment
      setError(linkErrorMessage(hashError));
      return;
    }
    if (!code && !accessToken) {
      setError("This link is missing its sign-in token. Use the link from the email exactly as sent.");
      return;
    }

    const payload = code
      ? { code }
      : {
          access_token: accessToken,
          refresh_token: refreshToken ?? undefined,
          expires_in: expiresIn ? Number(expiresIn) : undefined,
        };

    apiJson<AuthResponse>("/api/v1/auth/exchange", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then((result) => {
      if (result.ok) {
        router.replace("/notes");
        router.refresh();
        return;
      }
      setError(result.error?.message ?? "Could not complete sign-in.");
    });
  }, [router]);

  if (error) {
    return (
      <AuthShell>
        <div className="auth-head">
          <h1>This link didn&apos;t work</h1>
        </div>
        <p className="notice error" role="alert">
          {error}
        </p>
        <Link className="button large block" href="/sign-in">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <span className="spinner" aria-hidden="true" />
      <div className="auth-head" role="status">
        <h1>Confirming your email…</h1>
        <p>One moment while we sign you in.</p>
      </div>
    </AuthShell>
  );
}

"use client";

import type { AuthResponse } from "@quick-note/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { ResendButton } from "@/components/resend-button";
import { apiJson } from "@/lib/api";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: "The sign-in attempt did not match this browser session. Please try again.",
  state_missing: "The sign-in attempt lost its security state. Please try again.",
  missing_verifier: "The sign-in attempt expired. Please try again.",
  missing_code: "Google did not return a sign-in code. Please try again.",
  exchange_failed: "Google sign-in could not be completed. Please try again.",
  access_denied: "Google sign-in was cancelled.",
};

const GENERIC_AUTH_ERROR = "Sign-in didn't finish. Please try again.";

/** Only known codes get their own message; the raw query value is never shown. */
function authErrorMessage(code: string): string {
  return Object.hasOwn(AUTH_ERROR_MESSAGES, code) ? AUTH_ERROR_MESSAGES[code] : GENERIC_AUTH_ERROR;
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authError = searchParams.get("auth_error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Set to the typed email when the API says it still needs confirming.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    authError ? authErrorMessage(authError) : null,
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setUnconfirmedEmail(null);

    const result = await apiJson<AuthResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (!result.ok) {
      setBusy(false);
      setError(result.error?.message ?? "Could not sign in. Please try again.");
      if (result.status === 403 && result.error?.code === "email_not_confirmed") {
        setUnconfirmedEmail(email);
      }
      return;
    }

    router.replace("/notes");
    router.refresh();
  }

  return (
    <section className="card stack">
      <div className="topbar">
        <Link className="brand" href="/">
          Quick Note
        </Link>
        <Link className="muted small" href="/sign-up">
          Create account
        </Link>
      </div>
      <h1>Sign in</h1>
      <p className="muted small">Use your email and password, or continue with Google.</p>

      {error ? <p className="notice error">{error}</p> : null}
      {unconfirmedEmail ? <ResendButton email={unconfirmedEmail} /> : null}

      <form className="form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button className="button" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <hr className="divider" />

      <a className="button secondary" href="/api/v1/auth/google?next=/notes">
        Continue with Google
      </a>
    </section>
  );
}

export default function SignInPage() {
  return (
    <main className="page page-narrow">
      <Suspense
        fallback={
          <section className="card stack">
            <p className="muted">Loading sign-in…</p>
          </section>
        }
      >
        <SignInForm />
      </Suspense>
    </main>
  );
}

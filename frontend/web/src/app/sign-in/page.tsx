"use client";

import type { AuthResponse } from "@quick-note/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { PasswordInput } from "@/components/password-input";
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
      if (result.status === 403 && result.error?.code === "email_not_confirmed") {
        setUnconfirmedEmail(email);
        return;
      }
      setError(result.error?.message ?? "Could not sign in. Please try again.");
      return;
    }

    router.replace("/notes");
    router.refresh();
  }

  return (
    <>
      <div className="auth-head">
        <h1>Welcome back</h1>
        <p>Sign in with your email and password.</p>
      </div>

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {unconfirmedEmail ? (
        <div className="stack">
          <p className="notice info" role="alert">
            Confirm your email first. We sent a link to {unconfirmedEmail}.
          </p>
          <ResendButton email={unconfirmedEmail} />
        </div>
      ) : null}

      <form className="form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@gmail.com"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
        <button className="button large block" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="auth-switch">
        New to Quick Note? <Link href="/sign-up">Create an account</Link>
      </p>
    </>
  );
}

export default function SignInPage() {
  return (
    <AuthShell>
      <Suspense fallback={<p className="muted">Loading sign-in…</p>}>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}

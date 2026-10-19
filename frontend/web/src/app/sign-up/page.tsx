"use client";

import type { RegisterResponse } from "@quick-note/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiJson } from "@/lib/api";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function onResend() {
    setResendState("sending");
    const result = await apiJson("/api/v1/auth/resend", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    // The API answers 202 whether or not the address exists, so only a
    // transport failure counts as a failure here.
    setResendState(result.ok ? "sent" : "failed");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await apiJson<RegisterResponse>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (!result.ok) {
      setBusy(false);
      setError(result.error?.message ?? "Could not create the account. Please try again.");
      return;
    }

    if (result.data.status === "signed_in") {
      router.replace("/notes");
      router.refresh();
      return;
    }

    setBusy(false);
    setConfirmationSent(true);
  }

  return (
    <main className="page page-narrow">
      <section className="card stack">
        <div className="topbar">
          <Link className="brand" href="/">
            Quick Note
          </Link>
          <Link className="muted small" href="/sign-in">
            Sign in
          </Link>
        </div>
        <h1>Create your account</h1>
        <p className="muted small">
          Notes are private to your account. Passwords are handled by Supabase Auth and never
          stored by this application.
        </p>

        {error ? <p className="notice error">{error}</p> : null}

        {confirmationSent ? (
          <div className="stack">
            <p className="notice success">
              Confirmation email sent to {email}. Open the link in that email to finish creating
              your account, then sign in here.
            </p>
            {resendState === "sent" ? (
              <p className="notice info">Another email is on its way. It can take a minute.</p>
            ) : null}
            {resendState === "failed" ? (
              <p className="notice error">
                Could not resend right now. Wait a moment and try again.
              </p>
            ) : null}
            <button
              className="button secondary"
              type="button"
              onClick={() => void onResend()}
              disabled={resendState === "sending"}
            >
              {resendState === "sending" ? "Sending…" : "Resend confirmation email"}
            </button>
            <p className="muted small">
              Confirmation links expire. If the first email never arrives, check the spam folder
              before resending.
            </p>
          </div>
        ) : (
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
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <span className="muted small">At least 8 characters.</span>
            </div>
            <button className="button" type="submit" disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}

        <hr className="divider" />

        <a className="button secondary" href="/api/v1/auth/google?next=/notes">
          Continue with Google
        </a>
      </section>
    </main>
  );
}

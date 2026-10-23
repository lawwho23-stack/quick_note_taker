"use client";

import type { RegisterResponse } from "@quick-note/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { GoogleButton } from "@/components/google-button";
import { PasswordInput } from "@/components/password-input";
import { ResendButton } from "@/components/resend-button";
import { apiJson } from "@/lib/api";

/** A one-click way into the inbox for the mail providers most people use. */
function inboxLink(email: string): { label: string; href: string } | null {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return { label: "Open Gmail", href: "https://mail.google.com/mail/u/0/#inbox" };
  }
  if (["outlook.com", "hotmail.com", "live.com"].includes(domain)) {
    return { label: "Open Outlook", href: "https://outlook.live.com/mail/0/inbox" };
  }
  if (domain === "yahoo.com") {
    return { label: "Open Yahoo Mail", href: "https://mail.yahoo.com" };
  }
  return null;
}

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

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

  if (confirmationSent) {
    const inbox = inboxLink(email);
    return (
      <AuthShell>
        <div className="auth-head">
          <h1>Check your inbox</h1>
          <p>
            We sent a confirmation link to <strong>{email}</strong>. Open it to finish creating
            your account. You will be signed in right away.
          </p>
        </div>
        {inbox ? (
          <a className="button large block" href={inbox.href} target="_blank" rel="noopener noreferrer">
            {inbox.label}
          </a>
        ) : null}
        <ResendButton email={email} initialCooldown={60} />
        <p className="hint">
          Can&apos;t find it? Check the Spam or Promotions folder before resending.
        </p>
        <p className="auth-switch">
          Wrong email?{" "}
          <button
            className="link-button"
            type="button"
            onClick={() => setConfirmationSent(false)}
          >
            Use a different one
          </button>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="auth-head">
        <h1>Create your account</h1>
        <p>Free, and takes less than a minute.</p>
      </div>

      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}

      <GoogleButton label="Sign up with Google" />

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
        <PasswordInput
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={8}
          hint="At least 8 characters."
        />
        <button className="button large block" type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="auth-switch">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </AuthShell>
  );
}

import Link from "next/link";

import { AuthFragmentRedirect } from "@/components/auth-fragment-redirect";

export default function HomePage() {
  return (
    <main className="page">
      <section className="card hero">
        <span className="badge">Staging build · authentication milestone</span>
        <h1>Quick Note</h1>
        <p className="lede">
          Capture an idea without leaving what you are doing. Press the shortcut, type, press
          Enter — the note is saved to your account and the window closes.
        </p>
        <div className="actions">
          <Link className="button" href="/sign-up">
            Create an account
          </Link>
          <Link className="button secondary" href="/sign-in">
            Sign in
          </Link>
        </div>
      </section>

      <section className="card stack">
        <h2>What this deployment proves</h2>
        <p className="muted small">
          This milestone proves the deployed authentication path end to end: email/password
          sign-in, the Google callback, session refresh rotation, logout, CSRF protection, and
          cookie forwarding through the website rewrite to the API.
        </p>
        <p className="muted small">
          Notes management arrives in the next milestone. Until then,{" "}
          <Link href="/notes">the account page</Link> shows which account a request is
          authenticated as.
        </p>
      </section>

      <AuthFragmentRedirect />
    </main>
  );
}

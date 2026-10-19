"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Alias for the sign-in callback.
 *
 * Google returns to `/api/v1/auth/callback`, which the backend handles through
 * the rewrite. This page exists for links that land on the website route
 * instead, and forwards them to the API with the query string intact.
 */
export default function AuthCallbackPage() {
  useEffect(() => {
    window.location.replace(
      `/api/v1/auth/callback${window.location.search}${window.location.hash}`,
    );
  }, []);

  return (
    <main className="page page-narrow">
      <section className="card stack">
        <Link className="brand" href="/">
          Quick Note
        </Link>
        <h1>Finishing sign-in…</h1>
        <p className="muted">Completing the Google callback.</p>
      </section>
    </main>
  );
}

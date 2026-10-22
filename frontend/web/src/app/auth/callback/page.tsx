"use client";

import { useEffect } from "react";

import { AuthShell } from "@/components/auth-shell";

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
    <AuthShell>
      <span className="spinner" aria-hidden="true" />
      <div className="auth-head" role="status">
        <h1>Finishing sign-in…</h1>
        <p>One moment while we sign you in.</p>
      </div>
    </AuthShell>
  );
}

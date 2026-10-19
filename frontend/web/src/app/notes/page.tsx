"use client";

import type { MeResponse } from "@quick-note/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { apiJson } from "@/lib/api";

type ViewState =
  | { phase: "checking" }
  | { phase: "signed-in"; me: MeResponse }
  | { phase: "unavailable"; message: string };

function formatTimestamp(value: string | number | null): string {
  if (value === null) {
    return "unknown";
  }
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export default function NotesPage() {
  const router = useRouter();
  const [state, setState] = useState<ViewState>({ phase: "checking" });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loadIdentity = useCallback(async () => {
    const result = await apiJson<MeResponse>("/api/v1/me");

    if (result.ok) {
      setState({ phase: "signed-in", me: result.data });
      return;
    }

    if (result.status === 401) {
      if (result.error?.code === "unauthenticated") {
        router.replace("/sign-in");
        return;
      }
      setState({
        phase: "unavailable",
        message:
          result.error?.code === "account_not_found"
            ? "This account no longer exists. Sign in again to create or restore access."
            : result.error?.message ?? "The session is not usable right now.",
      });
      return;
    }

    setState({
      phase: "unavailable",
      message: result.error?.message ?? `The API replied with status ${result.status}.`,
    });
  }, [router]);

  useEffect(() => {
    // Mount-only fetch; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount effect, no update loop
    void loadIdentity();
  }, [loadIdentity]);

  async function rotateSession() {
    setBusy(true);
    setStatus(null);
    const result = await apiJson<{ status: string }>("/api/v1/auth/refresh", { method: "POST" });
    if (result.ok) {
      setStatus("Refresh token rotated. New access, refresh, and CSRF cookies are in place.");
      await loadIdentity();
    } else {
      setStatus(result.error?.message ?? "Could not refresh the session.");
    }
    setBusy(false);
  }

  async function signOut() {
    setBusy(true);
    setStatus(null);
    await apiJson("/api/v1/auth/logout", { method: "POST" });
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <main className="page page-narrow">
      <section className="card stack">
        <div className="topbar">
          <Link className="brand" href="/">
            Quick Note
          </Link>
          <span className="muted small">Account</span>
        </div>
        <h1>Your account</h1>

        {state.phase === "checking" ? <p className="muted">Checking your session…</p> : null}

        {state.phase === "unavailable" ? (
          <div className="stack">
            <p className="notice error">{state.message}</p>
            <Link className="button" href="/sign-in">
              Go to sign in
            </Link>
          </div>
        ) : null}

        {state.phase === "signed-in" ? (
          <div className="stack">
            <p className="notice success">Authenticated request reached the API.</p>
            <dl className="kv">
              <dt>Email</dt>
              <dd>{state.me.user.email ?? "(none)"}</dd>
              <dt>Auth user id</dt>
              <dd>{state.me.user.id}</dd>
              <dt>Account id</dt>
              <dd>{state.me.account.id}</dd>
              <dt>Account created</dt>
              <dd>{formatTimestamp(state.me.account.created_at)}</dd>
            </dl>
            {status ? <p className="notice info">{status}</p> : null}
            <div className="row">
              <button className="button secondary" onClick={rotateSession} disabled={busy}>
                Rotate session
              </button>
              <button className="button ghost" onClick={() => void loadIdentity()} disabled={busy}>
                Re-check
              </button>
              <button className="button ghost" onClick={signOut} disabled={busy}>
                Sign out
              </button>
            </div>
          </div>
        ) : null}

        <hr className="divider" />
        <p className="muted small">
          Notes list, search, and editing arrive in the next milestone (M3). This page exists to
          prove that an authenticated request carries the right account identity.
        </p>
      </section>
    </main>
  );
}

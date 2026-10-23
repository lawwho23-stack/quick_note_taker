"use client";

import type { MeResponse } from "@quick-note/shared";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { LogoMark } from "@/components/logo";
import { apiJson } from "@/lib/api";
import { pingExtension, statusFromPing, type ExtensionStatus } from "@/lib/extension";

type AppContextValue = {
  me: MeResponse;
  extensionStatus: ExtensionStatus;
  /** Ping the extension again (after Connect, Revoke, or a test). */
  refreshExtension: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error("useApp() must be used inside <AppShell>.");
  }
  return value;
}

type SessionState =
  | { phase: "checking" }
  | { phase: "signed-in"; me: MeResponse }
  | { phase: "unavailable"; message: string };

const BADGE_LABEL: Record<ExtensionStatus, string> = {
  checking: "Checking",
  "not-installed": "Not installed",
  installed: "Installed",
  connected: "Connected",
};

export function StatusBadge({ status }: { status: ExtensionStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="badge-dot" aria-hidden="true" />
      {BADGE_LABEL[status]}
    </span>
  );
}

function NotesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 12h7M9 16h5" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 3L5 14h6l-1 7 8-11h-6z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

const NAV = [
  { href: "/notes", label: "Notes", icon: NotesIcon },
  { href: "/quick-note", label: "Quick Note", icon: BoltIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
] as const;

/**
 * Frame for signed-in pages: sidebar on wide screens, a top bar with tabs on
 * phones. It checks the session once; a signed-out visitor goes to /sign-in.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<SessionState>({ phase: "checking" });
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus>("checking");
  const [signingOut, setSigningOut] = useState(false);

  const loadSession = useCallback(async () => {
    const result = await apiJson<MeResponse>("/api/v1/me");
    if (result.ok) {
      setSession({ phase: "signed-in", me: result.data });
      return;
    }
    const code = result.error?.code;
    if (result.status === 401 && (code === "unauthenticated" || code === "session_expired")) {
      // `reauth` stops the proxy from sending a visitor with stale cookies back here.
      router.replace("/sign-in?reauth=1");
      return;
    }
    setSession({
      phase: "unavailable",
      message:
        code === "account_not_found"
          ? "This account no longer exists. Sign in again to continue."
          : result.error?.message ?? "We could not reach Quick Note right now. Please try again.",
    });
  }, [router]);

  const refreshExtension = useCallback(async () => {
    setExtensionStatus(statusFromPing(await pingExtension()));
  }, []);

  useEffect(() => {
    // Mount-only fetches; state updates happen after the requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount effect, no update loop
    void loadSession();
    void refreshExtension();
    const onFocus = () => void refreshExtension();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadSession, refreshExtension]);

  async function signOut() {
    setSigningOut(true);
    await apiJson("/api/v1/auth/logout", { method: "POST" });
    router.replace("/sign-in");
    router.refresh();
  }

  const nav = (
    <nav className="app-nav" aria-label="App">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={active ? "app-nav-link active" : "app-nav-link"}
            aria-current={active ? "page" : undefined}
          >
            <Icon />
            <span className="app-nav-label">{label}</span>
            {href === "/quick-note" ? <StatusBadge status={extensionStatus} /> : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="app-sidebar">
        <Link className="logo app-logo" href="/notes">
          <LogoMark size={40} />
          Quick Note
        </Link>
        {nav}
        <div className="app-sidebar-foot">
          {session.phase === "signed-in" ? (
            <p className="app-email" title={session.me.user.email ?? undefined}>
              {session.me.user.email ?? "Signed in"}
            </p>
          ) : null}
          <button
            className="button ghost small-button"
            type="button"
            onClick={signOut}
            disabled={signingOut || session.phase !== "signed-in"}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          <Link className="app-foot-link" href="/privacy">
            Privacy
          </Link>
        </div>
      </aside>

      <main id="main" className="app-main" tabIndex={-1}>
        {session.phase === "checking" ? (
          <div className="app-center" role="status">
            <span className="spinner" aria-hidden="true" />
            <span className="muted">Checking your session…</span>
          </div>
        ) : null}
        {session.phase === "unavailable" ? (
          <div className="app-center">
            <div className="card stack" style={{ maxWidth: 460 }}>
              <p className="notice error" role="alert">
                {session.message}
              </p>
              <div className="row">
                <button className="button" type="button" onClick={() => void loadSession()}>
                  Try again
                </button>
                <Link className="button ghost" href="/sign-in?reauth=1">
                  Go to sign in
                </Link>
              </div>
            </div>
          </div>
        ) : null}
        {session.phase === "signed-in" ? (
          <AppContext.Provider value={{ me: session.me, extensionStatus, refreshExtension }}>
            {children}
          </AppContext.Provider>
        ) : null}
      </main>
    </div>
  );
}

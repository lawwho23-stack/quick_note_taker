"use client";

import type { ExportFormat, ExtensionTokenList, ExtensionTokenOut } from "@quick-note/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge, useApp } from "@/components/app-shell";
import { Dialog } from "@/components/dialog";
import { apiFetch, apiJson } from "@/lib/api";
import { disconnectExtension } from "@/lib/extension";
import { formatDate, formatDateTime } from "@/lib/format";

type TokensState =
  | { phase: "loading" }
  | { phase: "ready"; items: ExtensionTokenOut[] }
  | { phase: "error"; message: string };

/** `attachment; filename="quick-note-export-2026-10-22.json"` -> the file name. */
function filenameFrom(header: string | null, format: ExportFormat): string {
  const match = header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (match?.[1]) {
    return decodeURIComponent(match[1]);
  }
  const day = new Date().toISOString().slice(0, 10);
  return `quick-note-export-${day}.${format === "json" ? "json" : "md"}`;
}

export function SettingsView() {
  const router = useRouter();
  const { me, extensionStatus, refreshExtension } = useApp();

  const [tokens, setTokens] = useState<TokensState>({ phase: "loading" });
  const [revokeTarget, setRevokeTarget] = useState<ExtensionTokenOut | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    const result = await apiJson<ExtensionTokenList>("/api/v1/extension-tokens");
    setTokens(
      result.ok
        ? { phase: "ready", items: result.data.items }
        : { phase: "error", message: result.error?.message ?? "Could not load connected extensions." },
    );
  }, []);

  useEffect(() => {
    // Mount-only fetch; the state update happens after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount effect, no update loop
    void loadTokens();
  }, [loadTokens]);

  async function revoke() {
    if (!revokeTarget) {
      return;
    }
    setRevoking(true);
    setRevokeError(null);
    const result = await apiJson<void>(`/api/v1/extension-tokens/${revokeTarget.id}`, {
      method: "DELETE",
    });
    setRevoking(false);
    if (!result.ok && result.status !== 404) {
      setRevokeError(result.error?.message ?? "Could not revoke it. Please try again.");
      return;
    }
    const id = revokeTarget.id;
    setTokens((current) =>
      current.phase === "ready"
        ? { phase: "ready", items: current.items.filter((token) => token.id !== id) }
        : current,
    );
    setRevokeTarget(null);
    await refreshExtension();
  }

  async function disconnectThisBrowser() {
    setDisconnecting(true);
    await disconnectExtension();
    await refreshExtension();
    setDisconnecting(false);
  }

  async function download(format: ExportFormat) {
    setExporting(format);
    setExportError(null);
    try {
      const response = await apiFetch(`/api/v1/export?format=${format}`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setExportError(payload?.error?.message ?? "Could not export your notes. Please try again.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFrom(response.headers.get("content-disposition"), format);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError("You seem to be offline. Please try again.");
    } finally {
      setExporting(null);
    }
  }

  async function deleteAccount() {
    if (confirmText !== "DELETE") {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    const result = await apiJson<void>("/api/v1/me", {
      method: "DELETE",
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    if (result.ok) {
      // Best effort: make this browser's extension forget its (now dead) token.
      await disconnectExtension();
      router.replace("/");
      router.refresh();
      return;
    }
    setDeleting(false);
    if (result.status === 503 && result.error?.code === "account_deletion_unavailable") {
      setDeleteError(
        "Deleting accounts isn't turned on yet. Nothing was deleted. Please try again later.",
      );
      return;
    }
    setDeleteError(result.error?.message ?? "Could not delete your account. Please try again.");
  }

  return (
    <div className="page-wrap">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Your account, connected extensions, and your data.</p>
        </div>
      </header>

      <section className="card stack" aria-labelledby="account-heading">
        <h2 id="account-heading">Account</h2>
        <dl className="kv">
          <dt>Email</dt>
          <dd>{me.user.email ?? me.account.email ?? "No email"}</dd>
          <dt>Member since</dt>
          <dd>{formatDate(me.account.created_at)}</dd>
        </dl>
      </section>

      <section className="card stack" aria-labelledby="extensions-heading">
        <div className="section-row">
          <h2 id="extensions-heading">Connected extensions</h2>
          <StatusBadge status={extensionStatus} />
        </div>
        <p className="muted small">
          Each one can only add notes. Revoke any you don&apos;t use or don&apos;t recognize.
        </p>

        {tokens.phase === "loading" ? (
          <p className="muted" role="status">
            Loading…
          </p>
        ) : null}
        {tokens.phase === "error" ? (
          <div className="row">
            <p className="notice error" role="alert">
              {tokens.message}
            </p>
            <button className="button ghost" type="button" onClick={() => void loadTokens()}>
              Try again
            </button>
          </div>
        ) : null}
        {tokens.phase === "ready" && tokens.items.length === 0 ? (
          <p className="muted">
            Nothing connected yet. <Link href="/quick-note">Set up Quick Note</Link>.
          </p>
        ) : null}
        {tokens.phase === "ready" && tokens.items.length > 0 ? (
          <ul className="token-list">
            {tokens.items.map((token) => (
              <li key={token.id} className="token-row">
                <div className="token-info">
                  <strong>{token.label || "Browser extension"}</strong>
                  <span className="muted small">
                    Connected {formatDateTime(token.created_at)} · Last used{" "}
                    {formatDateTime(token.last_used_at)}
                  </span>
                </div>
                <button
                  className="button ghost small-button danger-text"
                  type="button"
                  onClick={() => {
                    setRevokeError(null);
                    setRevokeTarget(token);
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {extensionStatus === "connected" ? (
          <div className="row">
            <button
              className="button ghost small-button"
              type="button"
              onClick={() => void disconnectThisBrowser()}
              disabled={disconnecting}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect this browser"}
            </button>
            <span className="muted small">Signs the extension out here. Revoke the key above too.</span>
          </div>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="export-heading">
        <h2 id="export-heading">Export your notes</h2>
        <p className="muted small">Download every note. JSON for apps, Markdown for reading.</p>
        {exportError ? (
          <p className="notice error" role="alert">
            {exportError}
          </p>
        ) : null}
        <div className="row">
          <button
            className="button secondary"
            type="button"
            onClick={() => void download("json")}
            disabled={exporting !== null}
          >
            {exporting === "json" ? "Preparing…" : "Download JSON"}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => void download("markdown")}
            disabled={exporting !== null}
          >
            {exporting === "markdown" ? "Preparing…" : "Download Markdown"}
          </button>
        </div>
      </section>

      <section className="card stack danger-zone" aria-labelledby="delete-heading">
        <h2 id="delete-heading">Delete account</h2>
        <p className="muted small">
          This deletes your account, every note, and every connected extension. It can&apos;t be
          undone. Export first if you want a copy.
        </p>
        <div className="row">
          <button
            className="button danger"
            type="button"
            onClick={() => {
              setConfirmText("");
              setDeleteError(null);
              setDeleteOpen(true);
            }}
          >
            Delete account
          </button>
        </div>
      </section>

      <Dialog
        open={revokeTarget !== null}
        title="Revoke this extension?"
        onClose={() => {
          if (!revoking) {
            setRevokeTarget(null);
          }
        }}
      >
        <p className="muted">
          {revokeTarget?.label || "This extension"} will stop saving notes. You can connect it again
          from the Quick Note page.
        </p>
        {revokeError ? (
          <p className="notice error" role="alert">
            {revokeError}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="button danger" type="button" onClick={() => void revoke()} disabled={revoking}>
            {revoking ? "Revoking…" : "Revoke"}
          </button>
          <button
            className="button ghost"
            type="button"
            onClick={() => setRevokeTarget(null)}
            disabled={revoking}
            data-autofocus
          >
            Cancel
          </button>
        </div>
      </Dialog>

      <Dialog
        open={deleteOpen}
        title="Delete your account?"
        onClose={() => {
          if (!deleting) {
            setDeleteOpen(false);
          }
        }}
      >
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            void deleteAccount();
          }}
        >
          <p className="muted">
            All your notes will be gone for good. To confirm, type <strong>DELETE</strong> below.
          </p>
          <div className="field">
            <label htmlFor="delete-confirm">Type DELETE to confirm</label>
            <input
              id="delete-confirm"
              className="input"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              data-autofocus
            />
          </div>
          {deleteError ? (
            <p className="notice error" role="alert">
              {deleteError}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button
              className="button danger"
              type="submit"
              disabled={confirmText !== "DELETE" || deleting}
            >
              {deleting ? "Deleting…" : "Delete my account"}
            </button>
            <button
              className="button ghost"
              type="button"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancel
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

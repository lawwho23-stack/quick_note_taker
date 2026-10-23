"use client";

import type { ExtensionTokenCreated } from "@quick-note/shared";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { StatusBadge, useApp } from "@/components/app-shell";
import { CopyField } from "@/components/copy-field";
import { apiJson } from "@/lib/api";
import {
  connectExtension,
  EXTENSION_DOWNLOAD_URL,
  EXTENSION_STORE_URL,
  pingExtension,
} from "@/lib/extension";
import { useLocalFlag } from "@/lib/local-flag";

const EXTENSIONS_URL = "chrome://extensions";
const SHORTCUTS_URL = "chrome://extensions/shortcuts";
const GLOBAL_FLAG_KEY = "quick-note:shortcut-global-confirmed";
const TEST_SECONDS = 30;

type ConnectState =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "error"; message: string };

type TestState =
  | { phase: "idle" }
  | { phase: "running"; secondsLeft: number }
  | { phase: "passed" }
  | { phase: "failed"; message: string };

function browserLabel(): string {
  const agent = navigator.userAgent;
  const browser = agent.includes("Edg/") ? "Edge" : "Chrome";
  const platform = /Mac/i.test(agent) ? "Mac" : /Windows/i.test(agent) ? "Windows" : /Linux/i.test(agent) ? "Linux" : "";
  return platform ? `${browser} on ${platform}` : browser;
}

function StepHead({
  number,
  title,
  done,
}: {
  number: number;
  title: string;
  done: boolean;
}) {
  return (
    <div className="setup-step-head">
      <span className={done ? "step-num done" : "step-num"} aria-hidden="true">
        {done ? "✓" : number}
      </span>
      <h2>
        {title}
        <span className="visually-hidden">{done ? " (done)" : " (to do)"}</span>
      </h2>
    </div>
  );
}

export function QuickNoteView() {
  const { extensionStatus, refreshExtension } = useApp();
  const [connect, setConnect] = useState<ConnectState>({ phase: "idle" });
  const [checking, setChecking] = useState(false);
  const [globalConfirmed, setGlobalConfirmed] = useLocalFlag(GLOBAL_FLAG_KEY);
  const [test, setTest] = useState<TestState>({ phase: "idle" });
  const testTimerRef = useRef<number | null>(null);

  const installed = extensionStatus === "installed" || extensionStatus === "connected";
  const connected = extensionStatus === "connected";

  useEffect(() => {
    return () => {
      if (testTimerRef.current !== null) {
        window.clearInterval(testTimerRef.current);
      }
    };
  }, []);

  async function checkAgain() {
    setChecking(true);
    await refreshExtension();
    setChecking(false);
  }

  async function onConnect() {
    setConnect({ phase: "working" });
    const created = await apiJson<ExtensionTokenCreated>("/api/v1/extension-tokens", {
      method: "POST",
      body: JSON.stringify({ label: browserLabel() }),
    });
    if (!created.ok) {
      setConnect({
        phase: "error",
        message: created.error?.message ?? "Could not create a connection. Please try again.",
      });
      return;
    }
    // The secret lives only in this local variable: never in state, storage or the page.
    let token: string | null = created.data.token;
    const tokenId = created.data.id;
    const result = await connectExtension(token);
    token = null;

    if (result.ok && result.reply.ok) {
      setConnect({ phase: "idle" });
      await refreshExtension();
      return;
    }
    // Don't leave an unused token behind.
    await apiJson(`/api/v1/extension-tokens/${tokenId}`, { method: "DELETE" });
    let message = "The extension didn't answer. Make sure it is installed and turned on, then try again.";
    if (result.ok && !result.reply.ok) {
      message = "The extension couldn't verify the connection. Please try again.";
    }
    setConnect({ phase: "error", message });
    await refreshExtension();
  }

  function stopTest(next: TestState) {
    if (testTimerRef.current !== null) {
      window.clearInterval(testTimerRef.current);
      testTimerRef.current = null;
    }
    setTest(next);
  }

  async function startTest() {
    if (testTimerRef.current !== null) {
      return;
    }
    const first = await pingExtension();
    if (!first.ok) {
      setTest({ phase: "failed", message: "We can't reach the extension. Check step 1 first." });
      return;
    }
    const baseline = first.reply.lastOpenedAt;
    const startedAt = Date.now();
    let inFlight = false;
    setTest({ phase: "running", secondsLeft: TEST_SECONDS });

    testTimerRef.current = window.setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      if (elapsed >= TEST_SECONDS) {
        stopTest({
          phase: "failed",
          message:
            "We didn't see the note box open. Check the shortcut in step 3, then try again.",
        });
        return;
      }
      setTest({ phase: "running", secondsLeft: TEST_SECONDS - elapsed });
      if (inFlight) {
        return; // skip this tick; the last ping is still waiting
      }
      inFlight = true;
      const result = await pingExtension(900);
      inFlight = false;
      if (testTimerRef.current === null) {
        return; // stopped while we were waiting
      }
      const opened = result.ok ? result.reply.lastOpenedAt : null;
      if (opened !== null && (baseline === null || opened > baseline)) {
        stopTest({ phase: "passed" });
      }
    }, 1000);
  }

  return (
    <div className="page-wrap">
      <header className="page-head">
        <div>
          <h1>Quick Note</h1>
          <p className="muted">
            Set up the shortcut once. Then press it anywhere to save an idea in a second.
          </p>
        </div>
        <StatusBadge status={extensionStatus} />
      </header>

      <ol className="setup-steps">
        <li className="card setup-step">
          <StepHead number={1} title="Install the extension" done={installed} />
          {installed ? (
            <p className="muted">The extension is installed in this browser.</p>
          ) : (
            <div className="stack">
              {EXTENSION_STORE_URL ? (
                <p>
                  <a className="button" href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer">
                    Get it from the store
                  </a>
                </p>
              ) : (
                <>
                  <p>
                    <a className="button" href={EXTENSION_DOWNLOAD_URL}>
                      Download Quick Note
                    </a>
                  </p>
                  <ol className="plain-steps">
                    <li>
                      Unzip the file (a Mac often does this for you). Move the{" "}
                      <strong>quick-note-extension</strong> folder somewhere safe, like Documents. If you
                      delete it, the extension stops working.
                    </li>
                    <li>
                      Copy this address into a new tab (it works in Edge too) and turn on{" "}
                      <strong>Developer mode</strong> at the top right:
                    </li>
                  </ol>
                  <CopyField value={EXTENSIONS_URL} label="Extensions page address" />
                  <ol className="plain-steps" start={3}>
                    <li>
                      Click <strong>Load unpacked</strong> and pick the <strong>quick-note-extension</strong>{" "}
                      folder.
                    </li>
                    <li>
                      Come back here and click <strong>Check again</strong>.
                    </li>
                  </ol>
                  <p className="muted small">
                    The browser may warn you about developer mode extensions. That is normal for apps
                    installed this way. The store version is coming soon.
                  </p>
                </>
              )}
              <p className="muted small">
                Works in Chrome and Edge on a computer. Safari and phones are not supported.
              </p>
              <div className="row">
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => void checkAgain()}
                  disabled={checking || extensionStatus === "checking"}
                >
                  {checking ? "Checking…" : "Check again"}
                </button>
              </div>
            </div>
          )}
        </li>

        <li className="card setup-step">
          <StepHead number={2} title="Connect it to your account" done={connected} />
          {connected ? (
            <p className="muted">
              Connected. Notes you capture land in <Link href="/notes">Notes</Link>. You can disconnect
              it any time in <Link href="/settings">Settings</Link>.
            </p>
          ) : (
            <div className="stack">
              <p className="muted">
                This gives the extension a key that can only add notes. It can&apos;t read your notes.
              </p>
              {connect.phase === "error" ? (
                <p className="notice error" role="alert">
                  {connect.message}
                </p>
              ) : null}
              <div className="row">
                <button
                  className="button"
                  type="button"
                  onClick={() => void onConnect()}
                  disabled={!installed || connect.phase === "working"}
                >
                  {connect.phase === "working" ? "Connecting…" : "Connect"}
                </button>
                {!installed ? <span className="muted small">Install the extension first.</span> : null}
              </div>
            </div>
          )}
        </li>

        <li className="card setup-step">
          <StepHead number={3} title="Make the shortcut work everywhere" done={globalConfirmed} />
          <div className="stack">
            <p className="muted">
              Browsers don&apos;t let websites open this page, so copy the address and paste it into a
              new tab:
            </p>
            <CopyField value={SHORTCUTS_URL} label="Shortcuts page address" />
            <ol className="plain-steps">
              <li>
                Find <strong>Quick Note</strong> in the list.
              </li>
              <li>
                Keep the default (<kbd className="small">Ctrl</kbd> <kbd className="small">Shift</kbd>{" "}
                <kbd className="small">7</kbd>) or pick your own keys.
              </li>
              <li>
                Change <strong>In Chrome</strong> to <strong>Global</strong>, so it works even when the
                browser is in the background.
              </li>
            </ol>
            <p className="notice info small">
              On a Mac, want <kbd className="small">Space</kbd> + <kbd className="small">N</kbd>? The
              optional Quick Note helper app for macOS listens for it and presses your shortcut for you.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={globalConfirmed}
                onChange={(event) => setGlobalConfirmed(event.target.checked)}
              />
              I set the shortcut to Global
            </label>
          </div>
        </li>

        <li className="card setup-step">
          <StepHead number={4} title="Try it" done={test.phase === "passed"} />
          <div className="stack">
            <p className="muted">
              Click Start, then press your shortcut. We&apos;ll watch for the note box to open.
            </p>
            <div className="row">
              <button
                className="button"
                type="button"
                onClick={() => void startTest()}
                disabled={!installed || test.phase === "running"}
              >
                {test.phase === "running" ? "Waiting…" : test.phase === "idle" ? "Start" : "Test again"}
              </button>
              {test.phase === "running" ? (
                <button className="button ghost" type="button" onClick={() => stopTest({ phase: "idle" })}>
                  Stop
                </button>
              ) : null}
            </div>
            <div role="status" aria-live="polite">
              {test.phase === "running" ? (
                <p className="notice info">
                  Press your shortcut now… <span className="tabular">{test.secondsLeft}s</span> left
                </p>
              ) : null}
              {test.phase === "passed" ? (
                <p className="notice success">It works! The note box opened. You&apos;re all set.</p>
              ) : null}
              {test.phase === "failed" ? <p className="notice error">{test.message}</p> : null}
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
}

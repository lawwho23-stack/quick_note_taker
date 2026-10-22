"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

const COOLDOWN_SECONDS = 60;

/** Read Retry-After as whole seconds; fall back to the default cooldown. */
function retryAfterSeconds(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : COOLDOWN_SECONDS;
}

/**
 * Resends the confirmation email for `email`.
 *
 * After every send, and after a 429 from the API, the button waits out a
 * cooldown so a user cannot hammer the email provider by clicking repeatedly.
 * `initialCooldown` covers an email that was just sent before the button appeared.
 */
export function ResendButton({
  email,
  initialCooldown = 0,
}: {
  email: string;
  initialCooldown?: number;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "limited" | "failed">("idle");
  const [cooldown, setCooldown] = useState(initialCooldown);
  const [limitedFor, setLimitedFor] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function onResend() {
    setState("sending");
    let response: Response;
    try {
      response = await apiFetch("/api/v1/auth/resend", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    } catch {
      setState("failed");
      return;
    }
    // The API answers 202 whether or not the address exists, so only a rate
    // limit or a transport failure counts as a failure here.
    if (response.status === 429) {
      const seconds = retryAfterSeconds(response);
      setLimitedFor(seconds);
      setCooldown(seconds);
      setState("limited");
      return;
    }
    if (!response.ok) {
      setState("failed");
      return;
    }
    setCooldown(COOLDOWN_SECONDS);
    setState("sent");
  }

  const waiting = cooldown > 0;

  return (
    <div className="stack">
      {state === "sent" ? (
        <p className="notice info">Another email is on its way. It can take a minute.</p>
      ) : null}
      {state === "limited" ? (
        <p className="notice error">Too many emails. Try again in {limitedFor} seconds.</p>
      ) : null}
      {state === "failed" ? (
        <p className="notice error">Could not resend right now. Wait a moment and try again.</p>
      ) : null}
      <button
        className="button secondary"
        type="button"
        onClick={() => void onResend()}
        disabled={state === "sending" || waiting || !email}
      >
        {state === "sending"
          ? "Sending…"
          : waiting
            ? `Resend available in ${cooldown}s`
            : "Resend confirmation email"}
      </button>
    </div>
  );
}

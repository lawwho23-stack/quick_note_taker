"use client";

import { useId, useRef, useState } from "react";

/** Read-only text with a Copy button. Falls back to selecting the text. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      inputRef.current?.select();
      setState("manual");
    }
    window.setTimeout(() => setState("idle"), 2500);
  }

  return (
    <div className="copy-field">
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        className="input copy-input"
        readOnly
        value={value}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button className="button secondary" type="button" onClick={() => void copy()}>
        {state === "copied" ? "Copied" : "Copy"}
      </button>
      <span className="visually-hidden" role="status">
        {state === "copied" ? "Copied to clipboard" : state === "manual" ? "Press Ctrl+C or ⌘C to copy" : ""}
      </span>
    </div>
  );
}

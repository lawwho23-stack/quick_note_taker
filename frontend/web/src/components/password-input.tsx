"use client";

import { useState } from "react";

/** Password field with a Show/Hide toggle, so people can check what they typed. */
export function PasswordInput({
  value,
  onChange,
  autoComplete,
  minLength,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="field">
      <label htmlFor="password">Password</label>
      <div className="password">
        <input
          className="input"
          id="password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={hint ? "password-hint" : undefined}
        />
        <button
          className="password-toggle"
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {hint ? (
        <span className="hint" id="password-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

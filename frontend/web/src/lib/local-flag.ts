"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A true/false flag kept in localStorage, readable during render without
 * hydration mismatches (the server snapshot is always `false`).
 */
const listeners = new Set<() => void>();
/** Used when storage is blocked (private mode), so the flag still works this visit. */
const memory = new Map<string, boolean>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return memory.get(key) ?? false;
  }
}

export function useLocalFlag(key: string): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const set = useCallback(
    (next: boolean) => {
      memory.set(key, next);
      try {
        if (next) {
          window.localStorage.setItem(key, "1");
        } else {
          window.localStorage.removeItem(key);
        }
      } catch {
        // Storage blocked; `memory` keeps the value until the page closes.
      }
      listeners.forEach((listener) => listener());
    },
    [key],
  );
  return [value, set];
}

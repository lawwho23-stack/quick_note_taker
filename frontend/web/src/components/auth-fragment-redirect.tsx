"use client";

import { useEffect } from "react";

/**
 * Email confirmation links land on the site with their tokens in the URL
 * fragment (`#access_token=...`). Fragments never reach the server, so this
 * client component forwards them to /auth/confirm, which hands them to the API.
 */
export function AuthFragmentRedirect({ target = "/auth/confirm" }: { target?: string }) {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("access_token=") || hash.includes("error=")) {
      window.location.replace(`${target}${hash}`);
    }
  }, [target]);

  return null;
}

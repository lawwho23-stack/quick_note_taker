import Link from "next/link";

/**
 * The Quick Note mark: Quinn's glasses. One lens sees the idea, the other types it.
 * Quinn's mustache curls under the bridge. `size` is the width.
 */
export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round((size * 72) / 120)} viewBox="0 0 120 72" aria-hidden="true">
      <line x1="50" y1="28" x2="70" y2="28" stroke="#2C5A1B" strokeWidth="7" />
      <rect x="4" y="6" width="46" height="44" rx="12" fill="#CDEFA9" stroke="#2C5A1B" strokeWidth="7" />
      <rect x="70" y="6" width="46" height="44" rx="12" fill="#CDEFA9" stroke="#2C5A1B" strokeWidth="7" />
      <ellipse cx="27" cy="29" rx="8" ry="10.5" fill="#1B1B1F" />
      <circle cx="29.8" cy="24.5" r="2.8" fill="#FFFFFF" />
      <rect x="83" y="25.5" width="12" height="5" rx="2.5" fill="#8CB86B" />
      <rect x="97" y="15" width="7" height="26" rx="3.5" fill="#2C5A1B" />
      <path
        d="M60 56 C55 50 44 50 38 57 C35 60 31 59 30 56 C30 63 40 66 49 62 C54 60 57 59 60 60 C63 59 66 60 71 62 C80 66 90 63 90 56 C89 59 85 60 82 57 C76 50 65 50 60 56 Z"
        fill="#4A2E1A"
        stroke="#2C5A1B"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ size = 48 }: { size?: number }) {
  return (
    <Link className="logo" href="/">
      <LogoMark size={size} />
      Quick Note
    </Link>
  );
}

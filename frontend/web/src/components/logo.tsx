import Link from "next/link";

/**
 * The Quick Note mark: Quinn's glasses. One lens sees the idea, the other types it.
 * `size` is the width; the mark is a little under twice as wide as it is tall.
 */
export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round((size * 64) / 120)} viewBox="0 0 120 64" aria-hidden="true">
      <line x1="50" y1="28" x2="70" y2="28" stroke="#2C5A1B" strokeWidth="7" />
      <rect x="4" y="6" width="46" height="44" rx="12" fill="#CDEFA9" stroke="#2C5A1B" strokeWidth="7" />
      <rect x="70" y="6" width="46" height="44" rx="12" fill="#CDEFA9" stroke="#2C5A1B" strokeWidth="7" />
      <ellipse cx="27" cy="29" rx="8" ry="10.5" fill="#1B1B1F" />
      <circle cx="29.8" cy="24.5" r="2.8" fill="#FFFFFF" />
      <rect x="83" y="25.5" width="12" height="5" rx="2.5" fill="#8CB86B" />
      <rect x="97" y="15" width="7" height="26" rx="3.5" fill="#2C5A1B" />
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

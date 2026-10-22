import Link from "next/link";

/** The Quick Note mark: a text box with a caret, ready to type. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="#1F5FE0" />
      <rect x="6" y="12.5" width="28" height="15" rx="7.5" fill="#FFFFFF" />
      <rect x="11.5" y="18.5" width="9" height="3" rx="1.5" fill="#B9CCF7" />
      <rect x="23.5" y="16" width="3" height="8" rx="1.5" fill="#1F5FE0" />
    </svg>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <Link className="logo" href="/">
      <LogoMark size={size} />
      Quick Note
    </Link>
  );
}

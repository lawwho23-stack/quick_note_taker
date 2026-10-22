import { Logo } from "@/components/logo";

/** Shared frame for sign-in, sign-up and the link-handling pages. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <Logo />
      <section className="auth-card">{children}</section>
      <p className="auth-footer">Your notes are private to your account.</p>
    </main>
  );
}

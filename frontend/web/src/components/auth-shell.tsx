import { Logo, LogoMark } from "@/components/logo";
import { QuinnHead } from "@/components/quinn";

/** Shared frame for sign-in, sign-up and the link-handling pages. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <Logo />
      <section className="auth-card">
        <div className="auth-brand">
          <QuinnHead size={56} />
          <LogoMark size={64} />
        </div>
        {children}
      </section>
      <p className="auth-footer">Your notes are private to your account.</p>
    </main>
  );
}

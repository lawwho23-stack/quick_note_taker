import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How Quick Note handles your notes and your data, in plain language.",
};

export default function PrivacyPage() {
  return (
    <main className="container">
      <header className="site-nav">
        <Logo />
        <nav aria-label="Main">
          <Link className="nav-link strong" href="/sign-in">
            Sign in
          </Link>
        </nav>
      </header>

      <article className="prose">
        <h1>Privacy</h1>
        <p className="muted">Last updated: October 22, 2026</p>

        <p>
          Quick Note saves short notes for you. This page explains, in plain words, what we keep,
          why, and what you can do about it.
        </p>

        <h2>What we store</h2>
        <ul>
          <li>
            <strong>Your account:</strong> your email address and when you signed up. Sign-in is
            handled by our auth provider (Supabase).
          </li>
          <li>
            <strong>Your notes:</strong> the text you write, when it was created and changed, and
            where it came from (the website or the extension).
          </li>
          <li>
            <strong>Connected extensions:</strong> a label like &quot;Chrome on Mac&quot;, when it
            was connected and last used. We keep only a fingerprint (a hash) of the extension&apos;s
            key, never the key itself.
          </li>
        </ul>

        <h2>How your notes are stored</h2>
        <p>
          Notes are stored as <strong>plain text</strong> on our server, so we can show and search
          them for you. They are not end-to-end encrypted. They are sent over HTTPS, and the
          database keeps each account&apos;s notes separate from everyone else&apos;s.
        </p>
        <p>
          We have no tools for reading people&apos;s notes. Access to the database is limited to
          running the service (for example backups, fixing outages, or a legal request).
        </p>

        <h2>What we don&apos;t do</h2>
        <ul>
          <li>We don&apos;t sell your data or show ads.</li>
          <li>We don&apos;t use your notes to train AI models.</li>
          <li>We don&apos;t send note text to our error-tracking tool.</li>
        </ul>

        <h2>Your choices</h2>
        <ul>
          <li>
            <strong>Export:</strong> download every note as JSON or Markdown from{" "}
            <Link href="/settings">Settings</Link>.
          </li>
          <li>
            <strong>Delete:</strong> delete single notes, or delete your whole account in Settings.
            Deleting your account removes your notes and connected extensions.
          </li>
          <li>
            <strong>Disconnect:</strong> revoke any connected extension in Settings at any time.
          </li>
        </ul>

        <h2>The browser extension</h2>
        <p>The Quick Note extension asks for these permissions:</p>
        <ul>
          <li>
            <strong>Storage</strong>: to keep its connection key and any unsent draft on your
            computer.
          </li>
          <li>
            <strong>Active tab</strong> and <strong>scripting</strong>: to show the note box on the
            page you are looking at, only when you press the shortcut.
          </li>
          <li>
            <strong>Access to the Quick Note API</strong>: to save your notes. It talks to no other
            site.
          </li>
        </ul>
        <p>
          The extension doesn&apos;t read the pages you visit and doesn&apos;t track your browsing.
          Its key can only add notes. It can&apos;t read, change, or delete them.
        </p>

        <h2>Cookies</h2>
        <p>
          We use a few cookies only to keep you signed in and to protect forms from forgery. No
          tracking or advertising cookies.
        </p>

        <h2>Changes</h2>
        <p>If this policy changes in a way that matters, we&apos;ll update the date above.</p>
      </article>

      <footer className="site-footer">
        <span>Quick Note</span>
        <Link href="/">Home</Link>
      </footer>
    </main>
  );
}

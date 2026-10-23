import Link from "next/link";

import { AuthFragmentRedirect } from "@/components/auth-fragment-redirect";
import { HeroDemo } from "@/components/hero-demo";
import { Logo, LogoMark } from "@/components/logo";
import { QuinnRunning } from "@/components/quinn";

function Check() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#2C5A1B"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

const SAMPLE_NOTES = [
  { title: "Video idea: 3 mistakes beginners make with Claude Code", meta: "2 min ago" },
  { title: "Hook: I built an app in one prompt and here is what broke", meta: "Yesterday" },
  { title: "Series: agent memory explained in 60 seconds", meta: "Mon" },
  { title: "Thumbnail: split screen, before and after", meta: "Sun" },
];

export default function HomePage() {
  return (
    <main>
      <div className="container">
        <header className="site-nav">
          <Logo />
          <nav aria-label="Main">
            <a className="nav-link optional" href="#how">
              How it works
            </a>
            <a className="nav-link optional" href="#features">
              Features
            </a>
            <Link className="nav-link strong" href="/sign-in">
              Sign in
            </Link>
            <Link className="button" href="/sign-up">
              Get started
            </Link>
          </nav>
        </header>

        <section className="hero">
          <span className="hero-quinn">
            <QuinnRunning size={170} />
          </span>
          <span className="pill">One shortcut. One text box.</span>
          <h1>Catch the idea before it slips away.</h1>
          <p className="lede">
            Press a shortcut, type your idea, hit Enter. Your note is saved and you are back to your
            video, your code, or your draft right away.
          </p>
          <div className="cta-row">
            <Link className="button large" href="/sign-up">
              Create free account
            </Link>
            <a className="button large secondary" href="#how">
              See how it works
            </a>
          </div>
          <span className="fine">Works in Chrome and Edge on Mac and Windows</span>

          <HeroDemo />
        </section>

        <section id="how" className="section">
          <div className="section-head">
            <h2>Three steps. No decisions.</h2>
            <p>No titles, no folders, no formatting. Sort things out later, when you have time.</p>
          </div>
          <div className="steps">
            <div className="step">
              <span className="step-num">1</span>
              <h3>Press your shortcut</h3>
              <p>A small note box opens at the top of your screen, wherever you are.</p>
              <div className="keys">
                <kbd>⌘</kbd>
                <kbd>⇧</kbd>
                <kbd>Y</kbd>
                <span className="fine" style={{ marginLeft: 8 }}>
                  You choose the keys
                </span>
              </div>
            </div>
            <div className="step">
              <span className="step-num">2</span>
              <h3>Type the idea</h3>
              <p>
                One text box, ready to type. Add a new line with Shift and Enter if the idea needs
                more room.
              </p>
            </div>
            <div className="step">
              <span className="step-num">3</span>
              <h3>Press Enter</h3>
              <p>Saved. The box closes and you carry on with what you were doing.</p>
              <div className="keys">
                <kbd>↵</kbd>
                <span className="saved-chip">Saved</span>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="section">
          <div className="split">
            <div>
              <h2>One inbox for every idea.</h2>
              <p>
                Everything you capture lands on the website, newest first. Search it, edit it, and
                take it with you whenever you want.
              </p>
              <ul className="checks">
                <li>
                  <Check />
                  Search across all your notes
                </li>
                <li>
                  <Check />
                  Edit on the web with autosave
                </li>
                <li>
                  <Check />
                  Export everything as Markdown or JSON
                </li>
                <li>
                  <Check />
                  Private to your account
                </li>
              </ul>
            </div>
            <div className="note-list" aria-hidden="true">
              {SAMPLE_NOTES.map((note, index) => (
                <div className={index === 0 ? "note-item active" : "note-item"} key={note.title}>
                  <strong>{note.title}</strong>
                  <span>{note.meta}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="cta-band">
            <div>
              <h2>Ready in about a minute.</h2>
              <p>Create your account with your email. Nothing to install to get started.</p>
            </div>
            <div className="cta-row">
              <Link className="button large" href="/sign-up">
                Get started
              </Link>
              <Link className="button large on-dark" href="/sign-in">
                Sign in
              </Link>
            </div>
          </div>
        </section>

        <footer className="site-footer">
          <span className="row" style={{ gap: 10 }}>
            <LogoMark size={40} />
            Quick Note
          </span>
          <span>Capture ideas without leaving what you are doing.</span>
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>

      <AuthFragmentRedirect />
    </main>
  );
}

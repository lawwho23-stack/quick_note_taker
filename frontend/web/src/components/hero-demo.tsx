"use client";

import { useEffect, useRef, useState } from "react";

const NOTE = "Video idea: 3 mistakes beginners make with Claude Code, and the one-line fix for each";

// One loop of the story: video plays → shortcut → box opens → idea typed → saved.
type Phase = "idle" | "keys" | "open" | "typing" | "press" | "saved";

const TYPE_MS = 38;
const STEPS: { phase: Phase; ms: number }[] = [
  { phase: "idle", ms: 1400 },
  { phase: "keys", ms: 750 },
  { phase: "open", ms: 450 },
  { phase: "typing", ms: NOTE.length * TYPE_MS + 700 },
  { phase: "press", ms: 260 },
  { phase: "saved", ms: 1700 },
];

function Pencil() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#2C5A1B"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M14 7l3 3" />
    </svg>
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The landing-page stage, animated. Decorative only (aria-hidden).
 * With reduced motion, or before hydration, it shows the finished still frame.
 */
export function HeroDemo() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [animated, setAnimated] = useState(false);
  const [phase, setPhase] = useState<Phase>("typing");
  const [typed, setTyped] = useState(NOTE.length);

  // Step through the phases; pause while the stage is off screen.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || prefersReducedMotion()) {
      return;
    }
    let step = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let visible = false;

    const run = () => {
      const current = STEPS[step];
      setPhase(current.phase);
      if (current.phase === "idle") {
        setTyped(0);
      }
      timer = setTimeout(() => {
        step = (step + 1) % STEPS.length;
        if (visible) {
          run();
        }
      }, current.ms);
    };

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !visible) {
        visible = true;
        setAnimated(true);
        run();
      } else if (!entry.isIntersecting && visible) {
        visible = false;
        clearTimeout(timer);
      }
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  // Type the note one character at a time.
  useEffect(() => {
    if (phase !== "typing" || !animated) {
      return;
    }
    const interval = setInterval(() => {
      setTyped((count) => {
        if (count >= NOTE.length) {
          clearInterval(interval);
          return count;
        }
        return count + 1;
      });
    }, TYPE_MS);
    return () => clearInterval(interval);
  }, [phase, animated]);

  return (
    <div
      ref={stageRef}
      className={animated ? "stage stage-animated" : "stage"}
      data-phase={phase}
      aria-hidden="true"
    >
      <div className="stage-bar" style={{ left: 32, width: 110 }} />
      <div className="stage-bar" style={{ left: 156, width: 56, background: "#CDD3DD" }} />
      <div className="stage-keys">
        <kbd>⌘</kbd>
        <kbd>⇧</kbd>
        <kbd>Y</kbd>
      </div>
      <div className="stage-video">
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="30" fill="#FFFFFF" fillOpacity="0.16" />
          <path d="M26 20l20 12-20 12z" fill="#FFFFFF" fillOpacity="0.85" />
        </svg>
        <span className="stage-progress" />
      </div>
      <div className="popup">
        <div className="popup-title">
          <Pencil />
          Quick Note
        </div>
        <div className="popup-text">
          {NOTE.slice(0, typed)}
          <span className="popup-caret" />
        </div>
        <div className="popup-foot">
          <span className="row" style={{ gap: 6 }}>
            <kbd className="small">↵</kbd>Save
          </span>
          <span className="popup-save">Save</span>
        </div>
      </div>
      <div className="stage-toast">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12l5 5L20 7" />
        </svg>
        Saved to your notes
      </div>
    </div>
  );
}

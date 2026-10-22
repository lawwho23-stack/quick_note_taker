import type { Metadata } from "next";

import { QuickNoteView } from "./quick-note-view";

export const metadata: Metadata = { title: "Quick Note setup" };

export default function QuickNotePage() {
  return <QuickNoteView />;
}

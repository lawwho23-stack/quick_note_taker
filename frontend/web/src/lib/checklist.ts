/**
 * Plain-text checklists inside a note body.
 *
 * A line starting with "☐ " is an open item and "☑ " is a done item. The
 * Quick Note extension writes the same markers (frontend/extension/src/lib/checklist.ts).
 */

const OPEN = "☐ ";
const DONE = "☑ ";

export type ChecklistItem = { line: number; done: boolean; text: string };

export function checklistItems(body: string): ChecklistItem[] {
  return body.split("\n").flatMap<ChecklistItem>((raw, line) => {
    if (raw.startsWith(OPEN)) return [{ line, done: false, text: raw.slice(OPEN.length) }];
    if (raw.startsWith(DONE)) return [{ line, done: true, text: raw.slice(DONE.length) }];
    return [];
  });
}

/** Flip the item on line `line`. Other lines are left exactly as they are. */
export function toggleChecklistItem(body: string, line: number): string {
  const lines = body.split("\n");
  const raw = lines[line];
  if (raw === undefined) return body;
  if (raw.startsWith(OPEN)) lines[line] = DONE + raw.slice(OPEN.length);
  else if (raw.startsWith(DONE)) lines[line] = OPEN + raw.slice(DONE.length);
  else return body;
  return lines.join("\n");
}

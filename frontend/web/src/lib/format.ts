/** First non-empty line of a note, used as its title in the list. */
export function noteTitle(body: string): string {
  const line = body.split("\n").find((part) => part.trim() !== "");
  return line?.trim() || "Empty note";
}

/** The text after the first line, flattened for a one-line preview. */
export function notePreview(body: string): string {
  const lines = body.split("\n").filter((part) => part.trim() !== "");
  return lines.slice(1).join(" ").trim();
}

/** "Oct 22, 2026, 3:04 PM" in the reader's locale. */
export function formatDateTime(value: string | null): string {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDate(value: string | null): string {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { dateStyle: "long" });
}

/** Short label for the list: time today, otherwise the date. */
export function formatListDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

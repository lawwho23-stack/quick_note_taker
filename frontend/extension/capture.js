// Quick Note — M0 capture page.
// Minimal behavior: autofocus, Esc closes, Enter shows a "no backend yet"
// flash. The real save flow (with the backend) arrives with M4.

const params = new URLSearchParams(location.search);
const trigger = params.get("trigger") || "unknown";
document.getElementById("trigger").textContent = trigger;

const editor = document.getElementById("editor");
const status = document.getElementById("status");
const defaultStatus = status.innerHTML;

editor.focus();

let statusTimer = null;
function flash(html) {
  status.innerHTML = html;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.innerHTML = defaultStatus;
  }, 2200);
}

editor.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    window.close();
    return;
  }
  // Do not trigger save-like behavior while an input method is composing.
  if (e.isComposing) return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    flash('<span class="note">M0: would save here — no backend yet ✓</span>');
  }
});

// When freshly opened (not focused from a previous instance), bring the
// window forward and put the cursor back in the textarea.
window.addEventListener("focus", () => editor.focus());

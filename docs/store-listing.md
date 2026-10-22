# Store listing (Chrome Web Store and Edge Add-ons)

## Name
Quick Note

## Short description (132 characters max)
Press a shortcut, type a thought, press Enter. Your note is saved to your Quick Note account in seconds.

## Single purpose (required by the Chrome Web Store)
Quick Note does one thing: it opens a small capture box when you press its keyboard shortcut and saves what you type as a note in your Quick Note account.

## Full description
Ideas come fast and leave fast. Quick Note keeps them.

- Press **Ctrl+Shift+7** (you can change it) from any web page. A small box appears at the top of the screen.
- Type your note and press **Enter**. It's saved to your account, and the box closes.
- Read, search, edit and export all your notes at quick-note-web-one.vercel.app.
- Works with Burmese and other input methods. Enter never saves halfway through a word.
- If the network drops, your text is kept and you can retry. Retrying never makes a duplicate.

## Permission justifications
| Permission | Why it is needed |
|---|---|
| `storage` | Keeps your connection token and unsent drafts on your device. |
| `activeTab` | When **you** press the shortcut, it shows the capture box on the current tab. It never reads the page. |
| `scripting` | Draws the capture box on the current tab after you press the shortcut. |
| Host permission for the Quick Note API | Sends the note you typed to your account. Nothing else is sent. |

## Data use disclosure
- **Collected:** only the note text you type into the capture box, and the time it was saved.
- **Not collected:** browsing history, page content, or keystrokes outside the capture box.
- **Not sold or shared** with third parties, and not used for advertising.
- **Privacy policy:** `https://quick-note-web-one.vercel.app/privacy`

## Assets still needed (Laww)
- 128×128 icon (already in `frontend/extension/icons`; check it meets the store rules)
- At least one 1280×800 screenshot of the capture card over a page
- A 440×280 promotional tile (optional)
- A developer account: Chrome Web Store ($5 one-time) and Microsoft Partner Center (free)

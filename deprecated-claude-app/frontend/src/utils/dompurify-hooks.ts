/**
 * DOMPurify hardening hooks shared by all message-rendering components.
 *
 * Side-effect import: this module's import alone installs the hooks. Import
 * it once in any module that calls DOMPurify.sanitize() and the hooks apply
 * globally (DOMPurify is an ESM singleton, so addHook installs once and
 * affects every subsequent sanitize call from any caller).
 *
 *
 * # What this addresses
 *
 * Model output can include raw `<img src="…">` tags (some models emit HTML).
 * DOMPurify's default config already blocks `javascript:` and dangerous
 * schemes, but a benign-looking `<img src="https://attacker.example/track">`
 * still causes every viewer of the conversation to make a live request to
 * that URL — leaking the viewer's IP, the time of view, and (without
 * referrerpolicy) the full referring URL including any tokens in the path.
 *
 * For Arc specifically this matters because:
 *   - Conversations can be shared publicly via tokenized URLs
 *   - Collaborative conversations are viewed by multiple users
 *   - A message author can embed tracking pixels that fire on every viewer
 *
 *
 * # What this does
 *
 *   - `referrerpolicy="no-referrer"` — no Referer header is sent on the
 *     image fetch, so the conversation URL (with share/collab token) is
 *     never disclosed to the embedded image's host.
 *   - `loading="lazy"` — the image only fetches when it scrolls into the
 *     viewport. Off-viewport tracking pixels never fire. Doesn't fully
 *     prevent tracking but raises the cost.
 *
 * Future hardening, deferred:
 *   - Restrict img.src to specific URI patterns (e.g. only `/api/blobs/…`
 *     and the user's own host) via `ALLOWED_URI_REGEXP`. Behavior change —
 *     would break legitimate `![alt](https://…)` markdown that some users
 *     rely on. Decision deferred until there's user-feedback signal.
 *   - Same-origin proxy that strips tracking parameters and re-serves
 *     external images. More involved.
 */
import DOMPurify from 'dompurify';

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'IMG') {
    node.setAttribute('referrerpolicy', 'no-referrer');
    node.setAttribute('loading', 'lazy');
  }
});

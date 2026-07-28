# referencesadrien

A single-page image reference gallery (textures/materials for artists), organized by folder,
with admin-only upload/tagging/organizing tools. Deployed on Netlify.

## Architecture

- **`index.html`** — the entire frontend. One page, one big inline `<style>` block, one big
  inline `<script>` block. No build step, no bundler, no framework. Data flows straight from
  Firestore/Cloudinary into DOM manipulation.
- **`netlify/functions/upload.js`** — receives multipart uploads (Busboy), pushes the file to
  Cloudinary, pre-generates 1200px/1920px derived sizes (`eager`) so the frontend's
  `cloudinaryDisplayUrl()` requests don't transform on first view.
- **`netlify/functions/cloudVision.js`** — calls Google Cloud Vision (`LABEL_DETECTION`) to tag
  an uploaded image; falls back to client-side MobileNet (TensorFlow.js, loaded from a CDN) if
  Vision fails or the key is missing.
- **Firestore** — two collections: `folders` (name, parent) and `images` (url, folder, keywords,
  filename, timestamp). No auth backing this — see "Admin access" below.
- **Cloudinary** — actual image storage/hosting + on-the-fly resizing via URL transforms.

## Environment variables (Netlify)

- `CLOUD_VISION_API` — Google Cloud Vision API key. **Not** `VISION_API_KEY` — a previous
  session used that name by mistake, which silently broke Vision tagging (fell back to
  MobileNet) until it was caught and fixed. If Vision tagging ever looks broken again, check
  this env var name first before assuming the key itself is bad.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — used by `upload.js`.
- Firebase config is a public client-side config object inlined in `index.html` (normal for
  Firebase web apps — it's not a secret, access is controlled by Firestore security rules, not
  by hiding this config).

## Admin access

There's no real auth. "ADMIN ACCESS" opens a `UI Preferences` modal that takes an ID/password
(`#userPreference`) and, on match, reveals the edit buttons (add/move/delete/rename
folders+images, find duplicates). **Keep this gate as-is** — a previous session temporarily
bypassed it "to save time" during upload-flow work; that bypass was reverted when found during
a later merge. Don't remove or short-circuit the password check without being asked.

## Testing

- `npm test` runs Jest against `tests/upload.test.js` (mocks Cloudinary, exercises the upload
  handler's method-check and error paths). No tests exist for `cloudVision.js` or the frontend.
- There's no CI configured on this repo (no `.github/workflows`) — `npm test` before pushing is
  on you/the session, GitHub won't run anything automatically.
- The frontend can't be meaningfully unit-tested (one big inline script, DOM-driven). To check
  a UI change actually works, serve `index.html` (e.g. `python3 -m http.server`) and drive it
  with Playwright/a headless browser. Firebase and the TensorFlow/MobileNet CDN scripts may be
  unreachable in a sandboxed session (egress policy blocking `cdn.jsdelivr.net`/`gstatic.com`) —
  in that case, stub `window.firebase` via `page.addInitScript()` before navigating so the
  top-level `firebase.initializeApp()`/`firebase.firestore()` calls don't throw and the rest of
  the inline script (event listener wiring) still runs.

## Working across sessions

Every session starts from a fresh checkout — no memory carries over except what's committed to
git and what's in this file. Practical implications:

- If you're picking up work that "disappeared," check `git branch -a` / open PRs before assuming
  it was lost — a prior session's branch may just never have been merged.
- When you make a deliberate product/architecture decision that isn't obvious from the code
  (e.g. "keep the admin password gate," "this env var name is intentional"), add it here so the
  next session doesn't re-litigate or accidentally undo it.
- Multiple past sessions have opened overlapping PRs against `main` for related work (tagging,
  upload UX, gallery layout) without merging or coordinating with each other, causing real
  duplicate/conflicting work. Before starting substantial frontend work, check open PRs and
  `git log --all --oneline --graph` for unmerged work touching the same area first.

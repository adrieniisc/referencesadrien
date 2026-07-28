# referencesadrien

A single-page image reference gallery (textures/materials for artists), organized by folder,
with admin-only upload/tagging/organizing tools. Deployed on Netlify.

## Architecture

- **`index.html`** — the entire frontend. One page, one big inline `<style>` block, one big
  inline `<script>` block. No build step, no bundler, no framework. Data flows straight from
  Firestore/Cloudinary into DOM manipulation.
  - `compressImageIfNeeded()` recompresses oversized photos (JPEG quality reduction, not
    resizing) client-side before upload, since Netlify Functions cap request bodies around 6MB —
    an oversized upload that skips this gets rejected mid-stream by `upload.js`'s Busboy parser
    ("Unexpected end of form"), not with a clean size-limit error. It decodes via `<img>`/canvas,
    which can't read HEIC; `heic2any` (another CDN script, same pattern as the TF.js/MobileNet
    ones below) is the fallback decoder when that native decode throws — this covers real
    `.heic`/`.heif` files and also the case where iOS/Safari hands the page raw HEIC bytes under
    a misleading `.jpeg` name/type. Don't remove the native-decode-first path even though
    `heic2any` alone could handle everything — canvas is faster and avoids an unnecessary decode
    round-trip for the common (non-HEIC) case.
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

There's no real auth. "ADMIN ACCESS" opens a `UI Preferences` modal (`#userPreference` field,
`#applyPreferenceBtn`) that reveals the edit buttons (add/move/delete/rename folders+images,
find duplicates) on Apply.

**2026-07-28: the password check was intentionally removed, at the site owner's explicit
request ("no password for admin for now").** `applyPreferenceBtn`'s click handler now grants
admin controls unconditionally — it no longer compares `#userPreference` against the old
base64'd value. The modal/button/field are still there (least invasive change), just gated on
nothing. This directly reverses the previous "keep the gate as-is" guidance below, which stood
only until someone actually asked for it to change — now it has been asked. If you're picking
this back up: don't silently re-add a password check, and don't silently remove the gate
further (e.g. deleting the button/modal) without a fresh explicit request either way — confirm
with the user before changing this again in either direction.

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

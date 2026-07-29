# referencesadrien

A single-page image reference gallery (textures/materials for artists), organized by folder,
with admin-only upload/tagging/organizing tools. Deployed on Netlify.

## Architecture

- **`index.html`** — the entire frontend. One page, one big inline `<style>` block, one big
  inline `<script>` block. No build step, no bundler, no framework. Data flows straight from
  Firestore/Cloudinary into DOM manipulation.
  - Uploads failing with a 502 from `upload.js` — Busboy's "Unexpected end of form" — has turned
    out to have **multiple independent causes that produce the exact same client-visible error**.
    A report of "still broken" after fixing one of these does NOT mean that fix was wrong; check
    which mechanism actually applies (file format? file size? uploaded alongside others?) before
    assuming the same cause needs revisiting again:
    1. **Any HEIC/HEIF upload, regardless of size** — Netlify's function can't reliably accept
       raw HEIC bytes at all. `compressImageIfNeeded()` always decodes and re-encodes HEIC/HEIF
       as JPEG before upload, even a small 2MB HEIC nowhere near the size limit — gating this
       behind a size check (the original design) is why the first attempt at this fix didn't
       work. Detection (`isHeicFile()`) sniffs the file's actual ISO-BMFF `ftyp` box instead of
       trusting name/MIME type, since both can lie (iOS/Safari sometimes hands the page raw HEIC
       bytes under a misleading `.jpeg` name/type). Decoding tries `<img>`/canvas first (most
       browsers can't read HEIC this way, but it's faster and works in some, e.g. Safari);
       `heic2any` (CDN script, same pattern as TF.js/MobileNet below) is the fallback when native
       decode throws, converting to PNG first so the JPEG re-encode stays the only lossy step.
    2. **Oversized photos in general, any format** — Netlify Functions cap request bodies around
       6MB, so anything still too big after HEIC handling gets the same JPEG re-encode, quality
       lowered (not resized) just enough to fit.
    3. **Multiple simultaneous uploads competing for upload bandwidth.** The upload-confirm
       handler used to fire every file's `processUpload()` in an unawaited loop — fully parallel,
       no limit. Several multi-MB uploads racing over the same (often limited) uplink can keep
       any single one from finishing before Netlify's function times out, and Busboy reports
       that identically as "Unexpected end of form". This reproduced even for a genuinely native
       JPEG uploaded alongside several siblings — which is what revealed the problem wasn't
       purely about HEIC. Uploads now run sequentially (`await`ed in a loop) instead of all at
       once; DOM upload-dock items are still all created up front so the queue is visible
       immediately.
- **`netlify/functions/upload.js`** — receives multipart uploads (Busboy), pushes the file to
  Cloudinary, pre-generates 1200px/1920px derived sizes (`eager`) so the frontend's
  `cloudinaryDisplayUrl()` requests don't transform on first view.
  - Busboy's `Multipart` stream emits `'error'` in **two separate places** for one underlying
    parse failure: once on the `busboy` instance itself, and independently on the per-file
    stream handed to the `'file'` event (its `_destroy` explicitly destroys that inner stream
    with the same error). Both need a listener — an EventEmitter that emits `'error'` with zero
    listeners crashes the process — which is why a truncated upload used to take down the whole
    Lambda invocation (502 with a raw internal stack trace) instead of returning a clean,
    retryable error. Confirmed by reproduction in a Jest test: listening only on the outer
    `busboy` still crashed with the identical trace, because the *inner* file stream's error was
    the one actually unhandled.
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

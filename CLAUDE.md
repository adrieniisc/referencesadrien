# referencesadrien

A single-page image reference gallery (textures/materials for artists), organized by folder,
with admin-only upload/tagging/organizing tools. Deployed on Netlify.

## Architecture

- **`index.html`** — the entire frontend. One page, one big inline `<style>` block, one big
  inline `<script>` block. No build step, no bundler, no framework. Data flows straight from
  Firestore/Cloudinary into DOM manipulation.
  - `compressImageIfNeeded()` handles two separate problems that produce the identical symptom
    (`upload.js`'s Busboy parser dies mid-stream with "Unexpected end of form", not a clean
    error): (1) **any** HEIC/HEIF upload, regardless of size — confirmed by reproduction that
    Netlify's function can't reliably accept raw HEIC bytes at all, so these always get decoded
    and re-encoded as JPEG before upload, even a small 2MB HEIC that's nowhere near the size
    limit; (2) oversized photos in general, since Netlify Functions cap request bodies around
    6MB — those get the same JPEG re-encode, quality lowered (not resized) just enough to fit.
    HEIC detection (`isHeicFile()`) sniffs the file's actual ISO-BMFF `ftyp` box instead of
    trusting the name/MIME type, since both can lie (iOS/Safari sometimes hands the page raw
    HEIC bytes under a misleading `.jpeg` name/type). Decoding goes through `<img>`/canvas first
    (most browsers can't read HEIC this way, but it's faster and avoids an unnecessary decode
    round-trip when it does work — e.g. Safari, which often can); `heic2any` (another CDN
    script, same pattern as the TF.js/MobileNet ones below) is the fallback decoder when native
    decode throws, converting to PNG first so the only lossy step stays the JPEG re-encode.
    Don't gate the HEIC path behind the size check again — that was the original (wrong) design
    and it's why the fix didn't work the first time.
  - Delete Images, Move Images, and Edit Tags (2026-07-30) are three separate select-then-act
    modes (`isDeleteMode`/`isMoveMode`/`isTagEditMode`, each with its own `.image-container`
    overlay class and floating controls bar) that all read clicks on the same gallery thumbnails.
    They're mutually exclusive by construction — turning one on turns the other two off — because
    two active at once would double-fire click handlers on the same image. If you add a fourth
    bulk-select mode, wire it into that same turn-off-the-others chain rather than assuming it's
    the only one active. Also: the enlarge/lightbox modal's click handler reads tags from the live
    `data-keywords` attribute (`container.getAttribute('data-keywords')`), not the `keywords`
    function parameter closed over when the thumbnail was created — that parameter goes stale the
    moment Edit Tags updates the attribute, and reintroducing a closure read there would make tag
    edits silently not show up in the lightbox (same silent-failure shape as the delete/move bug
    fixed earlier).
  - "Submit" (2026-07-30, `submitReferenceBtn`/`submitReferenceModal`) is deliberately **not**
    admin-gated — it's the public-facing counterpart to the admin tools above, for visitors who
    want to send the site owner a link (e.g. a Drive folder) or images without needing an email
    address. Submitting writes a doc to the `submissions` Firestore collection (`link`,
    `imageUrls`, `note`, `timestamp`) — **this went through two reversals in the same session,
    worth understanding before touching it again**: first it wrote to Firestore as a backup
    alongside email; then, misread as "automatically adds to the gallery," it was stripped down to
    email-only; then, once the real problem turned out to be "opening 40 individual email links
    one at a time is unworkable," Firestore storage came back — this time specifically to back the
    **Review Submissions** admin panel (see below), not as a backup. The Firestore write is what
    must succeed for a submission to count; the email (`sendSubmissionEmailNotification()`, via
    FormSubmit's AJAX relay to **isakovicadrien@gmail.com**) is fire-and-forget on top of it, just
    a heads-up ping, and its failure is only logged (`.catch()` at the call site), never surfaced
    to the submitter. **isakovicadrien@gmail.com must click the one-time "activate this inbox"**
    email FormSubmit sends on the very first real submission, or the ping just silently never
    arrives — annoying but not load-bearing, since the Firestore doc (and thus the review panel)
    is unaffected either way. Image uploads reuse `compressImageIfNeeded()`/`uploadImage()` as-is
    (same Cloudinary path as admin uploads), sequentially rather than in parallel, for the same
    reason upload.js's `Unexpected end of form` fix made the admin upload dock sequential (see
    above).
  - **Review Submissions** (2026-07-30, `reviewSubmissionsBtn`/`reviewSubmissionsModal`) is the
    admin-only screen that reads the `submissions` collection above: every pending submission
    rendered as real image thumbnails (not raw links) with a per-image folder picker + "Add"
    button, so reviewing a batch of e.g. 40 submitted images means glancing at a grid and clicking
    "Add" on the ones worth keeping, not opening 40 links one at a time. "Add" reuses
    `saveImageToFirebase()`/`addImageToGallery()` **directly** — the image is already sitting on
    Cloudinary from the original submission, so this is not a re-upload, just the same two calls
    `completeUpload()` makes after a normal admin upload finishes. "Dismiss" hard-deletes the
    submission's Firestore doc once it's been dealt with (whether 0, some, or all of its images
    got added) — there's no "mark as reviewed" limbo state, so don't add one without a reason;
    the point was to keep the queue short, not to grow a permanent log.
- **`netlify/functions/upload.js`** — receives multipart uploads (Busboy), pushes the file to
  Cloudinary, pre-generates 1200px/1920px derived sizes (`eager`) so the frontend's
  `cloudinaryDisplayUrl()` requests don't transform on first view.
- **`netlify/functions/cloudVision.js`** — calls Google Cloud Vision (`LABEL_DETECTION`) to tag
  an uploaded image; falls back to client-side MobileNet (TensorFlow.js, loaded from a CDN) if
  Vision fails or the key is missing.
- **Firestore** — three collections: `folders` (name, parent), `images` (url, folder, keywords,
  filename, timestamp), and `submissions` (link, imageUrls, note, timestamp — see "Submit" above).
  Access is controlled by real Firestore security rules now — see "Admin access" below and
  `firestore.rules`.
- **Cloudinary** — actual image storage/hosting + on-the-fly resizing via URL transforms.
- **`firestore.rules`** — the security rules text, checked into this repo **for reference only**.
  There's no `firebase.json`/`.firebaserc` here and this session has no Firebase CLI access, so
  this file is **not** deployed automatically by anything — it has to be manually pasted into
  Firebase Console → Firestore Database → Rules any time it changes, and it's on whoever does
  that to keep this file in sync with what's actually live. Don't assume editing it or committing
  it has any live effect on its own.

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

**2026-07-30: real auth, replacing the no-password gate below.** "ADMIN ACCESS" now opens an
`#adminLoginModal` (email + password) that calls Firebase Auth's
`signInWithEmailAndPassword()`. There is exactly **one** admin account, created manually in
Firebase Console → Authentication → Users, using **isakovicadrien@gmail.com** (the Email/Password
sign-in method must be enabled first, under Authentication → Sign-in method — neither step can be
done from a coding session, no Firebase CLI/project access here).

The client-side button-hiding (`auth.onAuthStateChanged` toggling `editButtons`/`separators`) is
**cosmetic only** — it exists so a random visitor doesn't see admin controls cluttering the page,
nothing more. The actual enforcement is `firestore.rules`: writes to `folders`/`images`, and
reads/writes to `submissions`, require `request.auth.token.email == 'isakovicadrien@gmail.com'`.
This means even someone who forces the hidden buttons visible via devtools still can't write
anything without actually authenticating as that exact account — unlike the previous gate, this
one holds up against a technical visitor reading the page's source, which was the specific
complaint that prompted this change. **The Firestore rules must actually be pasted into the
Firebase Console for any of this to be real** — until then, whatever rules are currently live
there are what's actually enforced, regardless of what `firestore.rules` in this repo says.

**Superseded history, kept for context:** on 2026-07-28 the password check was intentionally
*removed* entirely, at the site owner's explicit request ("no password for admin for now") —
`applyPreferenceBtn` granted admin controls unconditionally, gated on nothing. That decision stood
only until the site owner ran into a concrete problem it caused (an admin-only "Review
Submissions" panel needed to exist, and a client-side-only gate around it was explicitly called
out as insufficient — "can be opened by anyone that decoded the password in the script"). If
you're picking this back up again: don't silently weaken this back to a client-side-only check,
and don't silently change the sign-in method or which account(s) count as admin, without a fresh
explicit request either way.

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
  top-level `firebase.initializeApp()`/`firebase.firestore()`/`firebase.auth()` calls don't throw
  and the rest of the inline script (event listener wiring) still runs. The stub needs a fake
  `auth()` too now (not just `firestore()`) to test anything admin-gated: at minimum
  `onAuthStateChanged(cb)` (call `cb` immediately, keep it to notify on sign-in/out),
  `signInWithEmailAndPassword(email, password)`, `signOut()`, and a `currentUser` getter — real
  Firebase Auth can't run in this sandbox any more than real Firestore can.

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

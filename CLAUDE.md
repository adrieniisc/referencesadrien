# referencesadrien

A single-page image reference gallery (textures/materials for artists), organized by folder,
with admin-only upload/tagging/organizing tools. Deployed on Netlify.

## Architecture

- **`index.html`** — the entire frontend. One page, one big inline `<style>` block, one big
  inline `<script>` block. No build step, no bundler, no framework. Data flows straight from
  Firestore/Cloudinary into DOM manipulation.
  - `compressImageIfNeeded()` (2026-07-30: retargeted to 1.5MB, was ~4.5MB) handles two separate
    problems: (1) **any** HEIC/HEIF upload, regardless of size — confirmed by reproduction that
    Netlify's function can't reliably accept raw HEIC bytes at all (Busboy dies mid-stream with
    "Unexpected end of form"), so these always get decoded and re-encoded as JPEG before upload,
    even a small 2MB HEIC that's nowhere near the size limit; (2) **every** upload over 1.5MB,
    period — this is now a deliberate blanket "keep uploads small" policy (the owner's request),
    not just dodging Netlify's ~6MB request body cap the way it originally was. HEIC detection
    (`isHeicFile()`) sniffs the file's actual ISO-BMFF `ftyp` box instead of trusting the name/MIME
    type, since both can lie (iOS/Safari sometimes hands the page raw HEIC bytes under a misleading
    `.jpeg` name/type). Decoding goes through `<img>`/canvas first (most browsers can't read HEIC
    this way, but it's faster and avoids an unnecessary decode round-trip when it does work — e.g.
    Safari, which often can); `heic2any` (another CDN script, same pattern as the TF.js/MobileNet
    ones below) is the fallback decoder when native decode throws, converting to PNG first so the
    only lossy step stays the JPEG re-encode. Don't gate the HEIC path behind the size check again
    — that was the original (wrong) design and it's why the fix didn't work the first time.
    `encodeCanvasUnderSize()` does the actual fitting: quality drops first (0.92 down to a 0.5
    floor) at the image's original resolution, and only once quality alone can't hit 1.5MB does it
    actually shrink the canvas (in 15%-per-step passes, down to an 800px floor on the shorter
    side) and restart the quality sweep at the smaller size. This ordering is the point — a huge
    photo stepped down to a still-generous resolution at good quality looks better than the same
    photo kept at full resolution and crushed to a very low quality, and most of that resolution is
    invisible anyway once Cloudinary serves it back down to 1200/1920px for display. **2026-07-30:
    considered and rejected** moving this client-side compression to a cloud/compression API
    instead (skip local canvas work, let Cloudinary resize/recompress server-side on a direct
    browser→Cloudinary upload). Rejected because: (1) it only works by bypassing
    `netlify/functions/upload.js` entirely — that Busboy proxy is exactly why client compression
    exists in the first place (its ~6MB request body cap, and its inability to reliably accept raw
    HEIC bytes at all), so "use a cloud API" really means "add a new signed-upload endpoint and
    rewrite the upload path," not a small swap; (2) the network cost of uploading a full-size
    original (a 15-20MB HEIC/RAW phone photo, uncompressed) very plausibly exceeds whatever CPU
    time it saves, especially on mobile/cellular — the local compression step's whole point was
    keeping the bytes going over the wire small; (3) none of it is testable end-to-end in a
    sandboxed session (no live Cloudinary/Firebase network access here). If revisited, the lower-
    risk version of "make it lighter" is trimming `encodeCanvasUnderSize()`'s own quality/
    resolution-stepping loop (e.g. fewer passes, coarser steps), not moving the work off-device.
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
    fixed earlier). `enlargeImage()` also takes the `.image-container` itself as a 4th argument now
    (2026-07-30), stashed in module-level `currentEnlargedContainer` purely so the lightbox's
    prev/next arrows (click or ←/→ keys) know where they are in the currently-visible gallery
    order (`getVisibleGalleryContainers()` — same filtered/sorted list the grid itself shows) and
    can wrap to the next/previous one. Any other future caller of `enlargeImage()` should pass the
    container too, or prev/next will silently no-op for that entry point. Edit Tags' shared field
    (2026-07-30) has two modes tracked by `editTagsAllMatched`, set when the modal opens: if every
    selected image already had identical tags, Save **replaces** them (unchanged from the original
    design); if they differed, Save instead **adds** whatever was typed to each image's own
    existing tags via `mergeTagStrings()` (comma-list union, case-insensitive dedupe) - each image
    keeps its individual previous tags rather than having them clobbered by one value that was
    never even shown for that image. Don't collapse this back to always-replace; that's the exact
    behavior that was reported as a problem.
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
    the point was to keep the queue short, not to grow a permanent log. **`.sidebar` has a higher
    z-index (1100) than `.modal-backdrop` (999)** - a pre-existing mismatch, not introduced here,
    that only bites when a modal is wide enough to visually extend under the sidebar's ~270px
    width, at which point that overlapping strip's clicks land on whatever sidebar button is
    there instead of the modal content underneath (found the hard way: widening this panel to
    980px did exactly that to its own Dismiss button on a 1400px-wide test viewport). Fixed here
    by keeping this panel's `max-width` at 840px instead of properly reordering the z-index stack
    site-wide - if a future modal needs to be wider than roughly `viewport - 540px`, the real fix
    is raising `.modal-backdrop` above 1100 (and re-checking `.about-btn`/`.submit-reference-btn`,
    which sit at 1200 for the same reason), not just shrinking that modal too.
  - **2026-07-30: AI tagging (Google Cloud Vision + client-side MobileNet) removed completely** —
    `netlify/functions/cloudVision.js`, `generateImageTags()`/`generateImageTagsWithMobileNet()`,
    the TF.js/MobileNet CDN `<script>` tags, and the whole end-of-batch "Review Tags" panel
    (`tagReviewPanel`/`initBatchTagReviewUI()`/`addBatchReviewRow()`/`saveBatchReview()`) are gone
    — this was a deliberate product decision (owner's request), not a bug fix, so don't reintroduce
    any of it without a fresh explicit ask. `processUpload()` now goes straight from
    `compressImageIfNeeded()`/`uploadImage()` to `completeUpload()` using only whatever was typed
    into the Keywords field — an image is live in Firestore/the gallery the moment its upload
    finishes, no review/confirm step in between. The upload dock (`.upload-dock`, widened to 420px/
    440px max-height) is now the *only* upload feedback surface, which is why it got bigger — it
    used to just track progress while the real review UI was the tag panel. `.batch-tag-review-
    content`/`.batch-review-thumb`/`.batch-review-thumbs-strip` CSS classes were **kept** — they're
    shared with the still-live Edit Tags modal (`editTagsThumbs`), not exclusive to the removed
    panel; don't delete those again while cleaning up anything nearby.
  - **Publish Queue (2026-07-30)**, in the Add Image modal: besides the existing "Add" button
    (uploads the current file selection immediately, unchanged), "Add to Queue" stages the current
    files+folder+keywords selection into an in-memory `uploadQueue` array instead, rendered as a
    removable list, so several different categories can be staged in one modal session without
    reopening it per folder. "Publish All" then runs every queued batch through the same
    instant-upload path (`startUploadBatch()`, refactored out of the plain Add handler so both
    paths behave identically). The queue is intentionally **not** cleared when the modal is closed
    without publishing — only an explicit Publish All (or a page reload) empties it — so
    accidentally dismissing the modal mid-batch doesn't lose staged work.
  - **Search now treats the folder/category name as an invisible tag too (2026-07-30)** —
    `performSearch()` matches the search term against `data-category` in addition to filename and
    `data-keywords`, so searching "metal" also surfaces every image filed under a Metal folder (or
    Metal/<subfolder>), on top of images anywhere else explicitly tagged "metal". This only affects
    the top search bar; the sidebar's folder-click filtering (`filterImages()`) is unchanged.
  - **`.sidebar-brand` crop fix (2026-07-30)** — the "aReferences" header text could get silently
    cropped at the bottom (no scrollbar, no error) whenever the sidebar's total content grew taller
    than the viewport, e.g. right after admin sign-in reveals the extra footer buttons. Cause: it
    was the only flex child of the column-flex `.sidebar` with `overflow: hidden`, which per the
    flexbox spec gives an element an automatic min-height of `0` instead of its content size —
    every other child resisted shrinking below its content, so *this* element absorbed 100% of the
    squeeze instead of `.sidebar`'s own `overflow-y: auto` kicking in and scrolling like it's
    supposed to. Fixed with `flex-shrink: 0` on `.sidebar-brand`. If a similar "silently shrinks/
    crops instead of scrolling" bug shows up on another flex child, check for the same
    `overflow: hidden` + missing `flex-shrink: 0` combination first. **Superseded 2026-07-30:**
    the brand text moved out of the sidebar entirely (see the header redesign bullet below), so
    `.sidebar-brand` no longer exists and this specific instance is moot — the general lesson
    (flex child with `overflow: hidden` needs `flex-shrink: 0` or it silently absorbs the squeeze)
    still applies anywhere else in the sidebar.
  - **Header redesign: brand moved next to the search bar (2026-07-30)** — "aReference" used to
    live in `.sidebar-brand`, inside the sidebar; it's now `.top-bar-brand`, a flex child of
    `.top-search-bar` itself, sitting directly left of the search input. `.top-search-bar` changed
    from a floating, mostly-transparent pill positioned a bit inside the sidebar's right edge to a
    full-width, solid/opaque header strip (`rgba(15, 15, 17, 0.92)` + blur, `border-bottom`,
    `top: 0`, flush against the sidebar) — necessary because unlike the search `<input>` (which
    always had its own background), plain brand text sitting in that bar would otherwise have
    nothing behind it but the gallery scrolling past underneath, at whatever position the page
    happened to be scrolled to. Adding the brand into that bar ate real horizontal space that
    previously belonged entirely to the search input, which broke the responsive tiers: below
    ~900px the About/Submit button pair (still `position: absolute`, reserving space via
    `.top-search-bar`'s `padding-right`) started squeezing the search input down to an unusable
    ~20-60px wide sliver well before the old 640px/420px breakpoints kicked in (confirmed by
    measuring `#mainImageSearch`'s rendered width across the 320-900px range in a headless
    browser). Fixed by moving the "About/Submit drop to their own row below the header" behavior
    from its old ≤420px-only threshold up to ≤900px (freeing the reserved `padding-right` entirely
    at that tier instead of just shrinking it further), and by hiding `.top-bar-brand` outright
    (`display: none`) at ≤420px rather than continuing to shrink its font - real phone widths
    mostly fall at or below that breakpoint anyway, and the search input mattering more than the
    wordmark at that size was judged the right tradeoff. If you touch these breakpoints again,
    re-measure `#mainImageSearch`'s actual rendered width across the full 320-1200px range rather
    than eyeballing the CSS - the padding/gap/font-size arithmetic across three nested breakpoints
    is easy to get subtly wrong in a way that only shows up at specific in-between viewport widths
    (this bug was invisible at the exact breakpoint boundaries themselves, only in the ranges
    between them).
  - **"New This Week" demoted to a normal category (2026-07-30)** — it used to render as a large,
    bold, visually-separated entry above "All" at the top of the sidebar (`.new-this-week` had its
    own `font-size: 1.1rem; font-weight: 600` rule, distinct from ordinary folder items). That
    rule was removed outright rather than adjusted, so it now falls through to the same plain
    `.folder-list > li` styling every other category uses. It's still the first `<li>` rendered in
    `renderFolders()` (unchanged), so it's still the first item in the list, just no longer
    visually shouting above everything else - "All" (which still has its own bold/separator
    styling) sits directly below it, unchanged.
  - **Dominant-color auto-tagging (2026-07-30)** — every image that gets published now
    automatically gets a plain-language color tag (e.g. `brown`, `gray`, `beige`) merged into its
    keywords via `mergeTagStrings()`, with no admin input required. This is a coarse,
    dependency-free heuristic, not anything ML-based (deliberately - see the AI tagging removal
    note above; this doesn't reintroduce that): `dominantColorNameFromCanvas()` downsamples the
    image to a 64x64 offscreen canvas, buckets pixels into a coarse histogram (colors quantized to
    ~24-wide RGB buckets so near-identical shades collapse into one vote instead of splitting),
    and takes the most-common bucket's average RGB. `nameColorFromRgb()` then maps that RGB to one
    of a fixed set of names via HSL hue/saturation/lightness thresholds - neutrals (black/white/
    gray) are checked first since hue is meaningless at extreme lightness or near-zero saturation,
    then `brown` and `beige` are carved out of the orange hue range by lightness/saturation (common
    on this gallery's actual content - wood, stone, concrete, rust - where "orange" alone wouldn't
    be a useful tag), then the remaining hue wheel maps to red/orange/yellow/green/cyan/blue/
    purple/pink. The thresholds were tuned by hand against a set of sample RGB values run through
    the classifier directly in Node (not against real photos - there's no live Cloudinary access
    in a sandboxed session) - if a published image gets an obviously wrong color tag, that's the
    first place to adjust, and it's worth re-running a similar spot-check rather than guessing at
    new threshold numbers. There are two call sites, because there are two different sources for
    the image bytes at "publish" time: `detectDominantColorTag(file)` runs on the local `File`
    object in the admin upload dock / Publish Queue path (`processUpload()`, in parallel with the
    network upload itself so it adds no extra wait), while `detectDominantColorTagFromUrl(url)`
    runs when Review Submissions' "Add" button publishes an image that's already sitting on
    Cloudinary from the original public submission (no local `File` exists for that path at all -
    see the Review Submissions note above) by loading a small `w_64` Cloudinary transform into an
    `<img crossOrigin="anonymous">` and reading it back via canvas; this depends on Cloudinary
    serving delivery URLs with CORS enabled, which it does by default, but if that were ever not
    true the canvas read throws (a tainted-canvas security error) and detection just silently
    returns `null` rather than blocking the Add. Both call sites are try/caught to never fail the
    publish itself - a failed color detection just means no color tag gets added, same as if
    nothing had been typed into Keywords.
- **`netlify/functions/upload.js`** — receives multipart uploads (Busboy), pushes the file to
  Cloudinary, pre-generates 1200px/1920px derived sizes (`eager`) so the frontend's
  `cloudinaryDisplayUrl()` requests don't transform on first view.
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

- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — used by `upload.js`.
  (`CLOUD_VISION_API` is gone along with Cloud Vision itself — see the AI tagging removal note
  above. If it's still set in the Netlify dashboard, it's just unused, not harmful.)
- Firebase config is a public client-side config object inlined in `index.html` (normal for
  Firebase web apps — it's not a secret, access is controlled by Firestore security rules, not
  by hiding this config).

## Admin access

**2026-07-30: real auth, replacing the no-password gate below.** "Admin Log In" (the button was
renamed from "ADMIN ACCESS" the same day, and becomes "SIGN OUT" once signed in) opens an
`#adminLoginModal` (email + password, Enter submits from either field) that calls Firebase Auth's
`signInWithEmailAndPassword()`. There is exactly **one** admin account, created manually in
Firebase Console → Authentication → Users, using **isakovicadrien@gmail.com** (the Email/Password
sign-in method must be enabled first, under Authentication → Sign-in method — neither step can be
done from a coding session, no Firebase CLI/project access here). Persistence is explicitly set to
`SESSION` (not Firebase's `LOCAL` default) — closing the tab/browser signs the admin back out
automatically, at the owner's request; a same-tab refresh still keeps the session, since
`sessionStorage` (what `SESSION` persistence uses) survives a reload, just not closing the tab.

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
  handler's method-check and error paths). No tests exist for the frontend.
- There's no CI configured on this repo (no `.github/workflows`) — `npm test` before pushing is
  on you/the session, GitHub won't run anything automatically.
- The frontend can't be meaningfully unit-tested (one big inline script, DOM-driven). To check
  a UI change actually works, serve `index.html` (e.g. `python3 -m http.server`) and drive it
  with Playwright/a headless browser (`npm install --no-save playwright` if it's not already
  present; the sandbox's pre-installed Chromium binary lives under
  `/opt/pw-browsers/chromium-*/chrome-linux/chrome` — pass that as `executablePath` explicitly if
  Playwright's default `chromium.launch()` can't find it). Firebase's CDN scripts may be
  unreachable in a sandboxed session (egress policy) — in that case, stub `window.firebase` via
  `page.addInitScript()` before navigating so the top-level `firebase.initializeApp()`/
  `firebase.firestore()`/`firebase.auth()` calls don't throw and the rest of the inline script
  (event listener wiring) still runs. The stub needs a fake `auth()` too (not just `firestore()`)
  to test anything admin-gated: at minimum `onAuthStateChanged(cb)` (call `cb` immediately, keep
  it to notify on sign-in/out), `signInWithEmailAndPassword(email, password)`, `signOut()`, and a
  `currentUser` getter — real Firebase Auth can't run in this sandbox any more than real
  Firestore can. Mock the `fetch('/.netlify/functions/upload', …)` call too (e.g.
  `page.route('**/.netlify/functions/upload', …)`) if exercising the upload flow — there's no
  live Cloudinary in a sandboxed session either.

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

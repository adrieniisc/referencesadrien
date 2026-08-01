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
    **Bug fixed the same day, found via real use:** reported as some images in a batch staying
    stuck at "0%" in the upload dock forever, even though the upload itself was actually going
    through. Cause: `startUploadBatch()` derived each dock row's DOM id from `Date.now()`
    (`upload-<uploadBatchId>-<i>`), and Publish All calls `startUploadBatch()` once per queued
    batch inside a single synchronous `batches.forEach(...)` - multiple batches published together
    landed in the same millisecond often enough to give two different batches the *same*
    `uploadBatchId`, so a batch's file at index `i` collided with another batch's file at the same
    index: two dock rows with identical DOM ids. `document.getElementById()` always resolves to the
    first matching element, so `setUploadItemProgress()` calls for the second (colliding) batch
    silently updated the *first* batch's row instead of its own, leaving the second batch's actual
    row frozen at its initial "0%" template state indefinitely, with no error and no console
    output - the upload for that file was completing normally the whole time, just invisibly.
    Fixed by adding a monotonically-incrementing counter (`uploadBatchCounter`) into the id
    alongside `Date.now()`, guaranteeing uniqueness regardless of how many `startUploadBatch()`
    calls land in the same millisecond. If another "stuck progress" report shows up, check whether
    it's this same shape (multiple batches/uploads kicked off synchronously close together) before
    assuming it's a new bug.
  - **Upload dock rebuilt as a wide bottom bar (2026-07-31)** — was a 420px card anchored to the
    bottom-right corner ("angle based" - the owner's own term for corner-anchored positioning);
    now `left: var(--sidebar-width); right: 0` with `margin: 0 auto; max-width: min(1100px,
    calc(100% - 40px))`, so it spans most of the content area's width instead, flush against the
    bottom edge (`bottom: 0`, rounded top corners only). The header is now a single aggregate
    progress bar + a "done/total" count (`updateGlobalUploadProgress()`, called from every place
    that already touched an item's own progress/success/error state) — the per-file rows
    (`.upload-dock-item`, unchanged internally) are collapsed by default (`.upload-dock-content`
    at `max-height: 0`) and only expand via a new toggle button
    (`#toggleUploadDockDetails`/`.upload-dock.expanded`), separate from the pre-existing minimize
    button (`#minimizeUploadDock`, still hides the whole dock outright, unchanged behavior).
    **Found and fixed the same day, while wiring the new toggle button:** neither button's click
    handler had ever actually attached, before or after this change - `#uploadDock`'s HTML sits
    *after* this file's single big inline `<script>` tag closes, so the old top-level
    `document.getElementById("minimizeUploadDock")?.addEventListener(...)` ran against a DOM that
    didn't have that element yet, found `null`, and the `?.` silently swallowed it. Confirmed via
    a headless-browser check (instrumented `EventTarget.prototype.addEventListener` to log every
    call and its target) that this listener never registered at all - the "▼ minimize" button in
    every prior deployed version of this dock has been dead. Fixed by moving both buttons' lookup
    *and* `addEventListener` calls inside the existing `DOMContentLoaded` handler, which fires
    after the whole document (including the later-declared dock markup) has parsed, instead of
    running at top-level script-parse time. If another floating element's button doesn't respond
    to clicks, check whether its markup is declared after this script tag before assuming the
    handler logic itself is wrong.
  - **Search now treats the folder/category name as an invisible tag too (2026-07-30)** —
    `performSearch()` matches the search term against `data-category` in addition to filename and
    `data-keywords`, so searching "metal" also surfaces every image filed under a Metal folder (or
    Metal/<subfolder>), on top of images anywhere else explicitly tagged "metal". This only affects
    the top search bar; the sidebar's folder-click filtering (`filterImages()`) is unchanged.
    **Superseded 2026-07-30, later the same day:** `filterImages()` is no longer purely
    folder-driven either - see the color filter bullet below.
  - **Floating color filter panel (2026-07-30, repositioned 2026-07-31)** — a second floating pill
    panel (same visual treatment: `.floating-color-panel`/`.color-dot`, modeled on
    `.floating-size-panel`/`.size-icon`), originally stacked directly above the existing size
    selector in its own block; moved into a shared `.floating-controls-row` flex row instead, on
    the size panel's left (both `position: static`, the row itself is the one `position: fixed`
    element, `bottom: 18px; right: 18px`) - two blocks stacked in one corner read as too much
    vertical clutter. If either panel needs repositioning again, adjust the row, not the individual
    panels' own (now static) positioning. **Single-lined and height-matched to the size panel
    (2026-07-31)**, since wrapped into two rows it read as taller/heavier than the size selector
    next to it: `.color-dot-container` went from `flex-wrap: wrap` to `nowrap`, and the dot
    diameter went from 20px to 30px - equal to `.size-icon`'s height - with `.floating-color-panel`
    given the same 5px padding as `.floating-size-panel`, so the two boxes come out exactly the
    same total height with no explicit height set on either. If either panel's padding or icon/dot
    size changes again, the other needs the matching change or they'll drift apart vertically.
    One small round swatch per color name the
    dominant-color auto-tagger can produce (black/white/gray/brown/beige/red/orange/yellow/green/
    cyan/blue/purple/pink). Clicking a dot filters the gallery to images whose keywords include
    that color word; clicking the already-selected dot again clears it back to no color filter
    (single-select, like the size selector). **Dots are generated, not static, since 2026-07-31**
    (`renderColorFilterDots()`/`getUsedColorFilters()`) - only a color that at least one
    currently-loaded image is actually tagged with gets a dot, so clicking a button never comes back
    empty; the whole panel hides itself if literally nothing is color-tagged yet. Re-run after
    anything that can change which colors exist (initial load, a new upload, Review Submissions'
    Add, Delete Images, Edit Tags, and the Re-tag Colors bulk action - see below) - if you add
    another way for an image's keywords to change, call `renderColorFilterDots()` after it too, or
    a dot can end up stale (pointing at a color nothing has anymore, or missing one that now
    exists). The click handler is delegated on `.color-dot-container` itself now instead of bound
    per-dot, since the dots' `innerHTML` gets rebuilt whenever this reruns - a per-dot binding
    would silently stop working the first time the set of visible colors changed, the same
    "listener attached to something before it existed / before it gets replaced" shape as the
    upload dock bug above. If `currentColorFilter` is pointing at a color that just lost its last
    dot, `renderColorFilterDots()` clears it back to null rather than leaving the gallery filtered
    against a button that no longer exists. This is the first *third* filter dimension the gallery
    has had - folder (`currentFolderFilter`) and search text already existed, but neither function
    that applies them (`filterImages()`, `performSearch()`) called the other or shared any common
    combining logic, so adding color required touching both rather than composing with an existing
    mechanism: `imageMatchesColorFilter(container)` is now ANDed onto the show/hide decision in
    both, via `currentColorFilter` (module-level, null = no filter). Whichever of the two is
    "active" (search text if non-empty, otherwise the folder filter - `performSearch()` already
    delegates to `filterImages(currentFolderFilter)` when the search box is empty) still decides
    the *base* set; color only ever narrows it further, never overrides it. If a future filter
    dimension gets added, wire it into `imageMatchesColorFilter()`'s pattern (a small
    `imageMatchesX()` predicate ANDed into both functions) rather than inventing a fourth
    independent mechanism. Sidebar folder counts (`countImages()`/`updateFolderCounts()`)
    deliberately do **not** account for the color filter, same as they already didn't account for
    search text - they show each category's total size regardless of any other active filter.
    **Images published before this feature (and before the dominant-color auto-tagger two commits
    earlier) have no color tag at all**, so they won't match any dot until re-tagged (via Edit
    Tags) or re-published - originally flagged and explicitly accepted rather than backfilling,
    since backfilling would mean loading all ~191 images just to color-tag them and there was no
    clear request to do that yet. **Superseded 2026-07-31 - there was a clear request**: see
    Re-tag Colors below, which does exactly this backfill, on demand rather than automatically.
  - **Re-tag Colors (2026-07-31, `retagColorsBtn`/`reevaluateAllImageColors()`)** - an admin-only
    sidebar button, next to Review Submissions, that re-runs dominant-color detection
    (`detectDominantColorTagFromUrl()`, the same function Review Submissions' "Add" already used)
    against **every** currently-loaded image and overwrites its color tag. Added alongside the
    2026-07-31 detector rework (see that entry above) once real photos showed the *previous*
    detector had been shipping wrong tags - filtering "black" was turning up an obviously red
    vending machine, green grass, and other non-black photos, all tagged under an older, buggier
    version of the algorithm. This is the fix for images that already went through that: a
    one-time, explicit, admin-triggered bulk rewrite (confirm dialog first, button shows
    "Re-tagging… i/N" while running, sequential `for`/`await` rather than `Promise.all` - same
    "one network op at a time, don't hammer Cloudinary" reasoning as the upload dock's own
    sequential `processUpload()`) - deliberately **not** something that runs automatically on page
    load, since it's a network fetch plus a Firestore write per image across potentially the whole
    gallery. Also fixes the *other* gap noted just above: images published before the auto-tagger
    existed at all (no color tag whatsoever) get one from this too, not just images with a wrong
    one, since both cases look the same to this function (whatever's left after stripping known
    color words from existing keywords, which is nothing for an untagged image). Strips any of the
    13 known color words (`COLOR_FILTER_SWATCHES`) out of an image's existing keywords before
    merging the freshly-detected one back in via `mergeTagStrings()` - safe *for this app* because
    the only way one of these exact words ever lands in an image's keywords is as the auto color
    tag, so finding one there isn't a coincidental match against something an admin typed on
    purpose; don't reuse this strip-and-replace approach somewhere keywords aren't drawn from such
    a small closed vocabulary. Calls `renderColorFilterDots()` when done so the dot list reflects
    whatever colors exist post-retag (a color with zero images left after this run loses its dot;
    a newly-introduced one gains one). Same sandbox limitation as everything else touching
    Cloudinary in this repo: **no live Cloudinary/Firestore access here, so this has only been
    exercised against a stubbed Firestore + a stubbed `detectDominantColorTagFromUrl()` in a
    headless browser, never a real gallery** - if re-tagging behaves unexpectedly against the real
    data, that's the first thing to account for, not assume the logic itself is wrong.
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
    `.folder-list > li` styling every other category uses. **Reordered same day, second pass:**
    initially left as the first `<li>` (above "All"), just smaller - but a normal-looking item
    still being the very first thing above "All" read as its own kind of visual precedence, so
    `renderFolders()` now appends "All" first and "New This Week" second, and "All"'s `border-top`
    separator (originally there to separate it from "New This Week" sitting above it) was removed
    since "All" is the first item now and has nothing above it to separate from. If either item's
    position needs to change again, both the DOM order in `renderFolders()` and `.folder-list >
    li.all`'s styling need checking together - they were designed as a pair.
  - **Dominant-color auto-tagging (2026-07-30, reworked same day)** — every image that gets
    published automatically gets a plain-language color tag (e.g. `brown`, `gray`, `beige`) merged
    into its keywords via `mergeTagStrings()`, with no admin input required. This is a coarse,
    dependency-free heuristic, not anything ML-based (deliberately - see the AI tagging removal
    note above; this doesn't reintroduce that). **The first version was wrong in practice and got
    reworked the same day once real test photos came back badly misclassified** - worth reading
    before touching this again: it bucketed raw RGB values into a histogram (nearby colors grouped
    into buckets, most-populated bucket by raw pixel count wins, then that bucket's average color
    gets named) and consistently picked the wrong region on real photos. A subject's own surface
    has enough natural lighting variation (highlights, shadow, texture) that its pixels spread
    across many nearby-but-distinct RGB buckets and split their own vote, while a flatter, more
    uniform area elsewhere in the frame - a blurred gray floor in one corner, a shadow seam between
    two wall planes, the dark gaps between leaves in foliage - stays tightly clustered in a couple
    of buckets and out-votes the actual subject by raw count, even while visibly occupying less of
    the frame. Confirmed against four real test photos: a yellow chair (blurred gray floor in one
    corner) came back "gray", a reddish-brown weathered wall came back "gray", a white/gray wall
    corner with a shadowed seam came back "black", and green foliage (with dark gaps between
    leaves) came back "black" - background/shadow beating the actual subject in every case. Fixed
    by reworking `dominantColorNameFromCanvas()` to classify every sampled pixel individually into
    a color name first (via `nameColorFromRgb()`, unchanged in spirit) and tally votes per *name*
    instead of per fine-grained RGB bucket - far less sensitive to lighting-driven RGB spread,
    since a lit vs. shaded patch of the same material usually still names the same hue even when
    their raw RGB values are nowhere near each other. Pixels below a chroma (max channel - min
    channel) threshold are excluded from the vote entirely - the exact pixels that were winning
    before - *unless* almost the whole image is low-chroma, in which case it falls back to voting
    on every pixel, since that means the image is genuinely neutral (a true black/white/gray
    material) rather than having its real color filtered out. Also fixed in the same pass:
    `nameColorFromRgb()`'s own black/white/gray gate used HSL's `s` (saturation), whose formula
    divides by `(2 - max - min)` near white and `(max + min)` near black - both shrink toward 0 at
    those extremes, so tiny/insignificant RGB differences (sensor noise, JPEG artifacts) got
    amplified into misleadingly large "saturation" readings exactly where it mattered most for
    telling white/black apart from a weak tint (caught via a synthetic "near-white marble" test
    case classifying as a random hue instead of white). Replaced with a chroma-based gate, which
    has no such blowup; `s` is still used for the brown/beige lightness carve-out, safely away from
    those unstable extremes. Verified against ~10 synthetic pixel-population test cases built to
    mimic these exact failure shapes (a large-but-secondary neutral region alongside a smaller,
    more-varied colorful subject) directly in Node before landing this - **there's still no live
    Cloudinary access in a sandboxed session, so none of this has been checked against an actual
    real uploaded photo end-to-end** - if a published image still gets an obviously wrong color
    tag, add another synthetic case shaped like the failure and re-check there first, rather than
    re-tuning thresholds blind again. `brown`/`beige` are still carved out of the orange hue range
    by lightness/saturation (common on this gallery's actual content - wood, stone, concrete, rust
    - where "orange" alone wouldn't be a useful tag), and the rest of the hue wheel still maps to
    red/orange/yellow/green/cyan/blue/purple/pink, unchanged from the first version. The two call
    sites are unchanged: `detectDominantColorTag(file)` runs on the local `File` object in the
    admin upload dock / Publish Queue path (`processUpload()`, in parallel with the network upload
    itself so it adds no extra wait), while `detectDominantColorTagFromUrl(url)` runs when Review
    Submissions' "Add" button publishes an image that's already sitting on Cloudinary from the
    original public submission (no local `File` exists for that path at all - see the Review
    Submissions note above) by loading a small `w_64` Cloudinary transform into an `<img
    crossOrigin="anonymous">` and reading it back via canvas; this depends on Cloudinary serving
    delivery URLs with CORS enabled, which it does by default, but if that were ever not true the
    canvas read throws (a tainted-canvas security error) and detection just silently returns
    `null` rather than blocking the Add. Both call sites are try/caught to never fail the publish
    itself - a failed color detection just means no color tag gets added, same as if nothing had
    been typed into Keywords.
    **Reworked again 2026-07-31 - the 2026-07-30 rework above was still wrong on real photos,**
    confirmed against four real uploads this time (not synthetic): a red vending machine, a patch
    of green grass, a weathered wood pole, and a yellow metal rail all came back "black" (or, for
    the rail, never "yellow" at all). Root cause: the exclude/fallback split from the previous
    rework - vote only on pixels above a chroma cutoff, unless almost everything is below it, in
    which case vote on every pixel instead - kept tripping its own "almost everything is
    low-chroma" fallback on ordinary real photos (shadow, asphalt, tile, glare routinely put over
    95% of sampled pixels under the cutoff), which then let a numerically-larger but merely-dull
    background/shadow outvote an obviously-colored subject by raw pixel count - structurally the
    same failure the *first* rework was meant to fix, just one level up. Replaced with a continuous
    weighted vote instead of that two-tier exclude/fallback split: every pixel always votes for its
    own name (`nameColorFromRgb()`, unchanged), but the vote is worth `Math.min(Math.max(chroma,
    0.05), 0.25)` - floored so a genuinely neutral pixel still counts a little (a true black/white/
    gray material still wins its own vote cleanly), capped so a small-but-vivid sliver of
    background (a patch of blue sky through foliage, a bright sign) can't out-saturate its way past
    a much larger but only moderately-colored subject - confirmed necessary via a synthetic wood-pole
    case where an uncapped version let a smaller sky region win outright on chroma alone. No
    percentage cliff left to mis-tune: a smaller saturated area only has to out-*number* a larger
    dull one now, not clear a separate "is this image neutral overall" gate first. Also tightened
    `nameColorFromRgb()`'s beige carve-out saturation gate from `s < 0.55` to `s < 0.35` - a
    moderately-desaturated-but-still-clearly-yellow pixel (s ~0.5, common on real paint under glare
    or indirect light) was being swallowed into "beige" before it ever reached the yellow check,
    which was the specific cause of the yellow rail never tagging yellow. Verified against the same
    ~10 synthetic cases as the previous rework plus four new ones shaped like these exact real
    failures, all in Node, before landing this - **still no live Cloudinary access in a sandboxed
    session, so still no automated end-to-end check against a real upload**; if a published image
    still gets an obviously wrong tag, add another synthetic case shaped like it and check there
    first, same advice as last time, which turned out to matter: synthetic-only verification is
    exactly what let the 2026-07-30 version ship still broken.
    **Confirmed still broken after Re-tag Colors, 2026-07-31, same day as the rework above** - the
    owner ran Re-tag Colors against the real gallery and a glossy fire hydrant, a glazed mosaic
    tile, and several foliage photos still came back "gray". Since this is the *first* real signal
    gathered after an actual admin-triggered run (as opposed to synthetic Node cases, which cannot
    exercise this at all), it points at something the synthetic tests structurally can't cover:
    `detectDominantColorTagFromUrl(url)` - the only path Re-tag Colors and Review Submissions' "Add"
    use - fetches a *live, lossily re-compressed* Cloudinary transform (`w_64` with `q_auto`),
    unlike `detectDominantColorTag(file)` (plain admin uploads), which decodes the full-resolution
    original locally with no Cloudinary transform involved at all. `q_auto` can pick a much more
    aggressive quality for a thumbnail that tiny than it would for a real display image, and
    JPEG/WebP compression discards chroma disproportionately to brightness at low bitrates -
    exactly the kind of artifact that would wash real saturation out before
    `dominantColorNameFromCanvas()` ever sees the pixels, on glossy/reflective subjects most of
    all (a hydrant's shiny paint, a glazed tile's reflections) - which matches the specific failing
    photos here. Bumped the transform to `w_200`/`q_90` (`cloudinaryDisplayUrl()` gained an optional
    `quality` param for this, defaulting to `q_auto` everywhere else so display thumbnails are
    unaffected) - still a tiny, fast crossOrigin fetch, just under much less compression pressure.
    **Unconfirmed whether this is the full explanation or just a contributing factor** - there's
    still no live Cloudinary access in a sandboxed session to verify against the real photos, so
    `dominantColorNameFromCanvas()` gained an optional `debugLabel` param (wired to the image
    filename/URL at both call sites) that `console.debug`s the *full* name→vote-weight breakdown,
    not just the winner, whenever it's passed - if an image is still wrong after this, ask whoever
    can open the browser console during a Re-tag Colors run (or a fresh upload) to paste the
    `[color detect] ...` line for that image, and treat that as real ground truth instead of
    guessing at another pipeline-level theory blind, the same lesson as every round before this one.
    **Fourth pass, 2026-07-31, same day** — reported broken again (leaves, fire hydrants still
    gray), still with no real `[color detect]` console line to go on. Rather than tune blind again,
    this pass built an actual reproduction: a Playwright + real Chromium `<canvas>` harness (not
    plain Node pixel arrays — those never exercise `dominantColorNameFromCanvas()`'s own
    `ctx.drawImage()` downsample step at all, which is exactly why every prior "verified in Node"
    claim couldn't have caught a bug living in that step) that draws synthetic photos shaped like
    the real failures and runs the *actual* function against them. This reproduced it: a saturated
    subject covering ~15% of the frame against a much larger (~85%) background that's only mildly
    desaturated (chroma ~0.05–0.15 — overcast light, gravel, muted grass; not the near-zero-chroma
    "obviously neutral" case FLOOR/CAP were tuned around) reliably came back "gray" at the
    then-current FLOOR/CAP of 0.05/0.25, regardless of sample resolution. Cause: a background that
    dull never reaches the 0.25 cap, so it accumulates its full (if modest) per-pixel chroma across
    a much larger area than the subject can, while the subject's own weight is held down at 0.25
    regardless of how saturated it actually is — raw area wins. Fixed by raising CAP to 0.50 and
    lowering FLOOR to 0.03 (`dominantColorNameFromCanvas()`), which fixed the reproduction while
    still passing every previously-documented regression shape re-run against the same harness: a
    large moderately-colored subject (a wood pole, chroma ~0.3) still beats a small vivid sliver (a
    sky patch, chroma ~0.6, ~8% of frame) — the original 2026-07-31 "small vivid sliver" regression
    this cap exists for — a large dull subject still beats both a small vivid sliver (~3% of frame)
    and an even smaller max-saturation one (~2%), and a fully neutral material still comes back
    neutral. **If another image is still wrong after this, extend that harness with a case shaped
    like the new failure first** (or get a real `[color detect]` console line, if someone can) —
    don't re-tune these two numbers blind again; that's the mistake every prior pass made.
  - **Stability: delete/move/edit-tags/re-tag now target a Firestore doc id, not a url lookup
    (2026-07-31)** — prompted by "make sure images won't disappear randomly." `findImageIdByUrl()`
    (`where('url','==',url).limit(1)`) is ambiguous whenever two `images` docs share the same url,
    which the **Find Duplicates** admin tool exists specifically because it really happens (e.g.
    clicking Review Submissions' "Add" twice on the same submission). When that happens, `.limit(1)`
    silently resolves to *whichever* doc Firestore returns first — delete/move/edit-tags/re-tag-colors
    would all appear to work (the clicked container disappears from the DOM immediately) while the
    Firestore doc actually touched could belong to a *different* image, which then just doesn't
    reappear on the next reload, no error anywhere. `addImageToGallery()` now takes an optional
    `docId` 6th argument and stashes it as `container.dataset.docId`; `saveImageToFirebase()` returns
    the new doc's id so every creation path (`loadImagesFromFirebase()`, `completeUpload()`, Review
    Submissions' "Add") can pass it through. `getImageDocId(container)` is the new single point every
    mutating call site (delete, move, edit tags, re-tag colors) goes through — uses
    `dataset.docId` when present, only falls back to the old ambiguous `findImageIdByUrl()` for any
    container that somehow never got one. Doesn't fix *why* duplicate urls occur in the first place
    (Find Duplicates is still the only cleanup tool for existing ones) — this just stops that
    situation from silently corrupting an unrelated image's data when it does.
  - **`netlify/functions/upload.js`'s `public_id` collision (2026-07-31)** — see that file's own
    entry below; same stability audit.
  - **Thumbnails get `loading="lazy"`/`decoding="async"` (2026-07-31)** — prompted by "lags on
    slower laptops when scrolling, and some images load slowly." Every gallery thumbnail (plus
    Review Submissions' thumbnails) used to fire its network fetch immediately on page load
    regardless of scroll position — with ~200 images that's ~200 concurrent requests and decodes
    competing for bandwidth and main-thread time on every visit, even for images the visitor never
    scrolls to. Native lazy-loading defers the fetch until near-viewport instead. Interacts with the
    justified-layout algorithm in one way worth knowing: an image's `data-aspect` only becomes real
    (vs. the 1.5 fallback) once its `load` event fires, which for a lazy image is only once it's
    about to scroll into view — `layoutGallery()` re-packs from the changed image's row *onward*
    only (rows before it in DOM order are unaffected, since row-packing is sequential and
    deterministic per prior images' own aspect data), so this shows up as a minor row reflow right at
    the loading edge as the visitor scrolls, never a shift of content already above the fold. This is
    normal/expected for any lazy-loaded justified or masonry gallery, not a bug to chase.
  - **`.image-container`'s "flashes a huge image, then snaps to normal size" bug (2026-07-31)** —
    root cause: `.image-container` had no width/height of its own at rest (only `flex: 0 0 auto`),
    and its `<img>` is `width:100%; height:100%` — CSS resolves that against the *image's own*
    intrinsic pixel size when the container itself is otherwise unconstrained, so a container
    rendered at its photo's full native resolution (thousands of px) until `layoutGallery()` set an
    explicit inline pixel width/height (throttled ~60ms, and again per-image on that image's own
    `load` event). Fixed by giving `.image-container` a default `width: calc(var(--row-height) *
    1.5); height: var(--row-height)` — matches the same 1.5 fallback aspect `addImageToGallery()`
    already seeds `data-aspect` with, so the default and the JS-computed fallback agree. Verified via
    a headless Chromium load with a stubbed Firestore (three fake images) — containers stayed at a
    bounded, sane size (matching `--row-height`) both immediately after the containers were created
    and after `layoutGallery()` settled; the real photo-swap-to-huge-then-shrink motion itself isn't
    reproducible in this sandbox (no live Cloudinary/real photo bytes to load), so this is verified
    by CSS box-model reasoning plus bounded-size confirmation, not a literal before/after screenshot
    of the flash.
  - **Default gallery size changed S → M (2026-07-31)** — `--row-height` 180px → 240px, and the
    `.size-icon.selected` class moved from the S icon to the M icon in the floating size panel's
    markup. Both need to change together (or a page load and the panel's own highlighted icon
    disagree about what's actually selected).
  - **Folder deletion hardened (2026-07-31)** — `deleteFolderBtn`'s handler already only ever
    reassigns affected images' `folder` field to `'all'` (a Firestore batch `.update()`) and never
    touches the `images` collection's docs themselves — deleting a folder was never actually deleting
    photos, just the folder doc(s). What was missing: (1) the confirm dialog didn't say so, which
    read as ambiguous and was reported as a point of confusion — it now spells out "Its images are
    NOT deleted - they'll stay in the gallery, moved to 'All'" up front, before the admin confirms;
    (2) `"All"` was already blocked from being deleted/renamed, but `NEW_THIS_WEEK_FILTER` (the
    virtual "New This Week" category — never a real folder doc, see its own definition) was not —
    selecting it and clicking Delete Folder or Rename Folder fell through to the real flow (a
    harmless no-op against Firestore, since nothing actually has that literal folder value, but
    still surfaced a real, confusing confirm/rename dialog). Both buttons now explicitly block both
    virtual categories with one alert.
  - **Bulk-delete warning for 20+ images (2026-07-31, `BULK_DELETE_WARNING_THRESHOLD`)** — selecting
    20 or more images in Delete Images mode and clicking Delete Selected now shows an extra,
    more alarming `confirm()` *before* the normal one ("You're about to delete N images... cannot be
    undone. Are you SURE?") — meant to catch an accidental mass-delete (a fat-fingered
    select-everything click, or forgetting Delete Images mode was still on from earlier) since two
    separate prompts are harder to blow through on autopilot than one dialog with more text in it.
    Dismissing either dialog aborts with nothing deleted; accepting both proceeds exactly as before.
  - **Review Submissions button restyled + moved to the top of the admin controls (2026-07-31)** —
    moved out of `.admin-bottom-buttons` into its own new first section of `.sidebar-footer` (above
    even Add Folder/Add Image), and given its own `.review-btn` class (green, via a new
    `--success-soft` token alongside the existing `--success`) instead of the unstyled default admin
    button look. It's flagging incoming work waiting on the admin (pending public submissions), not
    a select-then-act gallery-editing tool like Move/Delete/Edit Tags next to it, which is why it's
    both visually distinct and first, not sorted in wherever alphabetically/historically.
  - **Upload dock: wider progress bar + ETA (2026-07-31)** — `.upload-dock-global-progress` lost its
    480px `max-width` cap (now just `flex: 1; min-width: 0`) so it actually fills the space next to
    the title/stats instead of stopping well short of the dock's own already-wide (`min(1100px, ...)`)
    container. Added an estimated-time-remaining label (`#uploadDockEta`,
    `.upload-dock-stats`/`.upload-dock-eta`) next to it — `updateGlobalUploadProgress()` now tracks
    `uploadBatchStartTime` (reset to `null` whenever the dock empties out, so a later unrelated batch
    gets its own fresh estimate) and projects total time from elapsed-time ÷ overall-percent-so-far,
    not just done/total file count, so it updates smoothly mid-file rather than only jumping when a
    whole file finishes. Held back behind "Estimating…" for the first ~1.5s / first 3% of progress —
    too little signal that early makes for a wildly unstable projection. The existing "done/total"
    count (`#uploadDockCount`) was already there from the 2026-07-31 dock rebuild above and didn't
    need to change.
  - **Lightbox resolution readout (2026-07-31)** — `#enlargedResolution`, a small muted label next to
    the tags pill in the lightbox, showing e.g. `1920 × 1080`. Reuses the `tempImg` that
    `enlargeImage()` already loads to size the lightbox (`displayUrl`, capped to 1920px via
    `cloudinaryDisplayUrl(url, {width:1920})`) instead of firing a second request against the
    original - so this is exact for any image whose original is at or under that cap (most uploads,
    given `compressImageIfNeeded()`'s 1.5MB target), and shows the capped/downscaled figure rather
    than the true original only for images wider than 1920px. Download still fetches the real
    original either way; this label is informational only, not a claim about what Download gets.
    Required restructuring the show/hide logic in `.enlarged-tags-container`: it used to toggle the
    whole container on keyword presence (hiding it entirely for an untagged image), which would have
    taken the resolution label down with it - the container now always shows once an image has
    loaded, and only the tags pill itself toggles on whether there are keywords.
  - **Sort menu: Random (2026-07-31)** — added as a third `.filter-option` next to the existing
    Alphabetical/Recent Add, and as a new branch in the pre-existing `sortGallery(type)` (Fisher-Yates
    shuffle of `gallery.children`, then re-appended in that order - same reorder-in-place pattern the
    other two types already used). `sortGallery("random")` is also called once during init right
    after `loadImagesFromFirebase()`, so the gallery opens shuffled by default instead of in upload
    order, freshly reshuffled on every page load (not shuffle-once-and-persist - there's no stored
    "current sort" state, each call just reorders live). Picking Alphabetical/Recent Add from the
    menu afterward overrides this for the rest of the session, same as it always did for those two.
  - **Material-type facet filter (2026-07-31, `MATERIAL_FILTER_OPTIONS`) — removed outright later the
    same day, see the "Second round of visual-QA fixes" entry further down this file.** Kept here for
    history/context only - none of the classes, functions, or markup this paragraph describes still
    exist in `index.html`. A second floating chip panel next to the color-dot panel
    (`.floating-material-panel`/`.material-chip-container`, inserted into the existing
    `.floating-controls-row`), filtering the gallery to images tagged with a clicked material word
    (metal/wood/stone/concrete/brick/fabric/glass/ceramic/organic/ground).
    Deliberately wired as an exact copy of the color filter's own pattern -
    `getUsedMaterialFilters()`/`renderMaterialFilterChips()`/`imageMatchesMaterialFilter()`, ANDed
    into both `filterImages()` and `performSearch()` alongside the existing color check, chip only
    rendered once at least one loaded image actually has that word - per the extension point that
    feature's own comments already called out ("wire it into `imageMatchesColorFilter()`'s pattern
    rather than inventing a fourth independent mechanism"). The one real difference from color: there
    is no auto-detector behind it. This app has no ML/AI (see the Cloud Vision/MobileNet removal
    note - don't reintroduce that to "fix" this), so a material word only ever lands in an image's
    keywords because an admin typed it into Add Image / Edit Tags, same bootstrapping path the color
    words themselves used before they got a dedicated per-upload detector. `renderMaterialFilterChips()`
    is called at every point `renderColorFilterDots()` already was (Delete, Edit Tags, Re-tag Colors,
    Review Submissions' Add, upload completion, init) since material tags live in the same `keywords`
    field and change through the same code paths. `MATERIAL_FILTER_OPTIONS` is just the candidate
    vocabulary a chip can *possibly* appear for (chosen from this gallery's real folder names -
    `wood`/`concrete`/`rock`(stone)/`brick-roof-tile` - plus a few plausible others); editing that
    array doesn't retag anything, it only changes which words are eligible to get a chip once used.
    `.floating-controls-row` gained `flex-wrap: wrap` (it has no `top` anchor, so wrapping grows the
    box upward from its `bottom`/`right` corner rather than overflowing) since it now holds three
    panels instead of two - narrow-viewport shrink rules for `.material-chip` were added to the
    existing 640px breakpoint block alongside the color-dot ones.
  - **Lightbox "Similar" images grid (2026-07-31, `findSimilarImages()`/`renderSimilarImages()`)** —
    a floating panel (`.enlarge-similar-panel`, `position: fixed`, independent of the modal's own flex
    column) showing up to 9 images "similar" to the one currently enlarged; clicking a thumb
    re-enlarges that image (and the panel refreshes for it, same recursive pattern
    `showAdjacentEnlargedImage()` already used for prev/next). "Similar" is a tag-overlap heuristic,
    not real visual similarity - there's no ML in this app and no perceptual-hash/feature data stored
    per image (see the material-facet entry just above for why that's a deliberate constraint, not an
    oversight), so this scores every other loaded `.image-container` by shared `data-keywords` tokens
    (which already includes the auto color tag) plus a same-folder tie-breaker that only counts on
    top of at least one real keyword match. Entirely in-memory against DOM data already loaded for the
    gallery grid itself - no network fetch or Cloudinary call per candidate, so it costs nothing extra
    to compute. Deliberately built with `createElement`+closures per thumb rather than
    `innerHTML` + a later lookup-by-id-or-url - re-querying afterward would be the exact ambiguous-
    lookup shape `findImageIdByUrl()` is already documented as unsafe for (two thumbs could
    coincidentally share a lookup key). Positioned as a `position: fixed` overlay near the right edge
    specifically so it doesn't have to touch `enlargeImage()`'s existing width/height sizing math for
    the main image (already fairly involved, see that function) - it just floats on top, and is
    hidden outright below 1100px viewport width (`!important`, since `renderSimilarImages()` sets
    this panel's `display` via inline style like the rest of this modal's JS already does, which
    otherwise wins over a plain media query rule regardless of specificity). Untested against a real
    gallery's actual tag data (same sandbox limitation as everything else here) - verified instead
    with a Playwright + stubbed-Firestore harness (5 synthetic images with known keyword overlaps)
    confirming the ranking, the click-to-navigate behavior, and the viewport cutoff all behave as
    designed; if real-gallery results look off, that's about the *scoring weights* being wrong for
    real tagging patterns (e.g. folder bonus too strong/weak), not the mechanism itself.
  - **Lightbox "Similar" panel enlarged + given a real layout slot (2026-07-31)** — was a
    `position:fixed` 190px overlay (see the entry above); now 340px and a real flex sibling of the
    image, via a new `.enlarge-main-row` (`.enlarge-image-column` + `.enlarge-similar-panel`) that
    replaces the modal's old flat flex-column content. A fixed overlay can't give "equal spacing on
    both sides of the whole composition" - only centering the row *as a unit* (`justify-content:
    center`) guarantees that once the bigger panel pushes the image off dead-center.
    `enlargeImage()`'s width math now subtracts the panel's rendered width + a `ROW_GAP` constant
    (32px, kept in sync with the CSS `gap`) before taking 90% of what's left, checked via
    `getComputedStyle(...).display` (not the inline style `renderSimilarImages()` sets) so it also
    respects the panel's own hide-below-1300px breakpoint (raised from 1100px to give the bigger
    panel + a reasonably-sized image enough combined room). Nav arrows deliberately kept anchored
    to the viewport edges (`left`/`right: 20px`, unchanged) rather than hugging the resized
    composition - verified via Playwright screenshots at 1920/1400/1150px that the right arrow
    never overlaps the panel at those widths; if some viewport size does overlap it, adjust the
    arrow's own position, don't put the panel back into a fixed overlay to dodge it.
    **Wrapping the image in two new elements had one knock-on effect, fixed in the same pass:** the
    modal's "click outside the image to close" handler only checked `e.target.id ===
    "enlargeImageModal"` - clicking in the new wrappers' own empty space (e.g. the gap between the
    image and the panel) hit `.enlarge-main-row`/`.enlarge-image-column` instead and silently
    stopped closing the modal. Fixed by widening that check to also match `#enlargeMainRow` and
    `.enlarge-image-column`.
  - **Lightbox resolution readout redesigned to match the tags pill (2026-07-31)** —
    `#enlargedResolution` used to be bare inline text (`margin-left:8px`) sitting to the right of
    the `.enlarged-tags` pill, which read as offset/misaligned since the pair's shared centering
    shifted with the tags pill's own width (and vanished entirely, taking its `margin-left` offset
    with it with nothing to balance it, whenever an image had no tags). `.enlarged-tags-container`
    is now a flex column (`align-items:center`) instead of `text-align:center` inline content, with
    the resolution label restyled as its own smaller pill (same `rgba(26,26,30,0.85)` + border +
    shadow as `.enlarged-tags`) stacked directly below the tags pill - centers cleanly under the
    image regardless of whether the tags pill is even shown.
  - **Sidebar redesigned as frosted glass, matching the floating filter panels (2026-07-31)** —
    `.sidebar` now uses the same material as `.floating-material-panel`/`.floating-color-panel`
    (translucent `rgba(26,26,30,0.82)` + `backdrop-filter: blur(20px)` + border + shadow) instead
    of a flat opaque `--bg-elevated` fill. Since the sidebar doesn't overlap the gallery in this
    layout (flex siblings side by side, not stacked), there's nothing colorful behind it for the
    blur to actually diffuse on its own - a new `.sidebar-frost-art` (an absolutely-positioned,
    `z-index:0` layer of a few real gallery thumbnails, heavily blurred + low-opacity, populated
    once by `renderSidebarFrostArt()` after initial load) gives it real color to pick up, which is
    what makes it read as "frosted" rather than just tinted-transparency-over-nothing. Purely
    decorative - unlike `renderColorFilterDots()`/`renderMaterialFilterChips()`, it isn't re-run
    after every gallery mutation (delete/move/retag/etc.), since a stale sample here costs nothing.
    Sidebar content (search bar, folder list, footer) moved into a new `.sidebar-scroll` wrapper
    (`z-index:1`, now owns the padding/flex-column/`overflow-y:auto` that `.sidebar` itself used to
    have) so it layers above the decorative art.
    **`backdrop-filter` gotcha, worth knowing before touching this again:** giving `.sidebar` a
    `backdrop-filter` makes it the *containing block* for any `position:fixed` descendant (same
    family of properties as `transform`/`filter`/`perspective`) - `#filterMenu` (the
    Alphabetical/Recent Add/Random dropdown) used to be a plain child of `.sidebar` and a true
    `position:fixed` element; left in place, its hardcoded `top:50px;left:240px` would have started
    resolving against `.sidebar`'s own box instead of the viewport. Moved it out to be a sibling of
    `.sidebar` instead (functions identically either way - the JS looks it up by id regardless of
    DOM position) rather than working out whether the box math still happened to land in the same
    place. If another `position:fixed` element is ever nested inside `.sidebar`, it needs the same
    treatment. Verified via Playwright screenshots that the dropdown still opens in the same place
    as before, and that the frost art renders behind the folder list without breaking scrolling or
    click targets.
  - **Dedicated white "highlight" color for selected/default-active buttons (2026-07-31)** — added
    `--highlight`/`--highlight-soft` tokens (white / `rgba(255,255,255,0.18)`) and pointed the
    *selection-indicator* rules at them instead of `--accent`: `.folder-list li.selected` (+ its
    `.folder-count`), `ul.subfolder-list li.selected`, `.size-icon.selected`, `.color-dot.selected`'s
    ring, `.material-chip.selected`. Deliberately scoped to just those "you are here" states, not
    every `--accent`-colored element - primary CTA buttons (Add/Save/Download, via
    `.modal-content button`/`.enlarged-download-btn`), the publish-queue tint, tag chips, and the
    submission link color all still use `--accent` (orange) unchanged. If "highlight" was actually
    meant to mean the whole brand accent, that's a bigger, different change - revisit `--accent`
    itself rather than widening `--highlight`'s scope ad hoc.
  - **"aReference" brand text is now a home/reset link (2026-07-31)** — clicking it
    (`.top-bar-brand` click → `goToHomeAll()`) clears the search box, the color filter, and the
    material filter, then selects "All", mirroring the sidebar's own "All" click handler
    (`currentFolderFilter = "all"; filterImages("all")`) plus resetting the other two filter
    dimensions that handler doesn't otherwise touch.
  - **About modal auto-opens on a visitor's first-ever visit (2026-07-31)** — a `localStorage` flag
    (`hasVisitedReferencesAdrien`) checked once at script-parse time (right after the existing
    `aboutModal`/`aboutBtn` wiring); unset → opens the modal and sets the flag so it never
    auto-opens again on that browser/device. This is a `localStorage`-per-origin mechanism, not
    real per-IP/per-user tracking - a static frontend with no backend of its own has no way to do
    the latter, and `localStorage` is the practical equivalent for "once per person's computer"
    (survives reloads/tab closes, resets only if the visitor clears site data or switches
    browser/device). Wrapped in `try/catch` since `localStorage` can throw in some contexts
    (private-browsing storage restrictions, sandboxed embeds) - failure just skips the auto-open
    rather than breaking page init.
  - **Social links added to the About modal (2026-07-31)** — four small circular icon links under
    "Adrien" (`.about-social-links`/`.about-social-icon`) to ArtStation, adrienisakovic.com,
    LinkedIn, and IMDb, all `target="_blank" rel="noopener noreferrer"`. Icons are simple hand-drawn
    monochrome SVG glyphs (not exact brand-logo reproductions) styled to match the site's existing
    muted icon-button language (`.filter-button`/`.close-modal-btn`) rather than full-color brand
    badges, for visual consistency with the rest of the dark UI.
  - **Lightbox "Similar" panel: more breathing room + height-matched to the image (2026-07-31)** —
    `.enlarge-main-row`'s gap (image ↔ panel) went 32px → 48px, `.enlarge-similar-panel`'s width
    340px → 400px, and the "hide the panel below this viewport width" media query 1300px → 1400px
    (raised to preserve the same worst-case minimum image width at the new breakpoint edge that the
    old 1300px cutoff gave at 340px/32px - see the CSS comment for the arithmetic). `enlargeImage()`'s
    `ROW_GAP` JS constant was bumped to match - it has to stay in sync with the CSS gap by hand, same
    as before. New this pass: the panel's height is now set explicitly (`similarPanelEl.style.height`)
    to match the image's own just-computed rendered height, read via `getBoundingClientRect()`
    immediately after the image's width/height branch runs - `max-height: 82vh` (CSS) still caps this
    for an unusually tall image, and the panel's existing `overflow-y: auto` lets the 3×3 grid scroll
    if 9 thumbnails don't fit in whatever height that leaves.
  - **Lightbox "Similar" panel now appears in sync with the image, not before it (2026-07-31)** —
    `renderSimilarImages(container)` used to run at the very top of `enlargeImage()`, before the big
    image had even started loading - on a fresh open this flashed the *previous* image's similar set,
    and either way the row's total width (and thus the panel's centered position) visibly shifted a
    second time once the image's own `onload` resized it around the panel's now-reserved width. Fixed
    by hiding the panel synchronously at the top of `enlargeImage()` instead
    (`similarPanelEl.style.display = "none"`) and moving the `renderSimilarImages()` call itself into
    `enlargeImg`'s `onload`/`onerror` handlers, so it populates at the exact moment the big image
    finishes (or fails) loading - both now driven by the same event instead of two independently-timed
    ones.
  - **`enlargeImage()`: dropped the redundant second image decode, added `fetchpriority="high"`
    (2026-07-31)** — prompted by "images are still very slow to load when clicking on them". Root
    cause of one real, fixable cost: sizing math needs the image's *true* natural pixel dimensions,
    unaffected by the CSS constraining `#enlargeImage`'s rendered box (`max-width: 90vw`, etc.) - the
    code got this by creating a second, off-DOM `new Image()` (`tempImg`) with the same `src`, whose
    unconstrained `.width`/`.height` gave the real natural size. That works, but it means the browser
    decodes every lightbox image *twice* (once per `Image`/`<img>` instance) even though the network
    fetch itself is deduped. Removed `tempImg` entirely - `enlargeImg.onload`/`.onerror` are attached
    directly (before `.src` is set) and read `this.naturalWidth`/`naturalHeight` instead, which report
    true intrinsic size regardless of DOM attachment or CSS, same guarantee `tempImg` existed for, one
    decode instead of two. Also added `fetchpriority="high"` to `#enlargeImage` so the browser
    explicitly deprioritizes competing in-flight requests (background thumbnail lazy-loads, the
    similar-images panel's own thumbnails once it populates) behind the one image actually on screen.
    Combined with the timing fix above (similar-panel thumbnails now only start fetching *after* the
    hero image has already loaded, not simultaneously with it), this should meaningfully cut
    connection contention on the image that actually matters - but **there's no live Cloudinary access
    in a sandboxed session**, so none of this has been benchmarked against real network latency; if
    the lightbox is still slow after this, the next suspect is Cloudinary-side (e.g. an eager-transform
    cache miss - `upload.js`'s `eager_async: true` means a very recently uploaded image's 1920px
    derivative may not exist yet - or an old image whose original predates eager transforms
    altogether), not something fixable from this file.
  - **Resolution readout moved back inline with the tags pill, this time as a real row (2026-07-31)**
    — superseding the earlier same-day "stack it in a column below the tags pill" redesign (see that
    entry above), which itself existed to fix an *older* bug (`margin-left`-based inline positioning
    reading as offset/unaligned). Turns out stacking read as *too* disconnected from the tags pill for
    the two to look like a matched pair, and the resolution pill was noticeably shorter than the tags
    pill (mismatched padding/font-size). Fixed properly this time rather than reverting: `.enlarged-
    tags-container` is `flex-direction: row; justify-content: center; align-items: center;` (was
    `column`) - centering the *row as a unit* is what avoids reintroducing the original margin-left
    bug, since it keeps both pills level and centered together regardless of which one is wider or
    whether the tags pill is even shown (same pattern `.enlarge-main-row` already uses to center the
    image+panel composition as a unit). Both pills now share an explicit `height: 34px` +
    `display: inline-flex; align-items: center` instead of relying on matching padding/line-height
    (which their different font-sizes - 0.9rem vs 0.75rem - would throw off by a couple px). Two
    JS-side gotchas from switching column → row, both fixed in the same pass: (1) `.enlarged-tags`
    needed `min-width: 0` added - a nowrap flex item's automatic minimum size is its full un-wrapped
    content width, and in a *row* container (unlike the previous column) that overrides `max-width`
    and silently breaks the existing ellipsis-truncation, so a very long keyword list could now
    overflow past the container instead of truncating; `.enlarged-resolution` got `flex-shrink: 0` so
    it's always the tags pill (not the short, fixed-format resolution text) that gives up space. (2)
    `enlargeImage()`'s own JS was still setting `tagsElement.style.display = "inline-block"` and
    `tagsElement.parentElement.style.display = "block"` - harmless under the old CSS but an inline
    style always wins over a stylesheet rule, so left as-is these would have silently overridden the
    new `inline-flex`/`flex` CSS and broken the row layout the moment an image loaded. Updated to
    `"inline-flex"`/`"flex"` to match.
  - **Sidebar frost art made dynamic - tracks whatever's actually next to the sidebar (2026-07-31)**
    — was 3 random images from the whole gallery, picked once after initial load and never touched
    again (see its original entry above). `getImagesNextToSidebar()` (new) instead finds the images
    currently hugging the gallery's own left edge (i.e. physically adjacent to the sidebar - a few px
    of slack for gap/rounding) *and* within the currently-scrolled viewport, via `getBoundingClientRect()`
    against `#gallery` and `.main-content`; when there are more matches than the 3 art slots, it spreads
    picks across the visible span (first/middle/last by vertical position) rather than just taking the
    first 3, roughly tracking the CSS's 3 fixed art-image positions (top-left/mid-right/bottom-left).
    Re-run from two places: the end of `layoutGallery()` (already re-runs after every filter/search/
    add/delete/move, so no new hook needed there - same piggyback `renderColorFilterDots()` uses
    elsewhere) and a new throttled scroll listener on `.main-content` (`scheduleFrostArtRefresh()`,
    200ms, since scroll doesn't otherwise trigger a relayout and fires far more often than resize/
    filter). `renderSidebarFrostArt()` now also diffs against the last-rendered picks
    (`lastFrostArtKey`) and skips the DOM/network churn of re-fetching the same 3 thumbnails when the
    visible set hasn't actually changed between throttle ticks. Falls back to the old "whatever's
    loaded" behavior if nothing currently qualifies (e.g. before the first layout pass has run).
  - **Header/sidebar reorganized: brand back in the sidebar, sort-by menu removed, search bar full-
    width, magnifying-glass icon added (2026-07-31)** — reverses part of the same-day "Header
    redesign" entry above. "aReference" is `.sidebar-brand` again, now the first child of
    `.sidebar-scroll` (above the folder list, in the literal DOM-order sense - `renderFolders()`
    still puts "All" first within `#folderList`, so this reads as "above All"), replacing the sort-
    options button (`#filterButton`/`#filterMenu`, the ≡ icon + Alphabetical/Recent Add/Random
    dropdown) that used to occupy that slot - removed outright rather than relocated, at explicit
    request; the default-random-on-load behavior (`sortGallery("random")` at init) is untouched, only
    the manual re-sort UI is gone. Unlike the old fixed-pixel-width `.top-bar-brand`, `.sidebar-brand`
    is a plain block element (`width: 100%`) inside `.sidebar-scroll`'s existing 0.8rem padding, so it
    automatically tracks `--sidebar-width` at every responsive tier without its own breakpoint
    overrides (previously it needed a `font-size` shrink at 640px and an outright `display: none` at
    420px, both now gone - it just shrinks its own `font-size` at those tiers instead, since it's no
    longer competing with the search input for the same row). With brand gone from `.top-search-bar`,
    `.main-search-container` (`flex: 1`, the row's only remaining child) fills the entire row width
    left of the About/Submit button gutter automatically, no layout changes needed beyond deleting the
    brand element. Added a small magnifying-glass SVG (`.search-bar-icon`, absolutely positioned
    inside `.main-search-container`, `pointer-events: none`) before the placeholder text, with
    `#mainImageSearch`'s own left padding widened to clear it - sized at 18px/stroke-width 2.5 (not a
    more typical 16px/2) because a thinner/smaller version anti-aliased down to barely-legible against
    the dark input background in testing at actual render size (a common trap: it looks fine zoomed
    in, but a 16x16 1.3px-stroke glyph is genuinely hard to see at 1x). About/Submit/search-bar spacing
    also tightened as part of this pass: the viewport-edge→About, About→Submit, and Submit→search-bar
    gaps were all a uniform 24px, now all a uniform 10px (`.about-btn`'s `right`, `.submit-reference-
    btn`'s `right`, and `.top-search-bar`'s `padding-right` all derive from the same 10px value - see
    the comments on each). This only touches the desktop/base tier; the ≤900px tier where About/Submit
    drop to their own row below the header (freeing that space entirely) was left alone since the
    "match spacing to the search bar" reasoning doesn't apply once they're no longer sharing a row
    with it. `.submit-reference-btn` also changed from the same dark pill as About to solid white
    (`#ffffff` bg, `#17120c` text, `font-weight: 600`) so it reads as the more prominent of the two -
    it's the action that writes something back (a submission), About is purely informational.
    **Verified this entire pass end-to-end with a real Playwright + Chromium harness** (synthetic
    Firestore stub, 36 generated PNG data-URI images across 3 folders - real dimensions/aspect ratios,
    no live Cloudinary needed since `cloudinaryDisplayUrl()` passes non-`/upload/` URLs through
    unchanged) rather than the "verified in Node"/"CSS box-model reasoning only" caveats several
    earlier entries in this file had to fall back on - 19 assertions covering all of the above
    (DOM structure, computed styles/positions, the similar-panel timing fix specifically via a
    hidden-immediately-after-navigation check, frost-art src changing after a scroll) plus a zero-
    console-errors check, all passing, screenshots included. If this is revisited, that harness
    (Playwright + a hand-rolled Firestore/Auth stub installed via `page.addInitScript()`, PNG data
    URIs as fake image docs) is a reusable pattern for testing lightbox/gallery JS logic that doesn't
    depend on live Cloudinary/Firebase - worth reaching for again instead of rebuilding it from
    scratch or falling back to Node-only/no verification.
  - **Six small layout/reflection fixes from a round of visual QA screenshots (2026-07-31).**
    (1) **Lightbox "Similar" panel is a fixed square again** - `enlargeImage()`'s onload handler
    used to set `similarPanelEl.style.height` to match the enlarged image's own rendered height,
    which turned the panel into a tall, mostly-empty rectangle for any portrait image (the 3x3
    grid stayed pinned near the top with a huge gap below). Replaced with `width: 460px;
    aspect-ratio: 1;` (was `400px` + JS-driven height) on `.enlarge-similar-panel` - square
    regardless of whatever image is open, and bigger than before. `.enlarge-similar-grid` also
    gained `flex: 1; min-height: 0; align-content: center;` so its rows center within whatever
    space is left under the title instead of packing to the top ("justifying the images in it") -
    the JS height-matching block was deleted outright, not just disabled. The "hide the panel
    below this viewport width" breakpoint moved 1400px → 1500px to compensate for the panel's
    400px → 460px widen, same reasoning as the 1300px → 1400px bump the previous widen already
    used (see that entry above) - keep both numbers moving together if either changes again.
    (2) `.search-bar-icon`'s color changed from `--text-muted` to `--text-faint`, matching
    `#mainImageSearch::placeholder`'s color exactly, so the magnifying-glass glyph and the
    "Search images..." text read as one consistent muted color instead of the icon standing out
    slightly brighter. (3) **`.top-search-bar`'s left inset now matches `.main-content`'s own
    left padding** (`0.8rem` at the base tier, `0.6rem` at the ≤640px/≤420px breakpoints) instead
    of the `24px`/`12px`/`10px` it had independently drifted to - the search input's left edge
    was sitting visibly right of the gallery images' left edge; now both derive from the same
    value at each tier so they stay in sync if either changes again. (4) **`.folder-count` got a
    fixed `min-width: 2.4em`** (was auto-width, shrink-to-fit) - folder names were starting at
    different x-offsets from each other because the count's own box width varied with its digit
    count (1 vs 2 vs 3 digits), and the name sits right after it in the same `.folder-label` flex
    row. The counts themselves are unmoved (still left-aligned at the same position) - only the
    box's width is now constant, which is what makes the names line up. (5) **Sidebar frost art
    rebuilt as a single realtime scroll-synced strip, replacing the old 3-image/200ms-debounced
    swap version** - reported as "weird, they act like separate squares and update only after
    scroll." The old `getImagesNextToSidebar()`/`renderSidebarFrostArt()`/
    `scheduleFrostArtRefresh()` picked 3 thumbnails visible next to the sidebar and re-picked them
    on a 200ms scroll-debounce timer, which read as discrete pop-in/pop-out swaps rather than a
    reflection. Replaced with `getFirstColumnContainers()`/`buildSidebarFrostStrip()`/
    `syncSidebarFrostStripPosition()`: a single tall `.sidebar-frost-strip` div is built *once*
    per actual layout change (same hook `renderColorFilterDots()` already piggybacks on, plus
    init), containing up to `FROST_STRIP_MAX_IMAGES` (24) thumbnails from the gallery's entire
    first column - not just whatever's currently visible - each positioned at its own real offset
    within the gallery's full scrollable height (`rect.top - galleryRect.top + scrollTop`, which
    stays correct regardless of scroll position at build time). From then on, scrolling only ever
    moves this pre-built strip via `transform: translateY(-scrollTop)`, on every `scroll` event
    (rAF-throttled via `scheduleFrostArtSync()`, not debounced) - nothing is re-picked, re-fetched,
    or re-rendered while scrolling, so there's nothing to visibly "swap." The blur/saturate/opacity
    treatment moved from being set per-image to being set once on the `.sidebar-frost-strip`
    wrapper, so it reads as one continuous frosted surface instead of 3 separately-blurred squares.
    `will-change: transform` and the fact that `transform` is the *only* property this ever
    animates via JS keeps it GPU-composited - the (expensive) blur itself is only ever recomputed
    on a full rebuild, never on a scroll frame. (6) **Lightbox tags/resolution pill hidden while a
    new image is loading** - `enlargeImage()` already hid the "Similar" panel synchronously before
    starting a new image's load (to avoid flashing the *previous* image's similar set), but left
    `.enlarged-tags-container` showing the *previous* image's stale tags text underneath the
    spinner the whole time (most visible via the prev/next arrows, which call `enlargeImage()`
    again without a full modal close/reopen). Fixed by hiding it synchronously at the same point
    the Similar panel is hidden, and restoring it in **both** `onload` (already did this) and
    `onerror` (didn't - a failed image load used to leave the tags pill hidden indefinitely; now
    it shows the tags with an empty resolution, same as before this fix existed for the success
    path). While loading, only the spinner and prev/next arrows are visible now, matching the
    request. **Verified with the same Playwright + hand-rolled Firestore/Auth stub pattern
    documented in the header-redesign entry above** (40 synthetic SVG data-URI images across 3
    folders, varied aspect ratios) - confirmed the similar panel renders at 460×460 regardless of
    a portrait image being open, the tags container's inline `display` is `"none"` synchronously
    right after `enlargeImage()` is called and `"flex"` again once `onload` fires, the search
    icon's computed color exactly matches `--text-faint`, the search input's left edge and the
    first gallery thumbnail's left edge resolve to the identical `getBoundingClientRect().left`,
    folder names across items with 1/2/3-digit counts all resolve to the same `left`, and the
    frost strip's `transform` updates from `translateY(0px)` to `translateY(-400px)` after a
    `scroll` event fires with `scrollTop = 400` - screenshots taken, zero console errors from app
    code (only expected CDN-blocked-in-sandbox network errors).
  - **Second round of visual-QA fixes (2026-07-31, same day)** — five more items from a fresh
    screenshot pass. (1) **Lightbox download button was firing multiple downloads of the wrong
    images** - `enlargeImage()` called `downloadBtn.addEventListener("click", ...)` on *every* call
    (every open, and every prev/next arrow press), each with a closure over that call's own
    `url`/`filename`, and never removed the previous listener - browsing a few images then clicking
    Download fired every accumulated listener at once, downloading a batch of old images instead of
    just the current one. Fixed by binding the click handler exactly once at script load (outside
    `enlargeImage()`), reading `this.href`/`this.download` at click time instead of closing over
    parameters - `enlargeImage()` now only sets `downloadBtn.href`/`.download`, nothing else. (2)
    **`.enlarge-similar-panel` doubled 460px → 920px** (explicit "twice bigger" request), which
    exposed a real latent bug in the process: a fixed-square panel with 3 equal-width columns of
    `aspect-ratio: 1` thumbnails is *structurally* guaranteed to need very slightly more height than
    the panel actually has left over once the "Similar" title's own height is subtracted (padding is
    symmetric, but the title only eats into the *height* budget, never the width budget) - once
    there are enough matches to need all 3 rows, that overflow silently triggers `align-content:
    center`'s spec-mandated "safe" fallback to top-pinned alignment, which is exactly what made the
    gap above the first row and below the last row unequal. Fixed by giving `.enlarge-similar-grid`
    `grid-auto-rows: calc((100% - 20px) / 3)` (rows sized as a fixed 1/3 share of the grid's own
    available height, the same way columns are already sized as 1/3 of available width) instead of
    letting row height be an emergent side-effect of `aspect-ratio: 1` thumbnails - guarantees 3 rows
    exactly fill the available height with zero overflow, by construction, so `align-content: center`
    always has real (never negative) leftover space to split evenly for <9 matches. Thumbnails lost
    their own `aspect-ratio: 1` (now just fill whatever the grid's row-height math gives them,
    `object-fit: cover` absorbing the now-slightly-non-square cells) - a barely perceptible trade-off
    against a real, structural fix rather than nudging pixel values that would just as reliably drift
    out of sync again the next time the panel is resized. Verified via direct `getBoundingClientRect()`
    measurements against the grid's own box (not the outer panel, which still legitimately has the
    title's height as an *asymmetric* neighbor - that's expected and not what "margins" meant here):
    0px/0px for an exact 3-row fit, 290px/290px for a 1-row case - both symmetric. (3) Search icon
    changed from `--text-faint` (matched to the placeholder text, previous round) to `--highlight`
    (white) - explicit request. (4) **Sidebar frost art reworked a third time** - the second round's
    version (a strip of real `<img>` thumbnails covering the whole first column, scroll-synced via
    `transform`) still required a real network fetch per thumbnail, which is exactly what caused the
    reported "images taking time to load"/pop-in jumping. Replaced with `getContainerGlowColor()`
    mapping each image's already-known dominant-color keyword tag straight to a CSS color (reusing
    `COLOR_FILTER_SWATCHES`' hex values, so the glow always agrees with what the color filter dots
    call that color) and rendering it as a blurred `radial-gradient` circle (`.sidebar-frost-glow`)
    instead of an `<img>` - nothing is ever fetched, so nothing ever "loads" or jumps. Same realtime
    `transform: translateY()` scroll-sync mechanism as before (untouched) - `buildSidebarFrostStrip()`
    now builds colored divs instead of img tags, and since there's no network cost any more the
    per-build cap on how many first-column images get included was dropped entirely (every real
    first-column image gets its own glow blob now, not just a sampled 24). Images with no recognized
    color tag at all (pre-date the auto-tagger) fall back to a dim neutral gray rather than leaving a
    gap in the wash. (5) **Material-type facet filter removed outright** - explicit request,
    reversing the 2026-07-31 feature documented earlier in this file. Removed everything: the
    `.floating-material-panel`/`.material-chip*` CSS, the `#materialFilterPanel` markup,
    `MATERIAL_FILTER_OPTIONS`/`currentMaterialFilter`/`imageMatchesMaterialFilter()`/
    `getUsedMaterialFilters()`/`renderMaterialFilterChips()` and every call site (both `filterImages()`
    and `performSearch()`'s `imageMatchesMaterialFilter()` ANDs, every `renderMaterialFilterChips()`
    call alongside `renderColorFilterDots()`, and the delegated click handler). The color filter
    (`imageMatchesColorFilter()`, dots, `renderColorFilterDots()`) is untouched and still the only
    facet filter left besides folder/search. If a material-style facet is ever wanted again, don't
    resurrect this via source history without a fresh explicit ask - same rule this file already
    applies to the removed AI tagging. **All five verified via the same Playwright + hand-rolled
    Firestore/Auth stub pattern** (this time also stubbing `document.createElement`/`fetch` to catch
    exactly how many downloads/network calls a Download click actually triggers) - confirmed a single
    click after navigating through several images triggers exactly one `<a download>` click and one
    `fetch()` call (both against the currently-open image, not a stale one), the similar panel renders
    920×920 with the grid-margin symmetry described above, the search icon's computed color is
    `rgb(255,255,255)`, the frost strip contains zero `<img>` elements and N `.sidebar-frost-glow` divs
    with correctly-mapped `radial-gradient` colors that still `transform`-sync on scroll, and
    `.floating-material-panel`/`.material-chip-container` are absent from the DOM with
    `renderMaterialFilterChips` undefined on `window`.
  - **Third round of visual-QA fixes (2026-07-31, same day)** — three items.
    (1) **Lightbox horizontal spacing is now one token-driven rhythm, and the arrows no longer
    overlap the Similar panel.** Reported as "more space between maxed image and similar, same
    space between right of the image and right arrow". Three `:root` tokens (`--lightbox-row-gap`
    80px, `--lightbox-nav-inset` 20px, `--lightbox-nav-size` 48px) replace the hand-synced pairs
    this had drifted into - `.enlarge-main-row`'s `gap`, `.enlarge-nav-btn`'s size and the
    `.enlarge-nav-prev/next` insets all read from them, and `enlargeImage()` reads them *back* via
    `getComputedStyle(document.documentElement)` instead of carrying its own `ROW_GAP = 48`
    constant that had to be kept in sync with the CSS by hand (the previous entries in this file
    kept flagging that as a hazard; it now can't drift). The responsive tiers override the tokens
    rather than the rules (`:root` inside the ≤900px / ≤640px media queries), so the JS math
    automatically follows every tier. **The real bug this exposed:** `enlargeImage()` sized the
    image at a flat 90% of whatever width was left after reserving the panel, which left arbitrary
    side margins - at 1920px with the panel showing they came out ~50px, i.e. *narrower than the
    nav arrow's own 20px inset + 48px width*, so the right arrow genuinely overlapped the Similar
    panel. Now it reserves `navInset + navSize + ROW_GAP` per side explicitly, so a width-limited
    image lands exactly `--lightbox-row-gap` away from each arrow - the same gap that sits between
    it and the panel, which is what "same space" was asking for. Arrows stay anchored to the
    viewport edges (unchanged, and deliberately - anchoring them to the composition would make
    them jump horizontally between images); a height-limited (portrait) image is narrower than
    that budget so its arrows only ever sit *further* out, never closer. Also fixed in the same
    pass: the width-limited branch hardcoded `enlargeImg.style.width = "90vw"`, ignoring both
    reserves it had just computed - now set in explicit px from the computed available width. Cost
    of this: the image is meaningfully narrower than before at any given viewport (at 2400px,
    1104px instead of ~1432px) because the arrows' clearance is real space now. If that reads as
    too small, the number to revisit is `.enlarge-similar-panel`'s 920px width, not the reserve.
    (2) **Sidebar frost art is a real reflection again, reversing the previous round's colored
    glow blobs** - "light blobs in sidebar do not work, i want reflection of the images i'm seeing
    and scrolling (frosted)". `buildSidebarFrostStrip()` builds `.sidebar-frost-tile` divs (one per
    first-column image, at that image's own real offset/height within the gallery's full scrollable
    height, ±`FROST_TILE_BLEED` 8px so the gallery's row gap doesn't show as a seam) each holding a
    real `<img>`, instead of `.sidebar-frost-glow` radial gradients. The glow version existed
    specifically to avoid a network fetch per tile ("images taking time to load"/pop-in jumping) -
    two things pay that cost down instead of reverting blind: the source is a `w_200,q_50`
    Cloudinary transform at `fetchpriority="low"` (single-digit KB, blurred by 24px before anyone
    sees it, and never competing with real gallery thumbnails for connections), and each tile
    still paints `getContainerGlowColor()`'s dominant-color hex as its background *underneath* the
    image, which fades in on top via a `.loaded` class - so a tile is already the right color
    before its picture arrives and there is no blank state to pop out of. The
    scroll-sync mechanism is untouched (single strip, `transform: translateY(-scrollTop)`,
    rAF-throttled, rebuilt only on real layout changes). `getContainerGlowColor()` and
    `FROST_GLOW_FALLBACK_HEX` were **kept** for exactly that base-color role - don't delete them as
    dead glow leftovers. Blur/saturate/opacity (24px / 1.2 / 0.45) live on the one strip wrapper so
    neighbouring tiles blend into a single frosted surface rather than separately-blurred squares,
    and the strip is deliberately wider than the sidebar (`left: -30%; width: 160%`, clipped by
    `.sidebar-frost-art`'s `overflow: hidden`) so the blur's soft edges fall outside the visible
    area instead of fading out against the borders. If it ever needs toning down further, opacity
    is the knob - more blur just walks back toward the colour wash this replaced.
    (3) **ArtStation icon in the About modal replaced with the actual mark** - the previous glyph
    was a freehand approximation (a rounded triangle plus a bar, and no right leg at all). Now the
    real three-shape logo (triangle, separate bar beneath it, diagonal right leg, all sharing the
    same 30°-from-vertical edge angle) as a single path on the same 24×24 viewBox, so it still
    inherits `currentColor` and the existing 17px `.about-social-icon svg` sizing. The other three
    icons (website/LinkedIn/IMDb) are unchanged hand-drawn glyphs.
    **Verified with the same Playwright + hand-rolled Firestore/Auth stub pattern** documented in
    the entries above (42 synthetic SVG data-URI images, mixed portrait/landscape, 3 folders) - 24
    assertions across 2400px / 1400px / 500px viewports: the image↔panel, panel↔right-arrow and
    left-arrow↔image gaps all measure 80.0px at 2400px (232px arrow clearance for a portrait image,
    i.e. never less), 16px at the 500px tier with the arrow rendering at its 38px token size, the
    width-limited image's inline width ends in `px` not `vw`, the frost strip contains one `<img>`
    per tile and zero glow divs with every image reaching `.loaded`, tiles stacked in ascending
    order and the strip's `transform` tracking `scrollTop` exactly with the same DOM node and same
    first `src` before/after (i.e. moved, not rebuilt), and the ArtStation path rasterized to a
    canvas shows ink in the triangle band, ink in the bar band reaching x≈0, a real gap between
    them crossed only by the right leg, and ink at the far right - plus zero console errors from
    app code. The usual sandbox caveat still applies: **no live Cloudinary here**, so the frost
    tiles' real `w_200,q_50` fetch latency has never been measured against the actual CDN (the
    harness serves data URIs) - if pop-in is reported again, that transform's size/priority is the
    first knob to turn, not the mechanism.
  - **2026-08-01 batch: folder creation in the upload wizard, drag-select everywhere, faster pool
    rendering, synonym/translation tags, New This Week sort, sidebar blur, retargeted compression,
    a size pill, and a submissions badge** - ten separate requests landed together; documenting as
    one batch since several touch the same code.
    - **"+ Create New Folder…"** in the wizard's step 2 folder select (`CREATE_NEW_FOLDER_VALUE`
      sentinel option, appended by `renderFolders()`) - picking it `prompt()`s for a name (accepts
      "Parent/Child" for a subfolder, same convention `buildFolderStructure()` already expects),
      creates it via the same `folders.push()`/`saveFolderToFirebase()`/`renderFolders()` sequence
      `addFolder()` already used, and reselects the new folder afterward (renderFolders() rebuilds
      the `<select>` from scratch, wiping whatever was selected) - `lastFolderSelectValue` tracks
      the select's last real selection so canceling the prompt reverts to it instead of falling back
      to whatever option renders first. Scoped to just `folderSelect` (the wizard) - not
      `parentFolderSelect` (used *inside* the Add Folder modal itself) or `moveDestinationSelect`
      (Move Images).
    - **Click-and-drag multi-select extended to Delete/Move/Edit Tags** - previously only the
      upload wizard's pool grid (step 2) supported this; the gallery's own three select-then-act
      modes were click-only. `makeBulkSelectHandlers(isSelectedFn, setSelectedFn, isModeActiveFn)`
      is the shared mousedown/mouseenter pair (mousedown toggles + starts a drag, recording which
      direction - select or deselect - to apply to whatever container the pointer passes over next
      via mouseenter; a plain click is just a zero-distance drag), generalized from
      `wireSelectPoolTile()`'s own pattern. One shared `bulkDragState` (+ one document-level
      `mouseup` to end it, bound once - same "bind drag-lifecycle listeners globally" lesson this
      file already learned from the pool tiles, the lightbox download button, and the old upload-
      dock minimize button) covers all three modes safely since they're mutually exclusive by
      construction. Each mode still keeps its own selected-class + array (`selectedImages`/
      `selectedImagesForMove`/`selectedImagesForTagEdit`) - only *how* a container's selection
      toggles changed, not the state shape anything downstream (delete/move/Edit Tags save) reads.
      `onMouseDown` skips containers under a `.download-btn` (mousedown fires before the download
      link's own click-time `stopPropagation()`, which would otherwise not be enough to stop a drag
      from starting on it).
    - **Upload pool rendering no longer wipes and rebuilds on every change** - `renderPoolViews()`
      (step 1's view-only list and step 2's interactive grid) used to `innerHTML = ""` + recreate
      every tile's `<img>` against its already-created object URL on every add/remove/confirm.
      Assigning the same object URL to a *new* `<img>` still forces a redecode, and with a large
      pool that cost was paid again on every single change, not just for the images that actually
      changed - this is what "lags with many images" was. Fixed with the same identity-reuse
      pattern `buildSidebarFrostStrip()` already established for the sidebar reflection: tiles are
      now keyed by pool item id in `poolPreviewTilesById`/`poolGridTilesById`, `appendChild`ed into
      a fragment (which *moves* an already-existing tile rather than cloning it), and only truly
      stale tiles (their pool item no longer exists) get cleared. Verified via Playwright that a
      tile's `<img>` node identity survives a later unrelated pool addition.
    - **Synonym & translated tags** (`SYNONYM_MAP`/`TRANSLATION_MAP`, computeSynonymTags()/
      computeTranslatedTags()`) - same "closed vocabulary, no AI/ML" approach this file already
      uses for color detection and the (removed) material filter, not a generative thesaurus/
      translation API - a tag with no entry in either map just gets nothing, same as an untagged
      image gets no color dot. **Synonyms**: up to 2 per matched keyword, stored in a *separate*
      Firestore field/dataset attribute (`synonymKeywords`/`data-synonym-keywords`) rather than
      merged into `keywords` itself - this is why they show up in the lightbox tag list
      (`enlargeImage()` merges them into what it displays, never into `keywords`) but never in Edit
      Tags or the upload dock, both of which read/write `keywords` directly. Gated by
      `synonymTagsEnabled` (persisted to `localStorage`, toggled via the sidebar's "Synonym Tags:
      On/Off" admin button, next to Re-tag Colors) - turning it off removes synonyms from *both* the
      lightbox tag list and search matching (`performSearch()`), not just one. **Translations**:
      fr/de/it/zh/ja per matched keyword, stored the same way (`translatedKeywords`) but never
      rendered anywhere and not gated by any switch - always included in search matching ("so
      people searching in these languages/keyboards get the same results"). Both are computed and
      stored unconditionally at publish time (`completeUpload()`, Review Submissions' "Add") -
      `synonymTagsEnabled` only gates *use*, not generation, so flipping it back on doesn't require
      recomputing anything already stored. **Re-tag Synonyms** (next to Re-tag Colors) backfills
      both fields for every already-published image from its current `keywords` - "for each upload
      and previous uploads" - same one-time, explicit, admin-triggered bulk-rewrite shape as Re-tag
      Colors, but with no per-image network fetch (both compute functions are pure local lookups),
      so the only per-image cost is a Firestore write, skipped entirely for images whose computed
      values didn't change. Verified end-to-end via Playwright (stubbed Firestore): a "wood, old"
      image's lightbox tags render as "wood, old, timber, lumber, aged, weathered", and toggling the
      switch flips the button label correctly.
      **Real bug found and fixed by that same Playwright run, worth knowing before touching this
      area again**: `submissionsBadgeUnsubscribe` (see the badge entry below) was originally
      declared with `let` *after* the `auth.onAuthStateChanged(...)` call that references it. A
      stubbed auth backend that invokes its callback synchronously (rather than deferring to a
      microtask the way the real Firebase SDK typically does) hit that `let` while still in its
      temporal dead zone, throwing on page load and blocking the entire gallery from rendering.
      Fixed by moving the declaration and its two helper functions above the
      `onAuthStateChanged()` call - not just above their own first *use*, but above the point where
      an eagerly-firing callback could reach them at all. Low risk against the real Firebase SDK
      (genuinely synchronous initial callbacks are unusual there), but cheap to make robust against
      regardless rather than lean on that assumption.
    - **"New This Week" now sorts recent-first** - clicking it in the sidebar was already filtering
      to the current week's window (`getCurrentWeekWindowStart()`), but display order still followed
      whatever the gallery's general order happened to be (random by default - the manual sort menu
      was removed 2026-07-31). Its click handler now also calls `sortGallery("recent")` right after
      `filterImages(NEW_THIS_WEEK_FILTER)` - reorders *all* gallery children (not just the visible
      ones) by `addTime` descending, which persists if the admin later switches to another folder
      view, harmless since those don't care about order.
    - **Sidebar blur doubled** - `.sidebar`'s `backdrop-filter`/`-webkit-backdrop-filter` went
      `blur(20px)` → `blur(40px)` (explicit request), including its `@supports not (...)` fallback
      selector value. The floating color/size filter panels' own blur was left untouched - scoped to
      the sidebar only.
    - **Compression retargeted to an 850KB-1MB band** (was a flat ~1.5MB cap) -
      `compressImageIfNeeded(file, maxBytes = 1MB, minBytes = 850KB)`. The existing quality-sweep-
      then-shrink algorithm in `encodeCanvasUnderSize()` already picked the *highest* quality that
      still fit under the cap (least quality loss for a given ceiling), so retargeting `maxBytes`
      alone gets most of the way there; the addition is a second, finer-grained quality sweep
      (`FINE_QUALITY_STEP = 0.01`, vs. the coarse loop's `0.08`) that only runs when the coarse
      0.08-per-step sweep jumps straight from "too big" to "under 850KB" in one step (a real risk
      given how narrow - 150KB wide - the target band is) - it searches just that one coarse gap for
      a higher quality that's still under 1MB, which is always a better result than the coarse step
      alone found, whether or not it actually clears 850KB. This is a soft floor, not a hard one -
      JPEG size vs. quality isn't predictable enough to guarantee every image has *some* quality that
      lands inside a 150KB-wide band, so this narrows the gap as far as it reasonably can rather than
      promising an exact fit. An already-small original (at or under 1MB) is left alone rather than
      padded up toward 850KB - there's no way to add quality back once it's gone, so re-encoding an
      already-small file would be a pure loss with nothing gained.
    - **Lightbox size pill** (`#enlargedFileSize`, styled identically to `#enlargedResolution` via a
      shared `.enlarged-resolution, .enlarged-filesize` CSS rule) shows the *uploaded* (post-
      `compressImageIfNeeded()`) file's byte size, read from `container.dataset.fileSize` - which
      traces back to `uploadFile.size` at the point `processUpload()` calls `completeUpload()`, saved
      to Firestore as a new `fileSize` field alongside `keywords`/`folder`/etc. Blank for any image
      with no known size - notably every image published via Review Submissions' "Add", which was
      never a local `File` on this device to measure (fetched from a Cloudinary URL instead, same
      reasoning `detectDominantColorTagFromUrl()` vs. `detectDominantColorTag()` already documents).
      Unlike the resolution pill, file size doesn't depend on the image actually decoding
      successfully, so - caught by the same Playwright run, a real gap in the first version of this
      - it's shown in `enlargeImg.onerror` too, not just `onload`.
    - **Review Submissions pending-count badge** (`#reviewSubmissionsBadge`) - "when entering admin
      mode ONLY" is implemented by only ever attaching a `db.collection('submissions').onSnapshot()`
      listener while `auth.onAuthStateChanged` reports a signed-in user, detached immediately on
      sign-out (`setSubmissionsBadgeWatching()`) - a live listener rather than a one-off count check
      since it also has to reflect submissions that arrive *while* the admin is already signed in
      and browsing, and it means Dismiss/Add don't need their own manual "refresh the badge" calls -
      any change to the collection updates it on its own. Hidden (`display: none`) whenever the
      count is 0.
    **Sandbox caveat applying to all of the above**: no live Cloudinary/Firebase access here, so
    none of it has been exercised against real network latency, a real admin account, or real
    uploaded photos - verified instead via the same Playwright + hand-rolled Firestore/Auth stub
    pattern this file's Testing section documents (drag-select across all three gallery modes,
    folder creation via the sentinel option, the synonym merge/toggle, the size pill including the
    onerror path, and the pool tile identity-reuse fix all specifically exercised this way). The
    synonym/translation vocabulary is intentionally small and curated (matching this gallery's own
    folder names and the color auto-tagger's words) - if a commonly-used tag has no synonyms/
    translations yet, that's expected (not a bug) until `SYNONYM_MAP`/`TRANSLATION_MAP` are extended
    for it.
  - **Synonym tags forced permanently on, "Synonym Tags: On/Off" toggle removed (2026-08-01)** -
    reported as "synonyms arent applyed/on when booting the page and i need in admin mode to turn
    them off and on... Make sure they are forced." Root cause: `synonymTagsEnabled` defaulted to
    `true` in code, but was persisted to (and re-read from) `localStorage` on every page load -
    a stray `"false"` written there at some earlier point (an admin test-toggle) silently
    overrode that default forever after, on that one browser, with nothing on screen indicating
    synonyms were suppressed - the only way to notice was opening the sidebar and seeing the
    button already say "Off", and the only fix was toggling it, which only ever fixed *that one
    browser's* stored value, not the underlying design. A per-browser flag was never a good fit
    for something meant to always be on - `synonymTagsEnabled` is now a hardcoded `const true`,
    the `localStorage` read/write is gone, and the `synonymTagsToggleBtn` sidebar button (plus its
    `updateSynonymTagsToggleBtn()`/click-handler wiring) was removed outright rather than left as
    dead UI. Every call site that already checked `synonymTagsEnabled` (search matching,
    the lightbox tag merge) is untouched - it's a `const` now, but the conditional expressions
    reading it didn't need to change. Verified via Playwright: seeding a real `"false"` into
    `localStorage` *before* the page loads (reproducing the exact stuck-off scenario) still leaves
    `synonymTagsEnabled === true` after load, and `#synonymTagsToggleBtn` no longer exists in the
    DOM.
  - **Multi-word search (2026-08-01, explicit request: "allow for multiple search words matching...
    wood statue... steel tools")** - `performSearch()` used to test the *entire* typed string as one
    literal substring against each image's keywords/name/category/translated/synonym text, so a
    two-word query like "wood statue" almost never matched anything, even for an image tagged both
    "wood" and "statue" - tags are comma-separated single words, not phrases, so that exact
    multi-word run essentially never occurs verbatim in the haystack. Now splits the typed value on
    whitespace and requires *every* word to appear somewhere in the image's combined haystack (AND
    across words, OR across fields per word, same substring matching as before per word) - word
    order doesn't matter ("statue wood" matches the same images as "wood statue"), and each word can
    come from a different field (one from `keywords`, another from `data-category`). Verified via
    Playwright with three synthetic images ("wood, statue", "wood, chair", "steel, tools"): "wood
    statue" matches only the first, "steel tools" matches only the third, and a three-word query
    ("wood chair statue") that no single image satisfies in full correctly matches nothing - not a
    superset of "wood" alone.
  - **Dominant-color detector: yellow/mustard photos were coming back "brown" (2026-08-01)** -
    reported plainly as "lots of yellow dominant pics are stored in brown, fix that." Root cause,
    found by hand-computing HSL for real reference colors rather than guessing at thresholds again
    (the lesson every prior round of this saga already learned the hard way): the brown carve-out
    in `nameColorFromRgb()` caught any hue in `[15, 50)` with lightness `< 0.45` - but the plain,
    no-carve-out hue classification a few lines below already draws the orange/yellow boundary at
    `45` (`h < 45` -> orange, else -> yellow), so the brown carve-out's `50` upper bound reached 5
    degrees *past* that line into hue territory that would otherwise be yellow, not orange -
    meaning any sufficiently dark, saturated yellow/gold/mustard pixel (hue 45-50 - confirmed with
    `rgb(160,130,10)`, a real dark mustard color, at h=48/l=0.33) got diverted to "brown" before it
    ever reached the yellow check. Fixed by narrowing the carve-out's upper bound from 50 to 45,
    matching where the plain classification itself already splits orange from yellow - this only
    changes what the carve-out *catches*, not how it decides once a hue is actually in its range, so
    genuine dark oranges/browns still inside the narrower 15-45 band (saddle brown at h=25, dark
    goldenrod at h=43) are completely unaffected. Verified by hand-computing HSL for five real
    reference colors and confirming against the updated function: dark mustard now correctly returns
    "yellow" (was "brown"), while saddle brown, dark goldenrod, chocolate, and gold all return the
    same result as before. Existing images already mistagged "brown" need **Re-tag Colors** run
    again to pick up this corrected boundary - it isn't automatic. Same sandbox caveat as every
    other round of this saga: no live Cloudinary access here, so this is verified against real
    *reference* colors' HSL math, not a live re-tag against the actual reported photos - if another
    color still comes back wrong after this, get the real `[color detect]` console line for it first
    (see the `debugLabel` mechanism a few entries above) rather than tuning these boundaries blind
    again.
  - **Translation search missing "tools"/"planes" - not actually a synonym/translation coupling
    bug (2026-08-01)** - reported as "translation only works for synonyms it seems... i write
    'outil' and i dont get anything for tools... searching 'avions' i dont get planes results."
    `computeSynonymTags()` and `computeTranslatedTags()` are two entirely independent lookups
    against two separate maps (`SYNONYM_MAP`/`TRANSLATION_MAP`) - neither depends on the other -
    so there's no actual coupling to fix; the real cause was simpler and more literal: `tool(s)`
    and `plane(s)` were never keys in `TRANSLATION_MAP` *at all*, closed-vocabulary style, same as
    any other untracked word (see the block comment above `SYNONYM_MAP` - "a tag that isn't a key
    in either map below simply gets no synonyms/translations"). Added both singular and plural as
    separate keys for each (`tool`/`tools`, `plane`/`planes`) - this map only ever matches an
    image's *exact* typed keyword, so if the real admin-typed tag is the plural form ("tools") but
    only the singular had an entry, that image would still get no translation at all; adding both
    covers either tagging convention without having to know which one is actually in use.
    Storing the plural French form for each also happens to satisfy a singular search term for free
    (performSearch()'s `translatedKeywords.includes(searchTerm)` matches "outil" as a substring of
    a stored "outils"), but that's incidental, not the actual fix - the real fix is the keys
    existing at all. No `SYNONYM_MAP` entries were added for these (not requested, and per the
    existing "not all tags get a synonym" design this isn't required for translation to work).
    Existing images already tagged "tools"/"planes" need an admin to click **Re-tag Synonyms** to
    backfill `translatedKeywords` from this new map data - it already recomputes both fields
    together for every loaded image, so no separate mechanism was needed; only *new* uploads and
    Edit Tags saves pick this up automatically going forward. Confirmed via the same
    Playwright-against-the-real-page approach as prior synonym/translation work:
    `computeTranslatedTags('tools')` now returns a string containing `outils`, and a plain
    substring check confirms `outil` and `avion` (the singular French search terms actually typed)
    both match the stored plural translations for `tools`/`planes` respectively.
  - **Uploads were silently failing to publish entirely, fixed 2026-08-01 - a genuine production
    bug, caught from a real console log the owner pasted in.** Every upload was actually reaching
    Cloudinary fine (`console.log`'d "File uploaded successfully, URL: ..."), then immediately
    crashing with `Uncaught (in promise) ReferenceError: uploadFile is not defined` before
    `completeUpload()` ever ran - meaning the image genuinely existed on Cloudinary but never made
    it into Firestore or the gallery, for every single upload, silently (the dock's own error
    handling never caught this since the crash happened *after* the try/catch that would have shown
    it as a red "Error" row). Root cause: `processUpload()` declared `const uploadFile = await
    compressImageIfNeeded(file)` *inside* the try block, but used `uploadFile.size` afterward,
    outside it, for the fileSize param added by the same day's "Lightbox size pill" work - `const`/
    `let` are block-scoped, so `uploadFile` didn't exist any more the moment control left the `try
    { }` block, regardless of whether the try block itself succeeded. `imageUrl`/`colorTag` right
    above it already followed the correct pattern (`let` declared *before* the try block, assigned
    inside) specifically because they're also read after it - `uploadFile` just never got the same
    treatment when it was added later. Fixed by hoisting `let uploadFile;` up next to them. Confirmed
    via a Playwright run with the real `processUpload()` against a mocked upload endpoint: before the
    fix, the promise rejected with exactly that ReferenceError and nothing was ever written to
    Firestore; after, the same call resolves cleanly and the image saves with a correct `fileSize`.
    If another "file uploaded successfully then a ReferenceError" report shows up, check for this
    same shape first - a value computed inside `try { }` and used after it - before assuming it's a
    new bug.
  - **Fourth round of fixes (2026-08-01, same day) - real-usage bug reports against the batch
    above, plus one explicit new feature request.**
    - **`orange`'s synonyms no longer include `rust`** (`SYNONYM_MAP`) - `rust` is also its own
      real, distinct tag (`rust: ["corrosion", "oxidation"]`), so surfacing it as a synonym of the
      *color* orange read as wrong/confusing on an orange-but-not-rusted image. Replaced with
      `tangerine`.
    - **No color word gets a synonym at all, superseding the `orange`/`rust` fix above the same
      day** - "Dont add a synonym for colors" - all 13 `COLOR_FILTER_SWATCHES` color entries
      (`black`, `white`, `gray`/`grey`, `brown`, `beige`, `red`, `orange`, `yellow`, `green`,
      `cyan`, `blue`, `purple`, `pink`) were removed from `SYNONYM_MAP` outright, not just
      individually tuned - a synonym for a color name reads as a second, redundant color tag
      (e.g. `orange` -> `amber`/`tangerine` when `amber` is itself a real, separately-typed color
      some images use) rather than a useful alternate search term the way `wood` -> `timber` is.
      `computeSynonymTags()` also gained an explicit `SYNONYM_EXCLUDED_WORDS` guard (built from
      `COLOR_FILTER_SWATCHES` plus the `grey` spelling) checked before the `SYNONYM_MAP` lookup -
      belt-and-suspenders so a color re-added to the map later (e.g. by copying a neighboring
      entry's pattern) doesn't silently reintroduce this. Translations are untouched - colors still
      get `TRANSLATION_MAP` entries, since those exist purely to widen search matching in other
      languages, not to add a second displayed tag. Confirmed via the same
      Playwright-against-the-real-page approach as the rest of this file's synonym work:
      `computeSynonymTags()` on a CSV of all 13 color words returns an empty string, while a mixed
      `"wood, old, red"` list still returns `wood`/`old`'s synonyms with nothing for `red`, and an
      unrecognized word alongside a known one (`"xyz, wood"`) still only produces `wood`'s - the
      existing "not every tag gets a synonym, closed vocabulary" behavior is unchanged for
      non-color words. "Synonyms can re-tag completely" was also reconfirmed against the same-day
      Edit Tags fix above and Re-tag Synonyms (both already fully recompute-and-overwrite rather
      than merge) - no change needed there, already correct.
    - **Synonym/translated tags going stale after Edit Tags, fixed** - reported as "synonym tags
      seem to only apply to the last tag of each image." Root cause: `completeUpload()` and Re-tag
      Synonyms both correctly compute `synonymKeywords`/`translatedKeywords` from *every* keyword,
      but `saveEditedTags()` never touched either field at all - editing an image's tags (adding,
      removing, or replacing) left both fields exactly as they were computed at upload time, so the
      lightbox's merged tag display drifted out of sync with whatever the current `keywords` field
      actually said the moment Edit Tags changed it. Fixed by recomputing both fields from the *new*
      full tag set inside `saveEditedTags()` and writing them alongside `keywords` in the same
      Firestore update - a full recompute-and-overwrite, per the explicit "when regenerated synonyms
      delete previous ones (same for translation)" request, not a merge with whatever was there
      before.
    - **Lightbox size pill was showing as an empty box, not a real value** - `showFileSizePill()`
      (new) now hides `#enlargedFileSize` outright (`display: none`) when there's no known size,
      instead of leaving a blank rounded pill sitting next to the resolution pill. For images that
      genuinely have no known size (most existing photos predate the 2026-08-01 `fileSize` field;
      Review Submissions' "Add" never had a local File to measure), `fetchRemoteFileSizeIfMissing()`
      (new) backfills a real value via a HEAD request against the image's own original Cloudinary
      URL (reading `Content-Length`), caches it onto the container so it only runs once per image,
      and re-runs the lightbox's layout refresh once it resolves. This depends on Cloudinary
      actually exposing `Content-Length` to cross-origin JS (a `Access-Control-Expose-Headers`
      question, not just a plain CORS-allowed one) - same class of caveat
      `detectDominantColorTagFromUrl()` already has for its own crossOrigin canvas read - and, same
      as everything else touching Cloudinary in this repo, has not been checked against live
      Cloudinary. If the pill still doesn't backfill on old images, check that header first.
    - **Lightbox "safe zone" overflow, fixed for real via a measure-then-correct pass, not another
      estimate tweak** - reported (with a screenshot) as the tags/resolution caption sitting outside
      a comfortable margin at the bottom of the screen for a maxed portrait image. The caption's
      reserved height in `updateEnlargedImageSize()` was (and still is) a single-line *estimate*
      (54px) - fine for the common case, but an underestimate the moment a longer tag list wraps
      onto more lines, which is exactly what let the real, rendered caption slip past
      `--lightbox-safe-margin` (a new token, 32px desktop / 16px at <=900px, replacing a bare `20`
      constant). Rather than trying to guess the wrapped height more precisely up front, both ends
      of the actual problem got fixed: (1) `positionEnlargedTags()` now gives the caption a real
      **minimum width** - measured from the resolution/size pills' own rendered width plus a 200px
      floor for the tags text, not just "80% of the image's width" - since for an extreme portrait
      aspect ratio the image itself can render only a couple hundred px wide, and a caption that
      narrow forces even a short tag list into a tall, barely-readable stack of one-word lines
      (confirmed the hard way with a synthetic 1:3 portrait + 15-tag test case, which blew the old
      layout by over 1000px); (2) `updateEnlargedImageSize()` ends with a corrective loop (max 3
      passes) that measures the caption's *actual* rendered bottom edge and shrinks the image by
      whatever it overflows the safe margin by - accounting for the image being vertically centered
      (shrinking its height by X only moves its bottom edge up by X/2, so the correction removes
      **2x** the measured overflow, not 1x) - so the guarantee holds regardless of tag-list length,
      aspect ratio, or estimate error, instead of chasing the estimate itself again. Verified via a
      Playwright harness serving real (non-data-URI) JPEGs of varied real aspect ratios through a
      second local static server, across both the pathological synthetic case and several realistic
      ones (a 4-tag list on a 1:3 portrait, a no-tags square, a 6-tag list on a milder portrait) -
      all converge to exactly 0px overflow past the safe margin.
    - **Upload wizard steps 1/2 still laggy with more than ~3 images, and "i want original ratios"**
      - the 2026-08-01 batch's own tile-identity-reuse fix (`poolPreviewTilesById`/
      `poolGridTilesById`) stopped *unrelated* re-renders from re-decoding every tile, but never
      addressed the *first* decode: `thumb.src = item.url` pointed straight at the original file's
      object URL, and this gallery's real source photos are full phone-camera resolution (many MB,
      4000px+ on the long edge - `compressImageIfNeeded()` only runs later, at actual upload time).
      Asking the browser to decode several of those just to paint a ~110px tile is real, expensive
      work - confirmed via a Playwright harness using real multi-megapixel JPEGs (not data-URI
      stubs) rather than assumed. Fixed with `createPoolThumbnailUrl()` (new): `createImageBitmap()`
      with `resizeWidth` downscales *during* decode instead of decoding at full size and shrinking
      after, and a tile's `<img>` gets no `src` at all until that resolves (a neutral background-
      color placeholder shows in the meantime) - falls back to the plain object URL only if
      generation fails (e.g. HEIC in a browser with no native HEIC decode, same limitation
      `compressImageIfNeeded()` already documents). Only `resizeWidth` is given (not `resizeHeight`),
      which is also what fixes "original ratios": `.file-preview-item img`/`.wizard-pool-tile img`
      dropped their forced `aspect-ratio: 1; object-fit: cover` square crop in favor of `height:
      auto; max-height: 180px; object-fit: contain`, so a tile shows its real proportions
      (letterboxed if taller than the cap) instead of a center-cropped square. Verified via
      Playwright with real JPEGs at five different aspect ratios (including an extreme 1:3 portrait
      and a 3:1 panorama) confirming the rendered thumbnail's `naturalWidth`/`naturalHeight` ratio
      matches the source exactly (240px-wide thumbnails at 720/81/240/416px tall respectively).
    - **Review Submissions panel: original ratio, doubled size, per-image tagging (explicit
      request: "in review mode, show original ratio, double images/global window size. Allow for
      tagging like upload mode")** - `.submission-image-item img` dropped the same forced
      `object-fit: cover` square crop as the upload pool tiles above, for the same reason (real
      submitted photos shown uncropped); the tile width doubled 148px -> 296px, and the modal itself
      (`.submissions-review-content`) widened from a flat 840px cap to `calc(100vw - sidebar - 80px)`
      / max 1600px, matching the Add Image wizard's own sizing pattern - safe now that
      `.modal-backdrop` sits above `.sidebar` in the z-index stack (the 2026-08-01 site-wide fix
      that same-day Add Image wizard entry put in place; this panel's 840px cap only ever existed to
      dodge that before the real fix landed, so widening it now is just catching up, not
      reintroducing the old overlap risk - `#reviewSubmissionsModal` gets the same `padding-left:
      var(--sidebar-width)` treatment `#imageModal` already uses so it centers over the gallery area
      rather than the full viewport). Each image now also gets its own tag-chip input
      (`initTagChipInput()`, the exact same control the upload wizard's Keywords field uses) between
      the folder `<select>` and the Add button - typed tags merge with the auto-detected color tag
      the same way `processUpload()` already merges typed Keywords with it for a normal upload
      (`mergeTagStrings(typedTags, colorTag)`), rather than the admin being limited to whatever
      color word `detectDominantColorTagFromUrl()` comes up with. Verified via Playwright (a
      two-image fake submission, real JPEGs through the same second local static server as the pool-
      tile fix above): tile width measures exactly 296px, `object-fit` computes to `contain`, typing
      "wood" + "rustic" into the chip input then clicking Add saves `keywords` as
      `"wood, rustic, brown"` (the typed tags plus a stubbed `brown` color tag) on the resulting
      gallery image.
- **`netlify/functions/upload.js`** — receives multipart uploads (Busboy), pushes the file to
  Cloudinary, pre-generates 1200px/1920px derived sizes (`eager`) so the frontend's
  `cloudinaryDisplayUrl()` requests don't transform on first view. Cloudinary's `public_id` used to
  be derived from `Date.now()-filename` alone (2026-07-31: now `Date.now()-<random suffix>-filename`)
  — a stability audit (prompted by "make sure images won't disappear randomly") flagged that two
  uploads sharing the same filename landing in the same millisecond would collide on `public_id`,
  and Cloudinary's default upload behavior *overwrites* an existing asset at a colliding
  `public_id` rather than erroring — silently replacing a previously-uploaded image's actual content
  with the new one. Each request here is its own Netlify function invocation (a separate process),
  so there's no shared in-memory counter to reach for the way the frontend's `uploadBatchCounter`
  fix (see Publish Queue below) closed the equivalent gap client-side — a random suffix is what
  closes it here regardless of how many invocations are concurrently in flight. Untested against
  live Cloudinary (same sandbox limitation as everything else touching it in this repo); the
  `tests/upload.test.js` assertions (`public_id` contains the filename, isn't just the filename)
  still hold.
- **Sidebar frost strip no longer tears itself down on every relayout (2026-08-01)** — reported as
  "reflections jump in a weird way" while scrolling. `buildSidebarFrostStrip()` used to gate its
  whole rebuild (new `<div>`/`<img>` per tile, `strip.innerHTML = ""` first) behind "has the
  first-column docId list changed since last time", skipping the rebuild entirely otherwise - which
  sounds like the right optimization, but `layoutGallery()` (and so this) reruns on *every*
  lazy-loaded thumbnail's own `load` event while scrolling, not just filter/search/add/delete, and
  each of those can shift row heights (a real aspect ratio replacing the 1.5 fallback) without
  changing *which* images are first-column. Net effect: most calls skipped the position update too
  (it lived inside the same gated block), so tiles silently drifted out of sync with the gallery
  until some later call's membership actually did change, at which point the full rebuild snapped
  everything to its correct position at once and reset every tile's `<img>` (fresh fetch, opacity
  back to 0 to fade in again) even for images that hadn't changed - that combined snap+refade is
  what read as a "jump." Fixed by decoupling the two: positions are now recomputed on *every* call
  (cheap - just inline style writes), while tile identity is preserved via a `docId`/`url`-keyed
  `Map` (`frostTilesByKey`) - a tile that's still a first-column image keeps its actual DOM node
  (and thus its already-loaded `<img>` and faded-in opacity), only tiles that actually stop/start
  being first-column get removed/created. Verified with a Playwright + hand-rolled Firestore stub
  (12 synthetic images): calling `buildSidebarFrostStrip()` twice back-to-back with unchanged
  membership keeps the exact same `<img>` node references and `.loaded` state; hiding one
  first-column image and rebuilding removes only that image's tile while an unrelated row's tile
  keeps its node identity (the freed row-slot gets backfilled by whatever sibling the gallery's own
  flex-wrap reflows into it, which is correct, expected justified-gallery behavior, not a bug in
  this fix).
- **Lightbox content is vertically centered again, not top-anchored (2026-08-01)** — reported as
  unequal top/bottom margins around the enlarged image (and, since it shares the same outer
  centering, the "Similar" panel). `enlargeImage()`'s `onload` handler was overriding the modal's
  `justify-content: center` (set when the modal opens) to `flex-start` plus a fixed 20px top/bottom
  padding once the image's own size was known. That padding was only ever meant to *size* the image
  (leave room under it for the tags row without overflowing the viewport, via `availableHeight`) -
  but it got applied a second time as literal CSS padding on top of that. A width-limited (short/
  wide) image renders shorter than `availableHeight`, so under `flex-start` the unused leftover
  space all collected below the content (just the fixed 20px above, everything else below); a
  height-limited (tall) image happened to look fine since it was sized to fill `availableHeight`
  almost exactly either way. Fixed by simply not re-overriding `justify-content`/padding in the
  `onload` handler - centering the whole column as a unit means leftover space always splits evenly
  above and below, for any image shape, the same reasoning already used for centering
  `.enlarge-main-row` horizontally. Verified via Playwright (synthetic wide/short and tall/narrow
  images): top/bottom gaps measured equal (195px/195px and 17px/17px respectively) in both branches.
- **Lightbox tags are no longer truncated, and stay centered while wrapping (2026-08-01)** —
  `.enlarged-tags` had `white-space: nowrap; text-overflow: ellipsis`, cutting off a long keyword
  list instead of showing all of it (explicit request: "always show all tags"). Changed to
  `white-space: normal; word-break: break-word` so a long tag list wraps onto more lines instead of
  being cut off, with `border-radius` switched from a 999px pill to `var(--radius-lg)` since a full
  pill radius only reads right on a single line. `.enlarged-tags-container`'s existing
  row-centered-as-a-unit layout (from the 2026-07-31 rework) already keeps the tags+resolution pair
  centered under the image regardless of width, and continues to do so once the tags pill grows
  taller from wrapping - verified via Playwright with a 25-tag keyword string: full text present,
  wrapped to 3 lines, and the tags pill's horizontal center still landed exactly on the image's
  (and its column's) own center.
- **Tag chip input dedupes exact-match tags (2026-08-01)** — `initTagChipInput()`'s `commitPending()`
  already deduped case-insensitively when a tag was typed then Enter/comma/blur-committed, but two
  paths around it didn't: `setTags(csv)` loaded a csv string (e.g. an image's existing keywords)
  into chips verbatim, so a literal duplicate already sitting in Firestore stayed duplicated, and
  `getValue()` concatenated whatever text was still sitting uncommitted in the input field onto the
  committed chip list without checking it against them first - so clicking Save immediately after
  typing a tag that already had a chip (without the field ever blurring) let an exact duplicate
  through. Both now route through one shared case-insensitive `dedupeTags()` helper (first
  occurrence's casing wins). This is the single shared implementation `initTagChipInput()` backs
  every tag field with (Add Image, Publish Queue, Edit Tags), so the fix applies everywhere tags are
  entered, not just one modal.
- **Search bar magnifying-glass icon was invisible - real cause found via pixel sampling, not CSS
  inspection (2026-08-01)** — reported as "can't see the search icon," despite `getComputedStyle()`
  reporting it at full white/`opacity:1` the whole time (which is exactly why earlier passes assumed
  it was already fine - this is the same trap the CLAUDE.md history above has hit before: computed
  styles or DOM assertions aren't proof of what's actually on screen). Confirmed with a headless
  Chromium screenshot sampled pixel-by-pixel (`pngjs`): the icon rendered as near-black, not white.
  Root cause, isolated with a ~60-line standalone repro: `#mainImageSearch` (the `<input>`) has its
  own `backdrop-filter: blur(10px)`. Even though the input is `position: static`, `backdrop-filter`
  (like `filter`/`transform`/`opacity<1`) makes it establish a stacking context of its own, and a
  `z-index: auto` stacking context still paints in the same "z-index: 0" bucket as this absolutely-
  positioned, `z-index: auto` icon - within that bucket, later DOM order paints on top. The input
  comes after the icon in the markup, so the input (and its blur) was painting over the icon instead
  of the reverse. Fixed with `z-index: 1` on `.search-bar-icon`, which moves it to the next bucket up
  - always painted after (on top of) any `z-index: 0` stacking context regardless of DOM order.
  Confirmed fixed by re-sampling pixels (dark ~24/255 before, 255/255 after) in both the isolated
  repro and the real page. If another icon/overlay sitting next to a `backdrop-filter` element ever
  looks "washed out" or dim despite correct-looking computed styles, this exact stacking interaction
  is the first thing to check - and check with actual rendered pixels, not just computed style
  values, since those can (and here did) disagree.
- **Similar-panel thumbnails reuse the gallery's own cached thumbnail URL (2026-08-01)** — reported
  as loading "relatively slowly." Each of the 9 thumbnails was requesting a fresh
  `cloudinaryDisplayUrl(url, {width:200})` - not one of `upload.js`'s pre-generated `eager` sizes
  (1200px/1920px), so Cloudinary has to transform it on the fly the first time anyone asks for that
  exact size, on top of the network round trip. The main gallery grid already requested
  `cloudinaryDisplayUrl(url, {width:1200})` for the same image (an eager, pre-generated size) when it
  first rendered as a thumbnail - reusing that exact URL (via the other container's own `<img>.src`,
  already resolved) means Cloudinary never has to cold-transform a new size, and since it's the
  *same* URL as before, the browser's own HTTP cache usually already has it, sometimes making the
  "fetch" free. Also dropped `loading="lazy"` on these - they're always already on-screen the instant
  the panel shows, so lazy-loading only adds an intersection-check delay with nothing to defer.
  Falls back to a fresh width:1200 request only if the source container's own `<img>` is somehow
  missing. Not benchmarked against a real Cloudinary CDN (same sandbox limitation as everything else
  touching Cloudinary in this repo) - the reasoning follows the same eager-transform-cache-miss
  pattern already documented elsewhere in this file for the main lightbox image.
- **Folder names brighter, sidebar background darker (2026-08-01, explicit requests)** — `.folder-
  list > li` and `ul.subfolder-list li`'s base (non-selected, non-hover) text color changed from
  `--text-muted` (#96969f) to `--text` (#ededf0); `.folder-count` deliberately left on `--text-faint`
  so the name still reads as primary and the count as secondary. `.sidebar`'s frosted background
  darkened from `rgba(26,26,30,0.82)` to `rgba(16,16,19,0.88)` (closer to `--bg` than
  `--bg-elevated`, which is what that literal rgba matched) - the floating color/size panels that
  share the same original rgba value were deliberately left untouched, this was sidebar-only.
- **Sidebar frost strip: fixed a real vertical misalignment vs. the gallery images it mirrors
  (2026-08-01)** — the 2026-08-01 tile-reuse fix above stopped the reflection from visibly
  resetting/jumping, but a follow-up screenshot showed it still "doesn't match the images next to
  it." Root cause, found by comparing actual rendered pixel positions (not just DOM/computed-style
  assertions - the same class of gap that let the search-icon bug ship unnoticed): tile `top` was
  computed relative to `#gallery`'s own top (`galleryEl.getBoundingClientRect()`), but tiles render
  inside `#sidebarFrostArt`, which is `inset:0` within `.sidebar` - and `.sidebar` starts at the very
  top of the page, while `#gallery` sits *inside* `.main-content`'s own `padding-top` (clearing the
  fixed header - 80px at the base tier, more at narrower breakpoints). Every tile was rendering
  exactly that padding amount higher on screen than the real image it mirrors. Fixed by measuring
  each tile's offset against `art.getBoundingClientRect()` (the actual container the strip lives in)
  instead of the gallery's - correct regardless of the header's height at any breakpoint. Verified via
  Playwright: comparing a first-column image's rendered rect against its matching frost tile's rect
  (matched by image src) now gives a constant `-8px` offset across every row, which is exactly
  `FROST_TILE_BLEED` (the deliberate bleed so the gallery's row gap doesn't show as a seam) - not a
  bug, the intended value.
- **Lightbox: the enlarged photo itself is now vertically centered, not just the photo+caption block
  as a whole (2026-08-01)** — a follow-up screenshot (with the true viewport center and the image's
  actual center marked) showed that even after the 2026-08-01 "equal top/bottom margins" fix above,
  the *picture* itself still sat above true center - because that fix centered `.enlarge-image-column`
  as a whole (image + tags/resolution caption stacked in flow), so the caption's own height still
  pushed the image upward by about half of itself. Fixed by taking the caption out of flow entirely:
  `.enlarged-tags-container` is now `position: absolute` (`left/right: 10%`, same ~80%-of-image-width
  cap as its old `max-width: 80%`) instead of a flex sibling with `margin-top: auto`, so
  `.enlarge-image-column`'s only *flow* child is the image - centering the column (`justify-content:
  center`, plus `.enlarge-main-row` now explicitly `height: 100%` so the column has a real full-height
  box to center within, not just whatever height incidentally came from the "Similar" panel being
  tall enough to stretch it) centers the image alone. The caption's position is set by
  `enlargeImage()`'s new `positionEnlargedTags()`, called from both `onload`/`onerror` after the
  image's width/height are set: `top = imgRect.bottom - columnRect.top`, i.e. directly under the
  image's own just-rendered bottom edge, wherever that lands. Knock-on fix needed in the same pass:
  `availableHeight`'s reservation (used to cap a tall/height-limited image's size so there's still
  room left for the caption) had to reserve **double** the caption's estimated height, not one - since
  the image is now centered in the *full* viewport height, only *half* of whatever's reserved ends up
  below the image (the other half goes above it, symmetrically), so reserving a single caption's worth
  only left half a caption's worth of actual clearance. Verified via Playwright for both a
  width-limited (short/wide) and height-limited (tall/narrow) synthetic image: image's own vertical
  center now measures exactly equal to the modal's true vertical center (0px difference) in both
  cases, and the caption's bottom edge lands exactly at the viewport edge for a maximally-tall image
  (no overflow) rather than the ~11px overflow the single-reservation version had.
- **Subtle large drop-shadow on the floating size/color filter panels (2026-08-01, explicit
  request)** — added a `--shadow-float` token (`0 28px 70px rgba(0,0,0,0.35)` - bigger blur/spread,
  lower opacity than the existing `--shadow-md`) and pointed `.floating-size-panel`/
  `.floating-color-panel` at it instead, so they read as lifted further off the gallery behind them
  without the shadow itself looking heavy/dark. Left every other `--shadow-md` user (modals, similar-
  panel thumbnails, etc.) unchanged - this was scoped to just those two panels per the request.
- **Add Image modal rebuilt as a large step-by-step wizard (2026-08-01, explicit request: "make
  the upload page way bigger... as big as the images container of the page with margins... make
  it intuitive and steps logic")** — replaces the same-day 900px two-column layout.
  `.image-modal-content` is now sized against the viewport/sidebar the same way `.main-content`
  itself is (`width: calc(100vw - var(--sidebar-width) - 80px)`, capped at 1400px, with a real
  `min-height: min(70vh, 700px)` so a short step - step 2's plain fields, step 3's summary - can't
  shrink the whole modal back down to a small dialog), and its three fields (file picker, folder+
  tags, review+publish) are now three `.wizard-panel`s shown one at a time
  (`setWizardStep()`/`wizardFurthestStep` in the script) instead of all at once: **1) Select
  Images** - a big drag-and-drop `.wizard-dropzone` (`flex:1`, so it actually fills the stretched
  column instead of shrink-wrapping) wrapping the same `#fileInput`, plus drop-to-populate handling
  new on top of the existing label-click-to-browse behavior; **2) Folder & Tags** - the pre-existing
  `#folderSelect`/`#imageKeywords` fields, unchanged; **3) Review & Publish** - a plain-language
  summary (`updateWizardReviewSummary()`) plus the existing "Add"/"Add to Queue" buttons (renamed
  "Publish Now"/"Add to Queue" in the UI, ids unchanged). A step pill in the indicator row is
  clickable once `wizardFurthestStep` has reached it (lets you jump back without hunting for the
  Back button, but never jump *ahead* to an unvalidated step). The publish-queue panel (staged
  batches) moved out of being conditionally shown and is now a permanent, always-visible section of
  the side column (with `#publishQueueEmpty`/`#filePreviewEmpty` placeholder text so neither side of
  the modal looks broken/blank on a fresh open) - it's no longer sharing space with a `wizard-panel`
  that only shows on step 1. Every existing element id (`fileInput`, `folderSelect`,
  `imageKeywords`, `confirmAddImageBtn`, `queueAddImageBtn`, `publishQueueBtn`, `filePreviewList`,
  `uploadQueueList`, etc.) is unchanged, so none of `startUploadBatch()`/`processUpload()`/
  `renderUploadQueue()` needed to change - only new step-navigation JS was added on top, plus
  `resetImageModal()`/`addImageAdminBtn`/`queueAddImageBtn` each now also reset the wizard back to
  step 1 at the appropriate point (closing/reopening the modal, or after staging a batch to
  immediately start the next one).
  **This surfaced a real, pre-existing site-wide bug, not just a sizing question:** widening this
  modal past roughly `viewport - 540px` ran straight into the exact hazard
  `.submissions-review-content`'s own comment already flagged - `.modal-backdrop` (999) sits
  *below* `.sidebar` (1100), so a modal wide enough to visually extend under the sidebar has that
  overlapping strip's clicks swallowed by the sidebar instead of reaching the modal underneath.
  Confirmed via Playwright (a step-pill click landing in that strip resolved to `.sidebar-scroll`,
  not the modal) before fixing it, rather than shrinking this modal back down to dodge it. Fixed
  by raising `.modal-backdrop` to `z-index: 1150` site-wide - above the sidebar, still below the
  About/Submit/Contributors buttons and the lightbox/upload dock (15000+/20000) - which is the
  general fix that comment already called for; `.submissions-review-content`'s own 840px cap was
  left in place (still harmless) rather than widened, since nothing asked for that panel to grow.
  Separately, `#imageModal` specifically also gets `padding-left: var(--sidebar-width)` (reset to
  0 at the <=900px tier, where the modal drops to a plain centered dialog) - without it, a modal
  this wide centered on the *whole viewport's* midpoint instead of the gallery area's own midpoint,
  visibly spilling left past the sidebar's right edge even after the z-index fix stopped it from
  being unclickable there. **Verified end-to-end via Playwright** (a hand-rolled Firestore/Auth
  stub, since there's no live Firebase/Cloudinary in a sandboxed session) - the modal renders
  centered over the gallery area only (not overlapping the sidebar), all three steps show/hide
  correctly, step-pill forward/backward jumps work, the empty-state placeholders toggle correctly,
  and a full add-to-queue round trip leaves the right batch in the queue list and resets to step 1.
- **Search bar placeholder: crossfade replaced with an actual typewriter animation (2026-08-01,
  explicit request: "make the searchbar text animation like a typewriter instead of appear/
  disappear")** — `#searchPlaceholderFade` now wraps two inline spans, `#searchPlaceholderText`
  (the part the script rewrites) and a separate blinking `.search-placeholder-cursor` (`|`,
  CSS `@keyframes` opacity blink) after it. `runTypewriterStep()` types each phrase from
  `getSearchPlaceholderOptions()` (unchanged - still "images..." plus every real top-level folder
  name, read live) character-by-character, pauses, deletes it character-by-character, then moves to
  the next phrase - replacing `rotateSearchPlaceholder()`'s old fade-out/swap-text/fade-in. It's a
  single self-perpetuating chain (each tick schedules the next one itself via `setTimeout`), and
  every tick checks `isSearchPlaceholderIdle()` (unchanged condition: not focused and no typed
  value) - while the field isn't idle, a tick just reschedules itself instead of progressing, so
  focusing/typing pauses whichever phrase is mid-type/delete exactly where it is and resumes from
  there once idle again, rather than restarting. The instant show/hide on focus/blur/input (the
  `.search-placeholder-hidden` opacity toggle) is unchanged - only how the text *cycles* changed.
- **Sidebar-brand separator aligned to the search-bar separator (2026-08-01, explicit request)** —
  the horizontal line under "aReference" and the one under the search bar (`.top-search-bar`'s own
  `border-bottom`) used to land at different heights (confirmed by measurement: ~9px apart at the
  base tier before this, and off by a full `.sidebar`-padding's worth - ~10.5px - at the <=640px/
  <=420px tiers specifically). Added a `--header-height` token (71px at the base tier), set via a
  **headless-measured** `.top-search-bar` `getBoundingClientRect().bottom` at each breakpoint, not
  computed by hand from the padding/font-size rules or copied from `.main-content`'s own
  padding-top (128px/112px/104px at the same breakpoints) - that padding exists to clear the
  About/Submit/Contributors buttons once they drop to their own floating row below the bar at
  <=900px, which is a taller, separate thing from where the bar's own border-bottom actually sits.
  `.sidebar-brand` gets an explicit `height: calc(var(--header-height) - 0.8rem)` (flex-centered
  text) so its own border-bottom lands at exactly `--header-height` from the top of the viewport -
  **except** at the <=640px/<=420px tiers, where it's `calc(var(--header-height) - 1.4rem)`
  instead, because `.sidebar` itself also gets `0.6rem` padding at those two tiers (on top of
  `.sidebar-scroll`'s own constant `0.8rem`) - `.sidebar-scroll` is a normal-flow (non-absolute)
  child of `.sidebar`, so that padding pushes it inward too. **This second part was previously
  assumed to be dead/unused CSS** (see `.sidebar`'s own padding rule) - it isn't; if `.sidebar`'s
  padding ever changes at those tiers, this offset needs re-checking. Verified via Playwright
  across all four breakpoints (320-1600px swept in ~20px/tier increments) - the two separators'
  `getBoundingClientRect().bottom` values now agree to within ~0.5px (float rounding) everywhere.
- **Lightbox tags/resolution caption no longer goes stale on a viewport change (2026-08-01,
  reported as "when going from fullscreen to windowed, the tags and resolution box disappear and
  only come back when opening another image")** — root cause: `enlargeImage()` computed the
  enlarged image's size and the caption's position (`positionEnlargedTags()`) exactly once, driven
  off the image's `load`/`error` event, using `window.innerWidth`/`innerHeight` at that moment.
  Nothing re-ran that math on a later viewport change - a window resize event *does* fire for
  entering/exiting browser fullscreen (confirmed the existing gallery relayout already listens for
  plain `resize` for this reason), but only the gallery's own `scheduleLayout()` was wired to it,
  not anything inside the lightbox. Since `.enlarge-image-column` re-centers on any viewport change
  but the caption's `top` (an absolute-position pixel value, set once) didn't, the caption ended up
  positioned relative to where the image *used to* be, not where it re-centered to - usually well
  past the image's new bottom edge, off toward/past the viewport edge, reading as "disappeared."
  Fixed by factoring the onload sizing math out into `updateEnlargedImageSize()` (callable
  independently of the load event, unlike before) and exposing a per-open `refreshEnlargedLayout()`
  through a new module-level `activeEnlargedLayoutRefresh` variable (mirrors the existing
  `currentEnlargedContainer` pattern, cleared in `closeEnlargeModal()`) - a **single**, bound-once
  `resize`/`fullscreenchange`/`webkitfullscreenchange` listener (rAF-throttled the same way
  `scheduleFrostArtSync()` already is) calls whichever refresh function is currently active, if any,
  instead of `enlargeImage()` adding a new listener on every open (the same "listener bound inside a
  function that runs repeatedly, never cleaned up" shape this file has hit and fixed before, for the
  download button and the old minimize button). Verified directly (not just reasoned through) via
  Playwright: opened the lightbox against a synthetic image, shrank the viewport to simulate exiting
  fullscreen, and confirmed the caption's own `top` recomputed to the new, correct value and stayed
  fully within the new viewport bounds, rather than the stale value that would have put it well
  below the shrunk viewport's bottom edge.
- **Contributors button + modal (2026-08-01, explicit request)** — a fourth header button
  (`.contributors-btn`, dark-pill styled like `.about-btn` since it's informational, not an action
  like Submit), sitting left of Submit/About, opening `#contributorsModal` ("Images contributors"
  heading + a plain `<ul>`). Names are **not** hardcoded in `index.html` - `loadContributorsList()`
  `fetch()`es `contributors.txt` (repo root, one name per line, blank lines skipped) fresh every
  time the modal opens, so editing that plain text file is enough to change the list, no HTML/JS
  edit needed. Falls back to a muted "Could not load..." list item if the fetch fails (e.g. opened
  via `file://` rather than a real server) rather than blocking the modal, same defensive shape as
  the first-visit `localStorage` check right above it in the script. Needed real layout surgery to
  fit a third button in, not just a new CSS rule: `.top-search-bar`'s reserved `padding-right` grew
  270px -> 420px to keep clearing all three buttons, and - confirmed via a headless sweep across
  the *entire* 320-1600px width range, not just the four named breakpoints - a naive "shrink and
  keep all three on one row" approach at the <=640px tier put Contributors' left edge underneath
  the sidebar for every width from 421px to ~515px, not just at the narrowest phone sizes. Fixed by
  dropping Contributors to its own row below About/Submit at both the <=640px and <=420px tiers
  (`.main-content`'s `padding-top` grown to 156px/154px respectively to clear the extra row) rather
  than continuing to shrink it to fit one row - same "own row below the header" pattern
  About/Submit themselves already use at <=900px, just one tier lower and for one button instead of
  two.
- **Submit/Contributors swapped positions, both given About's background blur (2026-08-01,
  explicit requests)** — Submit is now the outermost (leftmost) header button, Contributors sits
  between it and About (was the reverse) - purely a `right`/`top` swap between `.submit-reference-
  btn` and `.contributors-btn` at every breakpoint (including which row each drops to at the
  <=640px/<=420px tiers), About's own values untouched; the three `<button>` tags were reordered in
  the HTML to match, for tab-order sanity. Separately, `#submitReferenceModal`/`#contributorsModal`
  didn't have the `backdrop-filter: blur(15px)` rule `#aboutModal` already had (they all share the
  same `.modal-backdrop` z-index/opacity/transition, but the blur was `#aboutModal`-only) - all
  three ids now share one rule.
- **Search placeholder typewriter: no more generic "images..." phrase, folders/subfolders type out
  in capital letters (2026-08-01, explicit request)** — `getSearchPlaceholderOptions()` dropped the
  hardcoded `"images..."` entry entirely and now selects `#folderList li:not(.all):not(.new-this-
  week) > .folder-label > .folder-name` (was scoped to `#folderList >` direct children only) so
  subfolders cycle through too, not just top-level folders - both levels share the same `li >
  .folder-label > .folder-name` DOM shape (see `renderFolders()`), so widening the selector was
  enough on its own. Each name is `.toUpperCase()`'d before the `...` suffix is appended, so the
  typewriter types e.g. "WOOD..." - "All"/"New This Week" stay excluded, same as before.
- **Admin login: "Username" label/placeholder instead of "Email" (2026-08-01, explicit request)** —
  cosmetic only. `#adminEmailInput` is still `type="email"` and still gets passed straight to
  `signInWithEmailAndPassword()` unchanged - there's still exactly one admin account and it still
  has to be signed in with the real address (isakovicadrien@gmail.com), only the visible label/
  placeholder text changed. Don't widen this into an actual separate-username concept without a
  fresh explicit ask - Firebase Auth here only knows email/password.
- **Add Image modal rebuilt a second time the same day into a pool → sort/tag → review flow
  (2026-08-01, explicit request: "still not convinced... bigger page... first step is to upload ALL
  images... second step is easy selecting (click and hold and hover... by dragging the mouse)...
  Third page: queue review... Publish, done")** — supersedes the same-day three-step wizard
  documented earlier in this file (Select Images / Folder & Tags / Review & Publish, with per-step
  "Publish Now"/"Add to Queue" buttons). The step *panels* and step *indicator* survive, but what
  happens in each one changed completely:
  - **Step 1 ("Add Images")** - the dropzone is unchanged, but it no longer feeds a single
    folder+tags selection directly. Every file chosen (via any number of separate browse/drop
    actions in the same modal session) is pushed into `uploadPool` (module-level array of
    `{id, file, url}`, `url` an object URL) instead of being read back off `fileInput.files` -
    `fileInput` is reset to empty immediately after each add (`fileInput.addEventListener("change",
    () => { addFilesToPool(fileInput.files); fileInput.value = ""; })`) specifically so the native
    input's own "replace on re-select" behavior can't clobber what's already in the pool. A
    view-only preview grid (`#poolPreviewList`, reusing the old `.file-preview-list`/
    `.file-preview-item` CSS) shows everything added so far, each tile with its own "×" to discard
    a mistaken add before it's ever sorted.
  - **Step 2 ("Sort & Tag")** - the *same* `uploadPool`, rendered a second time as an interactive
    grid (`#selectPoolGrid`/`.wizard-pool-tile`). Selecting is click-*and*-drag, not a rectangle
    marquee: `wireSelectPoolTile()` binds `mousedown` (toggles that tile and records the resulting
    mode - select or deselect - as `poolDragState`) and `mouseenter` (while `poolDragState` is set,
    applies that same mode to whatever tile the pointer is now over) - so a plain click is just a
    drag of zero tiles, and dragging across several tiles paints them all to the same state the
    first tile flipped to. A single `document`-level `mouseup` listener (bound once at script init,
    not inside the render function) clears `poolDragState` regardless of where the button was
    released - same "bind drag-lifecycle listeners globally, once" lesson this file's `enlargeImage()`/
    download-button and old upload-dock-minimize-button bugs already taught. `folderSelect`/
    `imageKeywords` (same ids/populate-by-`renderFolders()`/`initTagChipInput()` plumbing as always)
    now sit in this step's own "confirm bar" and apply only to the current selection, not to
    everything in the pool. "Confirm & Queue Selected" (`#poolConfirmBtn`, disabled while nothing's
    selected) pushes `{files, folderValue, keywords}` onto `uploadQueue` (same shape/array
    `renderUploadQueue()`/`startUploadBatch()`/Publish All already expected from the first wizard
    version - none of that plumbing needed to change) and removes just the confirmed items from
    `uploadPool`, revoking their object URLs - "the selected images disappear in the queue," and
    whatever's left in the pool stays for another select/tag/confirm pass. Clicking Next while the
    pool still has un-sorted images shows a `confirm()` warning ("N images haven't been sorted...
    won't be published... Continue anyway?") rather than silently losing them or hard-blocking -
    dismissing it stays on step 2.
  - **Step 3 ("Review & Publish")** - `renderUploadQueue()` now builds a card per queued batch
    (`.upload-queue-item`, grid instead of a single-line list) with a real thumbnail strip
    (`.batch-review-thumb`/`.batch-review-thumbs-strip` - reused from the Edit Tags modal rather
    than inventing another "small square thumbnails in a wrapped row" treatment) generated fresh
    from each batch's `File` objects, plus its folder and tags - "easy to read/see images with
    folder and tags," not just a file count. The old per-batch-selection "Publish Now" instant-
    upload path is gone entirely (there's no longer a "current selection" outside the pool to
    publish directly) - "Publish All" (unchanged `startUploadBatch()` per queued batch) is the only
    way anything actually uploads.
  - **Modal sizing widened again** ("still not convinced... bigger page") - margins tightened 80px
    → 40px total, `max-width` 1400px → 1600px, `min-height` `min(70vh,700px)` → `min(82vh,820px)`.
    The old two-column `.image-modal-grid` (380px form column + flexible preview column) is gone -
    every step now gets the modal's full width (`.wizard-panels`, a plain single flex column),
    since the pool/selection grids and the queue review all read better wide than squeezed next to
    a side column.
  - **Closing the modal (× or backdrop click) still doesn't clear `uploadPool` or `uploadQueue`** -
    extends the reasoning the original Publish Queue feature already established for `uploadQueue`
    alone ("accidentally dismissing the modal mid-batch doesn't lose staged work") to the pool too.
    `resetImageModal()` only clears the transient step 2 selection/tag field and resets the wizard
    step back to 1.
  - **Verified end-to-end via Playwright** against a hand-rolled Firestore/Auth stub (per the
    pattern this file's Testing section documents) plus a mocked `/.netlify/functions/upload`
    response: added images across two separate browse actions (pool count accumulates rather than
    replacing), drag-selected 3 of 8 via real `mouse.down()`/`mouse.move()`/`mouse.up()` (not
    synthetic click sequences), click-toggled one back off and on, confirmed two separate batches
    into the queue (folders/tag values, thumbnail counts, and remaining-pool counts all checked),
    triggered and both dismissed and accepted the "unsorted images" `confirm()`, discarded a pool
    tile via its "×", closed and reopened the modal to confirm the pool survives, and ran Publish
    All through to all 8 upload-dock rows reaching `.upload-success` against the mocked endpoint -
    zero console errors from app code. Screenshots confirm the visual result (selection ring +
    checkmark, disabled-button opacity, overall layout) - same sandbox caveat as everything else
    touching Cloudinary in this repo: the upload endpoint itself was mocked, not exercised against
    real Cloudinary/Firebase.
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
- **`contributors.txt`** (2026-08-01) — one contributor name per line, blank lines ignored. The
  only backing data for the Contributors modal's list (see `index.html`'s own entry above) -
  fetched client-side at runtime, not built into the page. Edit this file to add/remove/reorder
  names; no HTML/JS change needed.

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

**Chrome "save password?" false-trigger fix (2026-07-30)** — reported as the browser offering to
save a password with a *category name* as the username while publishing images, nowhere near the
login modal. Root cause: `#adminEmailInput`/`#adminPasswordInput` are always present in the DOM
(just visually hidden via `.modal-backdrop`'s `opacity: 0; visibility: hidden`, not removed), and
were never wrapped in a `<form>`, so Chrome's save-password heuristic wasn't scoped to just those
two fields - it could pair the (structurally-present) password field with *any* text input typed
elsewhere on the page later, e.g. the "Add Folder" name field. Two fixes, both worth keeping if
this is revisited: (1) the fields are now wrapped in `<form id="adminLoginForm" autocomplete="off">`
- `#adminLoginBtn` had to get an explicit `type="button"` to stop it becoming an implicit submit
button once inside a real `<form>` (which would otherwise reload the page), and the form also has
its own `submit` listener calling `preventDefault()` as a second layer against the browser's
implicit-submit-on-Enter behavior, on top of the existing per-input keydown handlers; (2) the
existing readonly-until-focused / cleared-on-modal-open trick (see below) had a gap - a successful
sign-in cleared the fields' values but never restored `readonly`, so after signing in they sat in
the DOM empty-but-editable for the rest of the admin's session (however long that was), which is
exactly the state that let a later, unrelated text input get treated as loosely "part of the same
form" by Chrome. `attemptAdminSignIn()` now restores `readonly` on success too, closing that
window. Neither fix is a guaranteed 100% stop to this Chrome behavior (there isn't one - sites far
bigger than this one still hit it occasionally), so if it recurs, layering on another mitigation is
more promising than assuming these two didn't work at all.

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

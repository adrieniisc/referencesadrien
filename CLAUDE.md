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

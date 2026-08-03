/**
 * ============================================================================
 * SITE CONFIGURATION — edit this file to customize text, labels, and a few
 * timing values across the whole site, without touching index.html.
 * ============================================================================
 *
 * HOW THIS WORKS
 * A plain JavaScript object (window.SITE_CONFIG) that index.html reads from
 * when the page loads. Every value below has a working default already
 * filled in — the site behaves exactly as before if you never touch this
 * file. Edit a value, save, refresh the page, and the change appears; no
 * build step, no server restart, nothing else to run.
 *
 * SAFE EDITING RULES (read this before changing anything)
 *  - Keep every value wrapped in the same quote marks ("...") it already has.
 *  - If a value ends with a comma, keep the comma. If it doesn't, don't add one.
 *  - Straight quotes only (" and '), not curly/smart quotes - if you write
 *    this in Word or Google Docs and paste it in, it will likely autoconvert
 *    your quotes and break the file. Use a plain text editor (Notepad,
 *    TextEdit's plain-text mode, VS Code, etc.).
 *  - Numbers (timing values) should NOT be in quotes: `2500`, not `"2500"`.
 *  - Lists in [square brackets] (e.g. brand.hoverPhrases, about.paragraphs)
 *    can have items added or removed - just keep each item quoted and
 *    comma-separated, and keep the [ ] brackets around the whole list.
 *  - Some messages contain a `{something}` placeholder, e.g. "Try again in
 *    {seconds}s." - keep the `{...}` part exactly as-is; the site fills in
 *    the real number/word when it displays the message. Don't translate or
 *    remove the part inside the curly braces.
 *  - If you make a mistake that breaks this file's syntax (e.g. a missing
 *    comma or quote), the site will simply ignore this file and fall back to
 *    its own built-in defaults - it will NOT go down. Nothing here is a
 *    single point of failure. If something looks like it stopped applying,
 *    that's the signal to double-check what you just edited.
 *
 * WHAT'S DELIBERATELY *NOT* HERE
 * A few things aren't exposed here on purpose, because editing them here
 * wouldn't actually work the way it looks like it should:
 *  - The admin account (isakovicadrien@gmail.com) - that's controlled by
 *    Firebase Authentication and firestore.rules, not by any text in this
 *    repo. Changing a label here doesn't change who can sign in.
 *  - The 13 color names the auto-tagger uses (red/orange/yellow/green/cyan/
 *    blue/purple/pink/brown/beige/black/white/gray) - the color-detection
 *    code itself is hardcoded to produce exactly those English words, so
 *    renaming them here would make the color filter dots stop matching any
 *    image's actual tags. (Their dot *colors*, i.e. the hex swatches, ARE
 *    safe to edit below.)
 *  - Fine-tuned algorithm thresholds (color-detection sensitivity, image
 *    compression targets, etc.) - these went through many rounds of real
 *    debugging (see CLAUDE.md) and are left as code-only constants so a
 *    text edit here can't accidentally reintroduce an already-fixed bug.
 *  - Firebase/Cloudinary configuration - those are infrastructure, not copy.
 */
window.SITE_CONFIG = {

  // --------------------------------------------------------------------
  // BRAND — the "aReference" wordmark in the top-left of the sidebar.
  // --------------------------------------------------------------------
  brand: {
    // The site's name, typed out letter-by-letter on every page load.
    name: "aReference",
    // Hover the brand for longer than hoverSwapDelayMs and it erases its
    // name and types one of these instead, picked at random. Add, remove,
    // or reword any of these freely - any number of phrases works.
    hoverPhrases: ["Hmmm ?", "What ?", "Go away..", "I see you", "Yes ?", "Hm hmm ?", "And now ?" ],
    // Milliseconds of continuous hovering before the phrase-swap above
    // triggers.
    hoverSwapDelayMs: 500,
    // Milliseconds after the pointer leaves (while a phrase is showing)
    // before it's erased and "aReference" is typed back.
    hoverRevertDelayMs: 2000,
    // Milliseconds the cursor keeps blinking normally after the pointer
    // leaves (not in a swapped-phrase state) before it winds down and hides.
    hoverHideDelayMs: 2000,
    // Milliseconds per character for every typewriter effect the brand
    // uses (initial intro, phrase swap, phrase revert).
    typewriterCharMs: 65,
  },

  // --------------------------------------------------------------------
  // HEADER — the row of buttons next to the search bar (and their
  // mobile-drawer equivalents).
  // --------------------------------------------------------------------
  header: {
    aboutButton: "About",
    submitButton: "Submit",
    contributorsButton: "Contributors",
    mobileSubmitButton: "Submit a Reference",
  },

  // --------------------------------------------------------------------
  // SEARCH BAR
  // --------------------------------------------------------------------
  searchBar: {
    // Shown before anything is typed, and cycled with the gallery's own
    // folder names by the typewriter placeholder effect. Folder names
    // themselves aren't editable here - they come from your actual folders.
    placeholder: "Search images...",
  },

  // --------------------------------------------------------------------
  // ABOUT MODAL — opens from the "About" button.
  // --------------------------------------------------------------------
  about: {
    heading: "Welcome to my website !",
    // Each entry becomes its own paragraph, in order. Add, remove, or
    // reword freely.
    paragraphs: [
      "Here you'll find a bunch of reference images of about anything (filling with new images frequently), for your creative works or any other projects that could benefit from them.",
      "You can browse by folder, search by keywords, and easily download any images for your work, freely, without restrictions and absolutely no copyright or attributions needed.",
      "Feel free to contribute and share your own images/textures with the \"SUBMIT\" button. But please no AI ! :)",
      "Have fun :)",
      "Adrien"
    ],
    socialLinksLabel: "My links :",
    // Each entry needs a url and a label (the label is used for the hover
    // tooltip and screen-reader text - it doesn't have to match the url).
    // The icon shown is picked automatically from the url's domain
    // (artstation.com / linkedin.com / imdb.com get their own icon,
    // anything else gets a generic globe icon) - add or remove entries
    // freely, in any order.
    socialLinks: [
      { url: "https://www.artstation.com/adrienisakovic", label: "ArtStation" },
      { url: "https://adrienisakovic.com/", label: "Website" },
      { url: "https://www.linkedin.com/in/adrienisakovic/", label: "LinkedIn" },
      { url: "https://www.imdb.com/fr/name/nm18521831/", label: "IMDb" }
    ],
  },

  // --------------------------------------------------------------------
  // SUBMIT REFERENCE MODAL — the public "Submit" button's form.
  // --------------------------------------------------------------------
  submitReference: {
    heading: "Submit your images/references",
    description: "Either a google drive link or directly images here, I'll review them and add them as soon as possible (NO AI)",
    linkLabel: "Link (optional):",
    linkPlaceholder: "https://drive.google.com/...",
    imagesLabel: "Images (optional):",
    noFilesSelectedText: "No files selected",
    sendButton: "Send",
    // Shown while the submission is uploading.
    sendingMessage: "Sending...",
    // Shown once the submission succeeds.
    successMessage: "Thanks! Your submission was received.",
    // Shown if neither a link nor an image was provided.
    missingContentMessage: "Please add a link or at least one image.",
    // Shown if something goes wrong - {error} is replaced with the actual
    // error detail.
    errorMessageTemplate: "Something went wrong: {error}",
  },

  // --------------------------------------------------------------------
  // CONTRIBUTORS MODAL
  // --------------------------------------------------------------------
  contributors: {
    heading: "Images contributors",
    emptyMessage: "No contributors listed yet.",
    errorMessage: "Could not load the contributors list.",
  },

  // --------------------------------------------------------------------
  // SIDEBAR — folder list labels and every admin-only action button.
  // --------------------------------------------------------------------
  sidebar: {
    allLabel: "All",
    newThisWeekLabel: "New This Week",
    addFolderButton: "Add Folder",
    addImageButton: "Add Image",
    moveImagesButton: "Move Images",
    editTagsButton: "Edit Tags",
    renameFolderButton: "Rename Folder",
    deleteImagesButton: "Delete Images",
    deleteFolderButton: "Delete Folder",
    findDuplicatesButton: "Find Duplicates",
    retagColorsButton: "Re-tag Colors",
    retagCurrentColorFilterButton: "Re-tag Current Color Filter",
    retagSynonymsButton: "Re-tag Synonyms",
    buildTagSuggestionsIndexButton: "Build Tag Suggestions Index",
    reviewSubmissionsButton: "Review Submissions",
    // Shown on the admin button when signed out / signed in.
    adminLoginButton: "Not for you",
    adminSignOutButton: "SIGN OUT",
  },

  // --------------------------------------------------------------------
  // MODAL TITLES & BODY TEXT — one entry per modal dialog.
  // --------------------------------------------------------------------
  modals: {
    createFolder: {
      title: "Create New",
      nameLabel: "Name:",
      namePlaceholder: "e.g., My Textures",
      parentLabel: "Parent (optional):",
      noParentOption: "No Parent",
      addButton: "Add",
    },
    addImages: {
      title: "Add Images",
      step1Label: "Add Images",
      step2Label: "Sort & Tag",
      step3Label: "Review & Publish",
      dropzoneText: "Drag & drop any images here, or click to browse - mix as many folders/categories as you like, you'll sort them in the next step",
      noImagesAddedYetText: "No images added yet",
      imagesAddedLabel: "Images added",
      step1EmptyText: "Nothing added yet - use the dropzone above.",
      step2HintText: "Click an image, or click-and-drag across several, to select them - then pick a folder and tags below and hit Confirm. Repeat until every image is sorted.",
      step2EmptyText: "Every added image has been sorted - continue to Step 3 to review the queue, or go back to Step 1 to add more.",
      tagsPlaceholder: "Tags (optional) - e.g., red, green",
      selectAllButton: "Select All",
      clearSelectionButton: "Clear Selection",
      suggestTagsButton: "Suggest Tags",
      confirmQueueSelectedButton: "Confirm & Queue Selected",
      step3QueuedLabel: "Queued — not published yet",
      step3EmptyText: "Nothing queued yet - go back to Step 2 and confirm a selection to stage it here.",
      publishAllButton: "Publish All",
      backButton: "← Back",
      nextButton: "Next →",
      // Shown when trying to move to Review with unsorted images left in
      // the pool - {count} is replaced with how many are left, {plural}
      // becomes "has"/"have" automatically.
      unsortedImagesWarningTemplate: "{count} {plural} been sorted into a folder yet and won't be published. Continue to Review anyway?",
    },
    renameFolder: {
      title: "Rename Folder",
      nameLabel: "New Name:",
      namePlaceholder: "Enter new folder name",
      renameButton: "Rename",
    },
    moveImages: {
      title: "Move Images",
      description: "Select destination folder:",
      moveButton: "Move",
    },
    editTags: {
      // The "(N selected)" count after this is added automatically by the
      // site, not from this file - this is just the fixed leading text.
      title: "Edit Tags ",
      description: "If every image below already shares the same tags, this replaces them. Otherwise, whatever you type here is added to each image's own existing tags.",
      tagsPlaceholder: "Edit or add tags...",
      saveAllButton: "Save All",
    },
    duplicateImages: {
      title: "Duplicate Images",
      description: "Images below share the same Cloudinary URL, meaning one upload overwrote another (usually because they had the same original filename). Re-upload the affected files to fix them.",
    },
    reviewSubmissions: {
      title: "Review Submissions",
      description: "Links and images sent in through the public \"Submit\" button. Add whichever images are worth keeping to a folder, then dismiss the submission.",
    },
    adminSignIn: {
      title: "Admin Sign In",
      usernamePlaceholder: "Username",
      passwordPlaceholder: "Password",
      signInButton: "Sign In",
    },
  },

  // --------------------------------------------------------------------
  // GENERIC BUTTONS reused across several modals/panels.
  // --------------------------------------------------------------------
  buttons: {
    cancel: "Cancel",
    download: "Download",
    deleteSelected: "Delete Selected",
    selectDestination: "Select Destination",
    move: "Move",
    editTags: "Edit Tags",
    delete: "Delete",
  },

  // --------------------------------------------------------------------
  // ADMIN LOGIN — messages, and the failed-attempt cooldown.
  // --------------------------------------------------------------------
  admin: {
    enterBothFieldsMessage: "Enter both an email and a password.",
    wrongCredentialsMessage: "Are you really the admin?",
    // {seconds} is replaced with the actual countdown.
    cooldownMessageTemplate: "Too many failed attempts. Try again in {seconds}s.",
    // How many wrong attempts in a row before the cooldown kicks in.
    maxLoginAttempts: 3,
    // How long the cooldown lasts, in milliseconds (60000 = 1 minute).
    cooldownDurationMs: 60000,
  },

  // --------------------------------------------------------------------
  // WRONG-LOGIN MEME FLASH — see memes/manifest.txt to add the actual
  // images. These control the timing of the "flashbang" effect only.
  // --------------------------------------------------------------------
  meme: {
    // How long the solid white flash stays on screen, in milliseconds.
    whiteFlashMs: 200,
    // How long after the white flash clears before the meme image starts
    // fading in, in milliseconds.
    imageAppearDelayMs: 100,
    // Total time the meme stays on screen before auto-hiding, in
    // milliseconds - should comfortably exceed whiteFlashMs +
    // imageAppearDelayMs + the ~2 second fade-in.
    totalDisplayMs: 4000,
  },

  // --------------------------------------------------------------------
  // GALLERY — delete/move/tag-edit confirmations and other action messages.
  // Anywhere you see {count}, it's replaced with an actual number.
  // --------------------------------------------------------------------
  gallery: {
    // Selecting this many images or more before deleting shows an extra,
    // more alarming warning first.
    bulkDeleteWarningThreshold: 20,
    bulkDeleteExtraWarningTemplate: "⚠️ You're about to delete {count} images at once.\n\nThis is a large chunk of the gallery and cannot be undone. Are you SURE you want to continue?",
    confirmDeleteMultipleTemplate: "Are you sure you want to delete {count} image(s)?",
    confirmDeleteSingleMessage: "Delete this image? This cannot be undone.",
    selectImagesToDeleteMessage: "Please select at least one image to move.",
    selectImagesToMoveMessage: "Please select at least one image to move.",
    selectDestinationFolderMessage: "Please select a destination folder.",
    selectImagesToTagMessage: "Please select at least one image to edit tags for.",
    selectAtLeastOneImageMessage: "Select at least one image first.",
    deleteErrorTemplate: "Error deleting images: {error}",
    moveErrorTemplate: "Error moving images: {error}",
    saveTagsErrorTemplate: "Error saving tags: {error}",
    deleteImageErrorTemplate: "Error deleting image: {error}",
  },

  // --------------------------------------------------------------------
  // FOLDERS — Add/Rename/Delete Folder messages.
  // --------------------------------------------------------------------
  folders: {
    enterFolderNameMessage: "Please enter a folder name.",
    folderAlreadyExistsMessage: "This folder already exists.",
    selectFolderToRenameMessage: "Please select a folder to rename.",
    selectFolderToDeleteMessage: "Please select a folder to delete.",
    cannotRenameVirtualFolderMessage: "Cannot rename 'All' or 'New This Week' - they aren't real folders.",
    cannotDeleteVirtualFolderMessage: "Cannot delete 'All' or 'New This Week' - they aren't real folders.",
    // {folder} is replaced with the folder's name.
    confirmDeleteFolderTemplate: "Delete folder \"{folder}\"?\n\nThis only removes the folder itself. Its images are NOT deleted - they'll stay in the gallery, moved to \"All\".",
    deleteFolderErrorTemplate: "Error deleting folder: {error}",
    enterNewFolderNameMessage: "Please enter a new name.",
    noFolderSelectedMessage: "No folder selected.",
    cannotRenameAllMessage: "Cannot rename 'All'.",
  },

  // --------------------------------------------------------------------
  // RE-TAG / ADMIN MAINTENANCE TOOLS — Re-tag Colors, Re-tag Synonyms,
  // Build Tag Suggestions Index, Find Duplicates.
  // --------------------------------------------------------------------
  maintenance: {
    noImagesToRetagMessage: "No images to re-tag.",
    noColorSelectedMessage: "No color selected.",
    // {color} is replaced with the currently-selected color filter's name.
    noImagesForColorTemplate: "No images currently tagged \"{color}\".",
    // {label} is replaced with a description of which images are affected
    // (e.g. "all 42 image(s)" or "the 5 image(s) currently tagged \"red\"").
    confirmRetagColorsTemplate: "Re-run color detection on {label}? This rewrites each image's color tag and may take a while.",
    // {count} is replaced with the number of images.
    confirmRetagSynonymsTemplate: "Recompute synonym and translated tags for all {count} image(s) from their current keywords?",
    confirmBuildTagSuggestionsTemplate: "Compute tag-suggestion embeddings for {count} image(s) that don't have one yet? This loads an ML model in your browser (larger one-time download) and processes one image at a time - for a large batch this can take several minutes, and can be safely re-run later to pick up wherever it left off.",
    allEmbeddingsAlreadyComputedMessage: "Every loaded image already has a tag-suggestion embedding.",
    // Shown once Re-tag Colors / Re-tag Current Color Filter finishes.
    // {total} = how many images it ran against, {changed} = how many
    // actually got a new tag, {failedSuffix} is filled in automatically
    // (either empty, or ", N failed") - leave the {failedSuffix} token
    // exactly where it is even though it might show nothing.
    retagColorsDoneTemplate: "Re-tagged colors for {total} image(s): {changed} changed{failedSuffix}.",
    // Same idea, for Re-tag Synonyms.
    retagSynonymsDoneTemplate: "Re-tagged synonyms/translations for {total} image(s): {changed} changed{failedSuffix}.",
    // Same idea, for Build Tag Suggestions Index. {done} = how many were
    // successfully indexed.
    buildTagSuggestionsDoneTemplate: "Indexed {done} image(s) for tag suggestions{failedSuffix}.",
  },

  // --------------------------------------------------------------------
  // REVIEW SUBMISSIONS PANEL
  // --------------------------------------------------------------------
  reviewSubmissions: {
    chooseFolderFirstMessage: "Choose a folder first.",
    addImageErrorTemplate: "Error adding image: {error}",
    confirmDismissMessage: "Dismiss this submission? This can't be undone.",
    dismissErrorTemplate: "Error dismissing submission: {error}",
    addButton: "Add",
    addingButton: "Adding…",
    addedButton: "Added",
    dismissButton: "Dismiss",
  },

  // --------------------------------------------------------------------
  // UPLOADS — admin upload dock error messages.
  // --------------------------------------------------------------------
  uploads: {
    needAdminAccessMessage: "You need admin access to upload files.",
    addAtLeastOneImageMessage: "Please add at least one image first.",
  },

  // --------------------------------------------------------------------
  // COLOR FILTER SWATCH COLORS — safe to restyle the dots' actual colors
  // (any valid CSS color works, e.g. "#ff0000" or "rebeccapurple"). The
  // 13 keys on the left (black, white, gray, ...) must stay exactly as
  // they are - see the big warning at the top of this file for why - but
  // the hex value and the displayed title on the right of each line are
  // both freely editable.
  // --------------------------------------------------------------------
  colorSwatches: {
    black:  { hex: "#1a1a1a", title: "Black" },
    white:  { hex: "#f5f5f0", title: "White" },
    gray:   { hex: "#8e8e93", title: "Gray" },
    brown:  { hex: "#8b5e34", title: "Brown" },
    beige:  { hex: "#d9c7a3", title: "Beige" },
    red:    { hex: "#e5484d", title: "Red" },
    orange: { hex: "#f2994a", title: "Orange" },
    yellow: { hex: "#f0c419", title: "Yellow" },
    green:  { hex: "#34a853", title: "Green" },
    cyan:   { hex: "#17c3b2", title: "Cyan" },
    blue:   { hex: "#3b82f6", title: "Blue" },
    purple: { hex: "#8b5cf6", title: "Purple" },
    pink:   { hex: "#ec4899", title: "Pink" },
  },
};

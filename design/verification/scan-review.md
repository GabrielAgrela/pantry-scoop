# Ingredient scan review

Verified on 2026-10-04 using the Codex built-in Browser with the actual HTTP application and an isolated in-memory database (`design/browser-preview.mjs`, port 3211). Tests use fake authentication and AI; production pantry data was not changed.

Checked ingredient editing and save, deletion with Undo, selection counts, searching duplicate matches in the pantry and current scan, choosing and removing a match, clearing dependent matches when a scan target is deselected, persisted duplicate choices after reload, and final confirmation. Matching Greek yogurt to the existing out-of-stock Milk entry restocked Milk without creating Greek yogurt or replacing Milk's details; Strawberries was added once. No browser console errors were reported.

Inspected light and dark phone rendering at 390 px and narrow phone rendering at 320 px. The review has no horizontal overflow and action controls are at least 44 px high. Browser computed styles confirmed `review-scoop-away` on removal and `review-draft-return` on undo. Edit, match and selection each have their own brief action animation; reduced-motion CSS and JS suppress these motions.

`npm run check` passed typechecking and all 190 tests. New HTTP tests verify pantry and same-scan duplicate matching, metadata preservation, idempotent retries and rejection of invalid or other-account targets before writes. Frontend syntax and `git diff --check` passed. The older supplemental jsdom script completed its assertions but reported an unrelated missing requestAnimationFrame shim in recipe detail; it is not visual evidence.

The automatic deployment published the change to https://pantry.gabruel.xyz/. Downloaded scan-review.js, stock.js and styles.css matched source; the deployed scan service includes duplicate matching and scan preview food emojis. The running container is healthy. Rollback image retained as pantry-scoop:before-scan-review-20261004.

Screenshot: scan-review-mobile.png (390 px, light theme, selected pantry duplicate).

## Correcting automatic matches (2026-10-04)

Each automatically matched ingredient now has “Not duplicate · edit name”. Its editor requires a distinct name, and saving moves the item into the selected review list with an unlink animation. The original pantry entry is preserved. The heading counts all detected ingredients, including automatic matches, and the automatic-match count updates as corrections move into the review list. When the scan contains only automatic matches, that section opens immediately.

Built-in Browser checks on an isolated preview at localhost:3213 verified unchanged-name validation, renaming Tomatoes to Cherry tomatoes, canceling a Basil edit, persistence after reload, and confirmation that both Tomatoes and Cherry tomatoes remained in the pantry. Computed styles confirmed the review-unlink animation. Inspected 390 px and 320 px phone layouts; controls are 44 px high with no horizontal overflow. No browser errors were recorded. Screenshot: not-duplicate-mobile.png.

Typechecking and all 188 current tests passed, including new HTTP tests for separating an automatic match, preserving the original, retry safety, distinct-name validation and rejection of unknown scan-match ids. The automatic deployment is healthy; downloaded scan-review.js, stock.js and styles.css match source, and the deployed backend supports correction of automatic matches. Existing saved scan previews use their pantry ids as stable review identities, so this applies to scans already awaiting review.

## Suggested-match styling and motion (2026-10-04)

Automatic matches now appear in an open “Possible duplicates” section with an explanation that the scan thinks they match the pantry. Each row has “Detected match”, paired food stickers with a question mark, and a compact outlined “Not duplicate” button. The correction editor illustrates this photo and the pantry as two stickers that hop apart around a snapping link. Saving uses a soft food landing and a fading twin, followed by a “Separate ingredient” label. Animations run once and respect reduced-motion preferences.

Inspected Azeite and Óleo alimentar in the built-in Browser at 390 px and 320 px, in light and dark themes. The compact controls are at least 44 px high with no horizontal overflow. Computed styles verified the photo/pantry hops, link snap, shelf landing and twin goodbye, and confirmed the effect classes clear after completion. Final confirmation on an isolated preview at localhost:3216 added Azeite Cinco Soldos while preserving Azeite. The first preview process on port 3213 was externally terminated (SIGTERM); it was restarted on 3216 before the final end-to-end check.

Typechecking and all 188 tests passed. Frontend syntax and whitespace checks passed. The automatic deployment is healthy and the published scan-review.js, stock.js and styles.css matched source. Screenshot: duplicate-suggestions-mobile.png.

## Remove misleading comparison artwork (2026-10-04)

Removed the correction editor's two identical emoji panels labeled “This photo” and “Your pantry”, since they did not compare actual source images. The editor now opens directly to the distinct-name field. Its small pencil icon performs a brief writing flourish, and the saved “Separate ingredient” label stamps into place. Removed the duplicate emoji echo from the saved row and the unused comparison artwork styles.

The built-in Browser verified the 390 px editor, no horizontal overflow at 320 px, the pencil and label-stamp animation names, and successful addition of Azeite Cinco Soldos while preserving Azeite. No comparison banner or echo remains in the DOM. Screenshot: rename-editor-mobile.png. Frontend syntax and whitespace checks passed; the automatic deployment's checks passed and the healthy deployment's scan-review.js and styles.css matched source.

## Scan-ready card (2026-10-04)

Replaced the cramped status text and inset Review scan button with one full-width review card. A camera icon, bold Review your scan heading, ingredient count and chevron make the whole card an accessible action. Removed the mobile zero-side-padding override; failed scan notifications retain normal padding.

Built-in Browser checks at 390 px and 320 px verified a 72 px card, no card overflow, light and dark rendering, and opening the review dialog by tapping the card. No console errors. Screenshot: scan-ready-card-mobile.jpg. Frontend syntax and whitespace checks passed; automatic deployment checks passed and the container is healthy. Published stock.js and styles.css match source.

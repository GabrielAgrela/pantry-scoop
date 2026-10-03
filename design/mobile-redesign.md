# Pantry Scoop mobile redesign

Implemented and deployed on 2026-10-03 at https://pantry.gabruel.xyz/ from the ImageGen reference in `mobile-redesign-concept.png`. The original prompt is `mobile-redesign-prompt.txt`; new recipe thumbnail prompts are in `recipe-photo-prompts.json`.

## Implementation

The pantry uses In stock / To restock filters, combined Produce and Dairy & eggs shelves, direct stock toggles, separate edit controls, and fixed Scan groceries / Add actions. Mobile search opens from the header and redundant headings/counts are visually hidden while retained for accessibility. Long inventory lists scroll within the pantry. The duplicate cooking link and persistent completed scan outcome were removed. At the same 390×680 usable viewport, the inventory area increased from 238px to 426px (79%). Desktop retains visible search and headings.

Scan detection now creates a durable review without changing inventory. Users can select candidates, edit names/categories/notes, return to the pantry, reload, or append photos up to six. Confirmation validates the complete selection and atomically saves stock and the job outcome. Confirmation retries return the original outcome. Photo previews and pending edits stay on the current device; server jobs persist the detected ingredients, not image contents.

Recipes use a compact craving / dish / servings form, collapsed secondary options, result cards, bookmarks, a saved collection and complete recipe detail sheets. The two ImageGen thumbnails are decorative illustrations for matching pasta and tomato/egg recipe families; recipe generation does not produce photographs. Other dishes use the existing bowl icon.

Recipe generation now has a persistent animated progress notice above the bottom navigation. It stays visible across tabs and reloads until completion or failure, without ordinary feedback toasts replacing it. Availability is recalculated from current owner inventory on saved-recipe and completed-job responses, including older generated results. Stock mutations refresh both saved and unsaved cards, even when a different recipe request is running. Names use existing case/accent/whitespace normalization; recipe snapshots are preserved.

Kitchen preferences use appliance cards, separate edit sheets, compact default rows, dietary text and a fixed Save preferences button. Appliance edits preserve unsaved defaults.

## Verification

- `npm run check`: typecheck and 160 passing tests, including current saved/generated recipe availability, owner isolation, stock changes during generation, saving stale results, staged scans, edited restocks, validation before writes, photo merging, idempotent retries and transaction rollback.
- Frontend JavaScript syntax checks and `git diff --check` passed.
- `PANTRY_UI_NODE_MODULES=/tmp/pantry-scoop-ui-check node design/verify-ui.mjs`: supplementary pantry, recipe, persistent progress, kitchen and sign-out interaction checks passed using temporary jsdom dependencies.
- Built-in Browser: authenticated real routes with in-memory SQLite and fake AI in `mobile-preview.ts`; tested search, filtering, one-tap restock, manual addition, edits, recipe bookmarks / collection / details, appliance and default persistence, photo upload, review selection / edits / reload / back / appending / confirmation, and corrected restock notes. No production user data was changed for these checks.
- Rendered at 390×844 and 320×680; no horizontal overflow. The pantry controls measured at least 44px high. Desktop pantry inspected at 1280×900. Browser console had no errors or warnings.
- Follow-up built-in Browser verification used 390×680 and 320×640 usable viewports: compact pantry, disclosed search, empty completed scan banner, persistent animated recipe progress across tabs/reload, and coconut availability updating in both directions for saved/generated recipes. Existing unsaved results updated during a separate running request. Ordinary feedback and progress notices had a 16px gap instead of overlapping.
- Live public signed-out page inspected at 390×844. All 29 deployed frontend files and 58 backend source files matched the worktree byte for byte. Docker container was healthy; the deployment watcher was restored and reported successful publication.

## Captures

`design/screenshots/mobile-pantry.png`, `mobile-recipes.png`, `mobile-kitchen.png`, and `mobile-scan-review.png` show the implemented screens. `live-mobile-signed-out.png` records the deployed public page. Review photo thumbnails are test uploads; inventory and account content will reflect each real user. The browser does not draw the mockup’s illustrative OS status bar or home indicator.

Latest compact layout and progress captures: `mobile-pantry-compact.png`, `recipe-progress-on-pantry.png`, and `recipe-progress-current-requirements.png` in the screenshots directory. `coconut-recipe-current-stock.png` verifies the missing coconut requirement in the detail sheet.

The follow-up was published on 2026-10-03. The watcher reran all checks and reported a healthy deployment. All 29 public frontend files and 58 container backend source files matched the workspace; `/api/auth/config` returned 200. The built-in Browser inspected the live signed-out page at 390×680, captured in `live-mobile-follow-up.png`; both local and public Browser consoles reported no errors or warnings. Authenticated behavior was tested on isolated fixture accounts, without changing production user data.

## Commit handoff verification (2026-10-03)

Type checking and all 167 unit/integration tests pass. The supplemental UI fixture now includes dish types, matching the current kitchen profile contract; its pantry, recipe options, progress, kitchen loading/retry, settings and sign-out checks pass. All 19 frontend JavaScript files and the deployment watcher pass syntax checks, and the systemd watcher unit validates.

Fresh built-in Browser verification could not run during this handoff. Host-local chat attachment succeeded, but fresh in-app tab creation reported `Browser is not available: iab`. The bundled Browser bootstrap also failed because it references a missing `browser/26.928.20755/scripts/browser-service.mjs`. The captures and Browser results above are evidence from the earlier implementation sessions, not a fresh rendering check for this handoff.

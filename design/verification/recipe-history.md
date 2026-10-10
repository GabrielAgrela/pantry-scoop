# Saved recipes and idea history — 5 October 2026

Recipes now exposes Saved recipes and Ideas history as keyboard-accessible tabs. Idea history groups completed batches newest first with dates and loads ten batches at a time. Completed recipe jobs are retained through routine job cleanup; running jobs are also preserved. Existing batches that were deleted before this update cannot be recovered by it.

Ready notifications open the exact batch in Ideas history, focus its heading and scroll only the Recipes page vertically. A New badge identifies the newest unseen batch, with a four-second outline on opening. Seen job ids survive browser reloads. Navigation already pointing away from Recipes keeps the ready notice instead of acknowledging it as an on-page result. Re-rendering preserves the focused batch heading and expires the outline on the current element.

Verification:
- `npm run check`: type checking and 240 tests passed, including history retention beyond 30 later jobs, running-job preservation, cursor pagination, account isolation, failed-job exclusion, invalid cursor rejection and current pantry stock in history responses.
- `design/verify-ui.mjs`: all interaction checks passed, including saved recipes, retaining earlier batches, showing one new marker and notification navigation/focus.
- Codex built-in Browser, isolated in-memory fake AI/authentication server: mobile 390×844 and desktop 1280×900 rendered correctly. Saved recipes and history survived reloads. Twelve seeded batches paged from ten to twelve with twelve unique ids. A newly generated batch finished on Pantry; its ready notice survived reload and switched from Saved recipes to Ideas history. The focused heading belonged to the newest batch, with its top at 75.66px against the page top of 64px. One New marker was present. No console warnings/errors were reported. `recipe-history-mobile.jpg` captures the focused batch and earlier history beneath it.
- Published with `docker-compose up -d --build pantry-scoop`; no jobs were running before deployment. Public recipes.js, api.js and styles.css matched local bytes. The public login page was inspected in the built-in Browser; signed-in interactions were verified on the isolated QA server.

No external AI requests or real account data changes were needed for QA.

## Follow-up: Ideas, persistent notices and search

The collection is now named Ideas. Recipe completion always uses a ready notice, including on the Recipes page. It has no dismiss control and is acknowledged only by tapping its open action; page visits, opening individual recipes, searching and reloads do not acknowledge it. Sign-out removes account UI. Opening the notice clears search, selects Ideas and focuses the exact batch.

A search field filters saved recipes immediately and searches completed ideas across the entire retained account history, including unloaded batches. Names, descriptions, dish types and ingredients match case- and accent-insensitively. Search results paginate by matching batches. Input focus survives rendering, clearing restores loaded ideas, and late responses are ignored.

Type checking and all 241 tests passed. Supplemental interaction checks passed, including persistence through page visits/search, hidden dismiss control, search-clear-on-open, saved ingredient matching, older ideas and stale response protection. The built-in Browser confirmed the renamed tabs, saved search, an older idea outside the first ten batches, notice persistence through search and reload, exact-batch focus after tapping, and no notice after reloading an acknowledged batch. Mobile proof is in ideas-search-mobile.jpg. Desktop QA also generated a new batch on Recipes and confirmed its persistent notice while searching for lemon. The original temporary QA server terminated during that check; a restarted PTY server completed desktop verification. Fake AI and in-memory data were used throughout.

## Latest-generation default (2026-10-05)

Ideas now renders only the newest generation by default, with Show older ideas / Hide older ideas directly below it. Search still covers all generations. Built-in Browser verified at 390×844 and 1280×900: expand/hide, pagination through all 12 seeded batches, search for collapsed older ideas, and a new generation collapsing history while retaining old batches. No console errors. UI interaction checks pass; screenshots: ideas-latest-mobile.png and ideas-latest-desktop.png.

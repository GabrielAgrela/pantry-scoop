# Pantry Scoop UI verification

Verified on 2026-10-03 with the Codex built-in Browser. The SSH host's desktop now shares the existing app-server, so Browser inspection works without user access to the host desktop.

The signed-in checks used `design/browser-preview.mjs` on localhost:3211: the actual HTTP routes, application services and an isolated in-memory SQLite database, with fake authentication and AI responses. No production account data was changed during browser testing.

Checked pantry grouping, food emojis, manual addition, stock toggles, search and no-match state, sorting, ingredient editing, scan source selection, detected ingredient editing and scan confirmation. Checked recipe composer, dish picker, expanded options, recipe generation and failure recovery, saved collection, recipe sheet, current availability, methods, tips, nutrition and the sticky save action. Checked kitchen appliances, defaults editing and saving, account menu, QR dialog, welcome dialog and sign-in error recovery. Desktop, 390px mobile and 320px mobile layouts were inspected, including light and dark recipe sheets.

Complementary checks: `npm run check` passed all 172 tests; `design/verify-ui.mjs` passed its interaction checks; frontend JavaScript syntax and `git diff --check` passed. The Docker deployment is healthy, all 34 public assets matched local files, and all 45 existing production ingredient rows had an emoji.

The public sign-in screen was inspected separately at https://pantry.gabruel.xyz/. Actual ChatGPT authorization, external AI calls and physical camera capture were not exercised by this visual QA.

Screenshots:

- `recipe-mobile-light.png`: redesigned mobile recipe detail.
- `recipe-mobile-dark.png`: dark recipe detail.
- `pantry-mobile-light.png`: scanned ingredients after confirmation.
- `public-login-mobile.png`: deployed public mobile sign-in screen.

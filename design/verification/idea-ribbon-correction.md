# Ribbon shape and card layout correction

Verified 2026-10-04 in the Codex built-in Browser using the actual frontend and an isolated in-memory preview on 127.0.0.2:3215. The separate loopback host isolates the QA session cookie from other localhost tasks.

Ribbons now have notched tails, show chef hats or a flavour symbol without visible text, and retain accessible names. Difficulty choices and ribbons share green/easy, yellow/medium and pink/hard palettes. Flavour choices and ribbons share pink/heart, green/tulip and lavender/rocket palettes. Browser computed colours matched between the relevant options and ribbons.

Removed all padding added for ribbons from the card, artwork and copy. Ribbons are absolute overlays. Moved the save heart to the lower corner; long yield text wraps together with the clock. Checked the exact long title from the user's screenshot. The coloured artwork starts and ends one pixel inside the card border, with no top gap; opening-button top padding is zero and copy spacing remains its existing 15px. Checked desktop, 390px and 320px layouts; no horizontal overflow at either mobile width. Radio selection and option summaries worked.

Screenshots: idea-ribbons-compact-mobile.png and idea-ribbon-options-mobile.png. TypeScript and 232 tests passed during this correction; final modified frontend modules passed syntax checks and git diff passed whitespace checks. The deployment is healthy and its four affected public frontend assets match local files byte for byte.

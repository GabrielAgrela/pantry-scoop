# Pantry Scoop visual redesign

The redesign uses ivory surfaces, forest olive accents, DM Sans interface text and delicate borders. Cormorant Garamond is reserved for the wordmark and sign-in presentation. The ImageGen concept below established the original visual direction; the final signed-in screens are compact workspaces without introductory photographs or promotional banners. Fonts are self-hosted with their OFL licenses. No remote font or image service is needed at runtime.

The four screens are sign-in, My pantry, Recipes and My kitchen. On desktop the navigation sits in the header; on small screens it stays within reach at the bottom. Pantry counts show in-stock ingredients and ingredients to restock. The app does not track expiration dates or quantities.

Inventory opens directly to search, category/restock filters, sorting, manual addition and photo scanning. Ingredient rows provide a one-tap stock toggle and a separate edit action. Recipe forms show the craving, dish and servings first; secondary options use a closed native disclosure and keep existing persisted preferences. Kitchen settings provide appliance limits and dietary defaults, and retain unsaved edits when switching sections. Existing ChatGPT sign-in, QR pairing, manual address completion, account management and background jobs are preserved. Hash navigation supports browser history and resets the view to the top.

Mobile CSS uses a single-column ingredient list, 44px minimum touch targets, 16px form controls and dialogs constrained to the viewport. The sign-in photo is hidden on small screens. These are implemented layout rules, not evidence of rendered mobile verification.

## Validation

The compact UX revision was deployed to https://pantry.gabruel.xyz/ on 2026-10-02 by rebuilding and recreating the existing Compose service. All 25 files in `public/` were downloaded over HTTPS and compared byte for byte with the worktree; every comparison matched. The new container is healthy, still mounted to the same `data/` directory, and its image is `sha256:7056aba0d7014f279bed82a71d11c4b300be886b1714ac50322bbbb1ebd46238`.

Rollback image for this revision: `pantry-scoop:before-compact-ux-20261002` (`sha256:16e61902326288acf491d3669d39976f7b86bbd3982cdee8b95ed0eda351824a`). Pre-deployment database snapshot: `data/backups/pre-compact-ux-2026-10-02T20-47-54-111Z.db`. The earlier original-release rollback remains `pantry-scoop:before-redesign-20261002`. The initial preview on port 3211 was not the container serving the public domain; rebuilding the public container published the changes.

Type checking and all 154 existing tests passed. After the callback error page change, the 26 HTTP integration tests passed again. JavaScript syntax and diff whitespace checks passed. The development preview on port 3211 serves the new HTML, WebP images and local WOFF2 fonts successfully under the existing content security policy.

The supplemental `design/verify-ui.mjs` checks counts, category and text filtering, stable filter focus, sorting, manual addition, safe ingredient text, one-tap stock updates, scan/upload input activation, valid/invalid hash navigation, view scroll reset, collapsed recipe options, recipe request options, save/delete/re-save, appliance editing, preference saving, logout, host sign-in, remote QR instructions, address completion and consent. It uses jsdom with fake API responses and native dialog methods stubbed; it does not verify browser rendering, camera capture, OAuth against OpenAI, native dialog focus or touch behavior. All interaction checks passed for the compact revision, and type checking plus all 154 existing tests passed before deployment.

To run it without adding a project dependency:

```bash
npm install --prefix /tmp/pantry-scoop-ui-check --no-audit --no-fund --no-package-lock jsdom
NODE_PATH=/tmp/pantry-scoop-ui-check/node_modules node --disable-warning=ExperimentalWarning design/verify-ui.mjs
```

Built-in Browser verification is blocked in this session. Host-local chat attachment was attempted and the Browser opening was queued, but tool discovery exposed no Browser control or Node execution tool. Desktop and mobile visual layout and native interactions remain unverified.

## ImageGen assets

Created with the built-in ImageGen tool. The design concept is saved as `design/imagegen-concept.webp`. The final photography is resized and encoded as WebP for delivery in `public/assets/`.

### Design concept prompt

Use case: ui-mockup. Asset type: high fidelity website design concept board. Reimagine Pantry Scoop, a personal pantry and recipe app, across four screens in one polished editorial design board: sign-in landing, My Pantry inventory, Recipe ideas, and My Kitchen preferences. Warm ivory #f8f6ef background, forest olive #314b36 navigation and buttons, citrus yellow highlights, fine charcoal text, elegant large editorial serif headings paired with clean sans body, thin delicate borders and substantial whitespace. Desktop horizontal header with small custom pantry jar mark and wordmark Pantry Scoop, three understated navigation tabs My pantry, Recipes, My kitchen, account avatar. Inventory page has header 'A little pantry. Endless possibilities.', compact stats, a wide beautiful photo feature of fresh ingredients in a sunlit rustic kitchen with 'Good food starts with what you have.', camera Scan your pantry action, search, pill category filters and neat ingredient rows with green stock dots. Recipes screen has clear labeled recipe generator on left and inspiring food photography right, saved recipe cards below. Kitchen has appliance cards and thoughtful labeled dietary defaults. Sign-in has big editorial food photograph and warm welcoming headline 'Your pantry, full of possibilities.' Four distinct credible web UI mockups on a single landscape presentation board with restrained typography and readable labels. Show charming food imagery, no emoji icons, no gradients, no purple, no excessive round bubbly cards. Professional art direction, boutique food journal meets useful kitchen companion.

### pantry

Output: `public/assets/pantry-editorial.webp`

Use case: photorealistic-natural. Asset type: original editorial hero photograph for Pantry Scoop, a personal pantry cooking website. A warm sunlit Mediterranean kitchen counter still life: ceramic bowl of lemons with leafy stems, ripe tomatoes, garlic, basil, clear olive oil bottle, rustic loaf, linen towel on softly weathered wooden table, plaster ivory wall and subtle window light. Real imperfect ingredients, magazine food photography, quiet slow living. Landscape 3:2 composition, main ingredients centered and right with some space left, no people, no lettering, no typography, no watermark, not a website mockup. Forest olive, golden citrus, warm ivory. Beautiful tactile ceramics and natural shadows.

### recipes

Output: `public/assets/recipe-editorial.webp`

Use case: photorealistic-natural. Asset type: original editorial food photograph for the recipe page of Pantry Scoop. A delicious bowl of homemade lemon tomato basil pasta with freshly grated parmesan, on warm ivory ceramic, a fork and natural linen on a rustic table, lemons and basil nearby. Overhead with slight angle, warm natural late morning sunlight, realistic appetizing textures, sophisticated European food magazine photography. Landscape 3:2, bowl fills center-right, subtle olive green and golden tones. No letters, no text, no watermark, no people, not a website mockup.

### kitchen

Output: `public/assets/kitchen-editorial.webp`

Use case: photorealistic-natural. Asset type: original editorial banner for a personal kitchen preferences webpage. Quiet warmly sunlit kitchen still life of olive green ceramic utensil crock with wooden spoons and whisk, stack of imperfect ivory ceramic plates, worn wooden cutting board, small herb plant. Natural cream plaster wall and oak countertop. Landscape 3:2 composition, elegant sparse food journal photography with textured materials, soft shadows, muted earthy tones. No text, no lettering, no people, no watermark, not a website mockup.

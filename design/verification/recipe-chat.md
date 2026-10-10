# Recipe mascot chat — 2026-10-06

- Added an animated, blinking and waving Scoop button to the lower-right corner of the recipe content, visible across Overview, Ingredients and Method. It floats above the footer, as marked in the user’s follow-up screenshot, rather than occupying the header or a footer flex item.
- Opens a recipe-specific conversation with ingredient swap, step explanation and portion prompts. Supports follow-ups, an animated thinking state, inline retry errors and returning to the recipe.
- Uses the existing per-user selected AI model and daily allowance. Supplies the recipe, current pantry, kitchen preferences and up to ten previous exchanges. Renders answers as text.
- Overview now uses full-width yield text, compact horizontal metadata, and a bounded note with a full-note reader. Equipment opens a complete list. Footer retains its three original controls.
- Validation: TypeScript, all 290 tests, frontend syntax and git diff whitespace checks pass. Includes recipe chat request validation, unauthenticated access, user pantry isolation, follow-up context, model response validation and failure/retry tests.
- The existing autodeploy service published the change. Public recipe-chat.js, recipes.js and styles.css matched worktree hashes; the container is healthy, and unauthenticated POST /api/recipes/ask returns 401.
- Built-in Browser verification recovered after restarting the host desktop service, attaching this task, and refreshing the Browser binding. Tested a local isolated fixture matching the supplied long aioli recipe at 393 × 685, 360 × 640 and 360 × 560. Overview client/scroll heights were respectively 490/490, 445/445 and 365/365; nutrition client/scroll heights were 211/211, 176/176 and 154/154. All footer controls fit inside their container, and the mascot was in the header.
- Keyboard interactions verified opening the full note, full equipment list, and recipe chat; submitting a question displayed the thinking state and the fixture AI response; closing returned to the recipe. The local AI response was a test double, while backend behavior was covered by the test suite.
- Pointer dispatch and screenshot capture still time out in the built-in Browser. Accessibility state, interaction and DOM geometry were checked; no captured visual QA or screenshot is claimed.

## Corner placement correction — 2026-10-07

- Anchored Scoop to a relative content wrapper, separate from the horizontal page scroller and footer controls. Reserved bottom clearance so the last ingredient or method step can scroll above it.
- Bounded long titles to two visible lines on short phone screens, with the complete title retained in accessibility text and the full-note dialog. Compact equipment names open the complete equipment list.
- Built-in Browser: the aioli Overview remained scroll-free at 393 × 685, 360 × 640 and 360 × 560 (client height equals scroll height), with approximately 5 px between the nutrition panel and the companion. The long hazelnut title was also verified scroll-free at 360 × 560 after fixing a wrapped metadata row. Later viewport changes targeted a stale selected tab, so wider final hazelnut checks are not claimed.
- The five long peach Method steps from the supplied screenshot were tested at 393 × 685. Keyboard End scrolled the method to its maximum 140 px, leaving approximately 13 px between the final step and Scoop. Opening the corner button displayed the recipe-specific chat, and Back to recipe returned correctly.
- Browser reconnection required host desktop restart and task attachment; the desktop took about a minute to finish attaching. Screenshot capture still timed out, so verification used accessibility state, keyboard interaction and read-only rendered DOM measurements.
- All 290 tests passed; final frontend JavaScript syntax and whitespace checks passed.

# Recipe idea reveal — 4 October 2026

Newly generated ideas use a 780ms card entrance staggered by 110ms, a 640ms dish serve animation and two short sparkle animations. The reveal runs on successful job completion, including a job already completed in the submit response. Existing and saved recipes render normally. Animation classes are removed after completion. Reduced-motion preferences skip the reveal in JavaScript and suppress CSS animations.

Verified with the Codex built-in Browser using the isolated in-memory QA server at localhost:3211. Observed `idea-arrive` on all three fresh cards with delays 0ms, 110ms and 220ms. Observed opacity 1, transform none and no fresh class after settlement. Saved collection cards had no animation; opening a saved recipe displayed the working detail sheet. Inspected the mobile rendered result at 390×844. `idea-reveal-mobile.jpg` shows the settled layout.

The public recipe module matched the current local file by SHA-256 and the public stylesheet contained all three reveal keyframes and selectors. The existing deployment was already serving these changes when checked; this session did not rebuild or recreate it.

Frontend syntax and `git diff --check` passed. Existing UI interaction checks passed using the established JSDOM dependency, Node’s TypeScript transform flag (required by concurrent backend changes), and a requestAnimationFrame stub for the DOM-only test environment. No runtime fallback or dependency was introduced. Browser checks used fake AI/authentication and did not exercise an external AI request.

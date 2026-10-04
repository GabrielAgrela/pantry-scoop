# Idea ribbons and flavour preferences

Implemented 2026-10-04. New AI suggestions require independent difficulty (`easy`, `medium`, `hard`) and creativity (`familiar`, `creative`, `adventurous`) labels. The flavour radio group also supports unrestricted `any`. Cooking difficulty and flavour familiarity are separate; olive oil ice cream is explicitly adventurous. Older saved recipes remain readable without inventing labels.

Built-in Browser checks used the isolated in-memory preview. Verified flavour selection, independent Easy + Adventurous selection, native radio keyboard selection, option-summary updates, generation, three levels of card ribbons, recipe-detail labels, saving and saved-card labels. Checked desktop, 390px and 320px layouts. The 320px check revealed the longest option needed more space; changed small-screen choices to a two-by-two grid.

The final two-by-two layout could not be rechecked: Browser mouse, keyboard and viewport mutations silently stopped affecting state. Retried with fresh tabs, host-local task attachment, runtime reconnection and a dedicated QA port. No application fallback was added. `idea-ribbons-mobile.png` captures the previously verified saved recipe with independent Easy and Adventurous labels.

Validation: TypeScript, all 229 tests, syntax checks for changed frontend modules, and git diff whitespace checks passed. The deployed container is healthy; the four affected public assets match the worktree byte for byte on localhost and the public domain. AI responses were faked during visual checks; actual provider generation was not exercised.

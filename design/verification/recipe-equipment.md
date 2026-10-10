# Recipe equipment validation — 2026-10-07

- Removed the machine-specific Ice cream description from new-kitchen defaults. Migration 13 replaces only the exact inherited description in stored profiles and legacy settings; custom descriptions and stored recipes are preserved.
- Generation schema permits only available appliances, excluding the request's avoided choices. Server-side validation independently rejects unknown names and omitted required choices, including providers without enforced schemas.
- An additional structured AI review reads methods and tips for undeclared, unavailable, implicitly required or unused required appliances. Failed or malformed review results prevent the whole batch from being returned. No automatic substitution or regeneration was added.
- The review is probabilistic, rather than a proof of every instruction's correctness. It adds one AI call per batch, using the same configured provider and daily-request allowance as generation.
- All 298 tests and TypeScript checks passed. Coverage includes the reported sorbet, rejected declared equipment, avoided and required choices, valid manual freezing, failed review responses, and migration preservation/idempotence.
- Live DeepSeek verification used synthetic recipes and a kitchen with only a blender and freezer. It rejected English and Portuguese methods using an ice cream machine, accepted a manual method in the same batch, and accepted that manual method by itself.
- Codex built-in Browser verification on an isolated in-memory server with scripted provider responses: corrected dish description visible; invalid sorbet yielded an equipment error and no idea card; valid sorbet yielded a card and the rendered manual-freezing method. Accessibility, keyboard interactions and screenshots passed. Screenshot: recipe-equipment-method.jpg.
- Auto-deploy completed successfully. The healthy container's recipe generation source hash matched the worktree; production database version is 13 and no stored kitchen retains the inherited machine-specific description.
- Existing recipe history is not rewritten. Generate a new recipe to use the new checks.

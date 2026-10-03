# Kitchen profile loading fix

On 2026-10-03 the user supplied a mobile screenshot showing no appliances, blank cooking defaults and an enabled Save preferences button. A read-only production database check found the existing seven appliances, saved defaults, 17 ingredients and one saved recipe intact. The production volume was still bound to the original data directory. No data restoration or database modification was needed.

The kitchen view initially rendered its empty form before its first profile fetch completed. A failed fetch left that form available after a temporary error toast disappeared. This reproduces the screenshot's unfilled state; the exact cause of the phone's unfinished profile load was not independently observed.

The view now keeps the form and settings hidden until its saved profile loads, with an explicit animated loading state. Save remains disabled and initial-form submissions are ignored. A failed fetch produces a persistent error and retry action. Pending requests are shared across activations, and a late refresh does not replace unsaved edits.

Verification: supplementary UI checks cover first-load failure, pending retry, prevented blank-form saves, request deduplication, recovery of saved defaults and preservation of edits during a late response. Built-in Browser checks at 390×680 exercised a real 15-second delayed profile endpoint and a scripted failed request on isolated accounts, then verified retry restored appliances and defaults. Captures are `screenshots/kitchen-loading.png`, `kitchen-load-error.png` and `kitchen-loaded-after-retry.png`. Production account data was inspected read-only.

Published on 2026-10-03 at 16:11 Madeira time. The deployment watcher reran frontend syntax, typecheck and all 160 backend tests, then reported a healthy container. The public profile script and stylesheet matched the workspace. A second read-only check confirmed the same seven stored appliances, 17 ingredients and one saved recipe. The public signed-out page loaded in the built-in Browser without console warnings/errors; authenticated behavior was verified with isolated fixture accounts.

# Shared web / Android port — 2026-10-05

- `public/` remains the only source of feature screens and styles. The packaged JS/CSS copies
  were compared byte for byte with their web sources.
- `npm run check`: typecheck and 252 tests passed. These include Google/ChatGPT browser handoff,
  wrong-verifier rejection, expiry, replay prevention, CSRF protection and account linking when
  the browser has a different account, and refusal to approve a pre-existing browser session before the requested provider completes. `npm audit`: zero vulnerabilities.
- `npm run android:apk`: Android debug APK built successfully. `apksigner verify --verbose`
  confirmed its v2 signature. Output: `dist/android/pantry-scoop-debug.apk` (about 9.4 MB).
- Built-in Browser, isolated in-memory QA server on port 3216: pantry rendered, scan-source
  dialog showed camera/gallery choices, and the browser handoff page produced its one-time
  `pantryscoop://sign-in` return link after approval. No real sign-ins or AI calls were used.
- Existing Docker backend updated. The live server returned the new shared platform module and
  validated a malformed Android sign-in challenge with HTTP 400.
- Android emulator: both app and instrumentation APKs installed. The first run exposed the
  unused template test's hard-coded Capacitor package assertion; that template was removed.
  The shared-app smoke test started but the emulator terminated, returning
  `INSTRUMENTATION_ABORTED: System has crashed`. It did not pass. A rebuilt test APK is available;
  rerun `./gradlew :app:connectedDebugAndroidTest` on a stable emulator or connected phone.
- The Codex desktop app restarted during QA. Host-local task attachment was retried using the
  configured X authority and shared app-server; the built-in Browser subsequently returned an
  empty browser inventory and could not be reconnected. The Browser checks above occurred
  before that loss; no final post-deployment Browser check is claimed.
- Physical camera/gallery behavior, Android Back behavior, and real provider approvals still
  need device testing. The APK is a development build, not a store release.

## Phone download follow-up

The phone's Codex local-file link timed out in `fs/readFile` after 30 seconds. The APK itself
was present and readable. Published the same artifact through an exact nginx route at
https://pantry.gabruel.xyz/downloads/pantry-scoop-debug.apk, with Android APK content type,
attachment filename, no-store caching and byte-range support. No UI or backend code changed.
The nginx configuration check passed. A full HTTPS download returned 200 and 9,780,339 bytes;
the downloaded SHA-256 matched the local build and its v2 APK signature verified. A byte-range
request returned 206. The existing authentication endpoint still returned 200.
Phone installation remains to be confirmed by the user.

## Google login follow-up

The user confirmed download and installation, then reported that browser Google sign-in returned
to the app without activating the signed-in UI. Both browser approvals and native exchanges
returned HTTP 200 in the server logs. Code inspection identified the cause: replacing `/#stock`
only changes the hash; the signed-out app does not rerun its initial session read on that event.
The completion path now explicitly reloads the shared application after setting the stock hash.

Version 1.1 (version code 2) uses Android Credential Manager's Google button flow in a registered
Capacitor plugin. No browser is opened for Google. The backend verifies the ID token with the
existing Google verifier and a fresh server nonce bound to the initiating app's verifier, consumes
that flow once, and reuses the existing account linking and session machinery. Signing out also
clears Credential Manager's remembered sign-in state.

Native sign-in requires an Android OAuth client in the same Cloud project as the web client:
package `xyz.gabruel.pantryscoop`, SHA-1 `B9:AC:1D:90:D7:DD:87:42:42:5D:2D:88:D5:D6:A9:15:18:DF:07:30`.
Cloud registration and a real Google account chooser/sign-in are still unverified; the owner
was asked to confirm registration. Automated checks cover session activation, nonce verification,
wrong app proof, token rejection, provider binding, replay prevention and shared pantry identity.

Final validation for this update: 262 checks passed; app and instrumentation APKs compiled.
The signed version 1.1 / code 2 APK was published at the same HTTPS download endpoint and
downloaded back with an identical SHA-256. The deployed native start endpoint supplied its
nonce and public server client ID; wrong app proof returned 401. Shared platform/API/login
assets matched the source, deployed web site and Android assets byte for byte. Repeated warm
callbacks and redelivery of a cold-start intent after WebView reload are covered by regression
tests; completed flows retain only the non-secret flow identifier to avoid replaying the URL.
No Android device is connected. A real provider login was not performed. Built-in Browser
inventory was empty; the exact task was attached to the host desktop with the configured
X authority and shared app-server, but reconnect and fresh-tab creation both returned
`Browser is not available: iab`. No final rendered UI check is claimed.

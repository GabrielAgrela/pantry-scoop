# 🧺 Pantry Scoop

Take a photo of your ingredients, and your stock updates itself. Then ask for recipes of any kind
(lunch, dinner, breakfast, snacks, baking, drinks, desserts, ice cream) that fit what you have
**and** the equipment in your kitchen.

The AI runs on **your own ChatGPT plan**. Everyone signs in with "Continue with ChatGPT", and
photo scans and recipe ideas count against that person's ChatGPT Plus/Pro usage. No API keys are
needed and there's no shared bill.

- **Stock**: snap the fridge, pantry or shopping bags (several photos at once is fine). New
  ingredients are added and the rest are left alone (no quantities, just "have it / don't").
  Rename, recategorise, add notes ("half carton left"), delete, or add items by hand.
  **Ran out** moves an item to "Out of stock": it keeps its details, recipes stop using it, and
  photographing it again (or adding it by hand) puts it back.
- **Background work:** scans and recipe ideas run on the server, so you can refresh, switch tabs
  or lock your phone; the result is waiting when you come back. Your recipe choices and
  collapsed sections are remembered too.
- **Recipes**: pick a dish type (or "anything"), servings, which machines to use (every recipe is
  built around all the selected ones), an optional craving and an allowance for 0–3 things to buy.
  Each recipe comes with its yield, time, equipment, kcal/sugar estimates and tips. Save the good ones.
  Switch between **Saved recipes** and **Ideas**, which shows the latest generation by default.
  Use **Show older ideas** to expand earlier generations and **Hide older ideas** to collapse them.
  Search by recipe name or ingredient across all generations. Completed
  ideas stay in your account; the ready notification opens their batch, scrolls to it and marks it
  **New** with a brief highlight. The ready notification stays until you tap it.
- **Kitchen**: your appliances, each with free-text limits the AI must respect ("1.2 L bowl, mix
  700–850 ml", "4 L basket"), plus default servings, unit priorities, language and dietary preferences.
- **Accounts**: every ChatGPT account gets its own pantry, kitchen and saved recipes.
- **First visit**: Scoop, a floating pantry-jar chef, guides new accounts through two quick steps.
  Common appliances are already selected; tap to keep or remove them, then review cooking
  defaults. Dietary preferences and appliance limits are optional. Setup progress is saved
  to the account. Tap Scoop for a tip, or drag the little chef out of the way.

## Requirements

- Node.js ≥ 22.18 (built-in TypeScript and `node:sqlite`; there's no build step)
- A ChatGPT **Plus or Pro** account per person, for AI features. Free accounts can sign in but
  can't share plan usage.

## Run it

```bash
git clone https://github.com/GabrielAgrela/pantry-scoop.git && cd pantry-scoop
npm install
cp .env.example .env   # optional
npm start              # http://127.0.0.1:3210
```

Open **http://127.0.0.1:3210** on the same computer and click **Continue with ChatGPT**.

### Phones and other devices: scan a QR code

"Sign in with ChatGPT" for open-source apps always returns to `http://127.0.0.1:<port>`, the
device *running the browser*. So you connect ChatGPT **once on the computer running Pantry Scoop**
(one click). Then, for each phone:

1. On the computer, tap your account picture and choose **📱 Sign in on your phone**.
2. Scan the QR code with the phone's camera. The phone is signed in to the same account.

QR links work once and expire after 10 minutes. Sessions renew while you use the app, so phones
stay signed in. Other people in your home connect their own ChatGPT account on the computer (a
private window works), then pair their phones the same way.

No access to that computer? The phone's sign-in screen has a manual fallback under
**Can't use that computer?**: you copy the address ChatGPT sends you to and paste it into the app.

### One-tap sign-in on every device (registered website client)

The default ("open-source") flow above is all you need on the computer itself. For a normal
**Continue with ChatGPT → done** on phones and any other device, register Pantry Scoop as a website
with OpenAI:

1. **Apply:** use OpenAI's [Sign in with ChatGPT interest form](https://openai.com/form/sign-in-with-chatgpt-interest/)
   and ask for sign-in **with ChatGPT plan usage**. When approved, you receive a client ID
   (`oaiapp_…`), sometimes a client secret, and the scopes to request.
2. **Give the app a stable HTTPS address.** Two free options:
   - [Tailscale Funnel](https://tailscale.com/kb/1223/funnel): `tailscale funnel 3210` gives
     `https://<machine>.<tailnet>.ts.net`.
   - A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
     on your own domain.
3. **Register the callback** `https://<your address>/auth/callback` with OpenAI. It must match exactly.
4. **Set in `.env`** and restart:
   ```
   PUBLIC_URL=https://<your address>
   OPENAI_CLIENT_ID=oaiapp_…
   OPENAI_CLIENT_SECRET=…        # only if OpenAI gave you one
   OPENAI_SCOPES=…               # only if OpenAI tells you to request different scopes
   TRUST_PROXY=1                 # the tunnel forwards HTTPS for you
   ```

From then on, everyone signs in with one tap on any device at `PUBLIC_URL`, and the QR and
manual options disappear. Without these settings the app keeps using the open-source flow.

### Who can use your instance (please read)

OpenAI currently offers ChatGPT plan usage to **open-source projects and personal projects that
run locally** (the default flow), and to **approved apps** (the registered client above). Offering
a remotely hosted instance to other people requires OpenAI's approval. See
[Sign in with ChatGPT](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt).

### Docker (recommended)

```bash
cp .env.example .env        # optional
docker-compose up -d --build
```

Data lives in `./data` (mounted into the container). The container restarts on crashes and
reboots (`restart: unless-stopped`). The compose file uses host networking on Linux, so the
ChatGPT sign-in callback (`127.0.0.1:<PORT>`) and the phone QR code work as-is. On Docker
Desktop (macOS/Windows), switch to the `ports` mapping in `docker-compose.yml` and set `PUBLIC_URL`.

Update: `docker-compose up -d --build`. Logs: `docker logs -f pantry-scoop`.

### Production behind nginx (public domain)

1. **DNS:** add an `A` record for the subdomain pointing to your public IP.
2. **Domain:** run `./deploy/setup-domain.sh pantry.example.com`. It checks DNS, gets a Let's
   Encrypt certificate, installs `deploy/nginx/<domain>.conf` and checks HTTPS. Copy and adjust
   the conf first if your domain differs.
3. **`.env`:** set `PUBLIC_URL=https://pantry.example.com`, `TRUST_PROXY=1`,
   `ALLOWED_EMAILS=…` (invite-only) and `OWNER_EMAIL=…`, then run `docker-compose up -d --build`.

What's in place:
- **Container:** listens on `127.0.0.1` only, read-only filesystem, all capabilities dropped,
  `no-new-privileges`, memory and process limits, rotated logs.
- **App:** strict security headers (CSP, frame and referrer policies, HSTS over HTTPS); blocks
  state-changing requests from other sites; rate limits (stricter on sign-in); logs never include
  query strings; daily database snapshots in `data/backups` (keeps 7).
- **Access:** an email allowlist, a fixed owner for data created before accounts existed, and
  self-service account deletion.

### Always on without Docker (systemd, Linux)

```bash
npm run service:install   # links deploy/pantry-scoop.service, enables + starts it
npm run service:restart   # after updating code or .env
npm run service:status
npm run service:logs
```

The unit is a *user* service that restarts on crashes. For it to start at boot without logging in,
run `loginctl enable-linger $USER` once.

## Privacy & security

- **What OpenAI shares with the app:** name, email, profile picture and permission to run AI
  requests on the user's plan. It never shares ChatGPT conversations, memories or passwords.
- **Token storage:** OAuth tokens live only on the server, encrypted with AES-256-GCM. The key
  comes from `APP_SECRET`, or else `data/secret.key`, created with mode 0600. Tokens never reach
  the browser, URLs or logs.
- **Sessions:** HttpOnly, SameSite=Lax cookies. Only a SHA-256 of the session token is stored.
- **Phone QR links:** one-time and valid for 10 minutes. The token travels in the URL fragment, so
  it never appears in server logs, and only its hash is stored.
  Pending sign-ins use PKCE, `state` and `nonce`, and are bound to the starting browser.
- **ID tokens:** verified against OpenAI's published keys (issuer, audience, expiry, nonce).
- **Signing out** ends that browser's session. When it was the account's last session, the
  ChatGPT tokens are revoked too. Users can also disconnect the app any time in ChatGPT settings.
- Photos are resized in the browser, sent with the request and **not stored**. AI requests use
  `store: false`.
- There's no built-in HTTPS. Keep it on your home network, or put it behind a reverse proxy with
  TLS. Cookies switch to `Secure` automatically over HTTPS.

## Data

- **Where:** everything is in SQLite at `DB_PATH` (default `data/pantry.db`). Back up the `data/`
  folder, including `secret.key` if you don't set `APP_SECRET`.
- **Upgrades:** migrations run automatically on start.
- **Data from before accounts:** a database created before accounts existed is handed to the
  **first** account that signs in.

## Configuration (`.env`)

| Variable | Default | |
|---|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `3210` | The sign-in callback is `http://127.0.0.1:<PORT>/auth/callback` |
| `DB_PATH` | `./data/pantry.db` | |
| `APP_SECRET` | *(key file)* | Encrypts stored tokens. Changing it signs everyone out. |
| `SESSION_DAYS` | `30` | Renewed while in use |
| `PUBLIC_URL` | *(detected)* | Public address. Required (HTTPS) with `OPENAI_CLIENT_ID`; otherwise only used for the phone QR code |
| `OPENAI_CLIENT_ID` | *(unset)* | Registered website client from OpenAI. Turns on one-tap sign-in everywhere |
| `OPENAI_CLIENT_SECRET` | *(unset)* | Only for a confidential client; sent with HTTP Basic |
| `OPENAI_SCOPES` | identity + plan usage | Override only if OpenAI instructs you to |
| `TRUST_PROXY` | `0` | Set to `1` behind a tunnel or reverse proxy |
| `CHATGPT_MODEL` | *(per plan)* | Default model slug (recommended: `gpt-6.1-sol`); users can also choose one in the account menu |
| `CHATGPT_SCAN_EFFORT` | `low` | Reasoning effort for photo recognition |
| `CHATGPT_RECIPE_EFFORT` | `medium` | Reasoning effort for recipe suggestions |
| `CHATGPT_TIMEOUT_MS` | `180000` | |
| `DAILY_AI_LIMIT` | `30` | AI requests (scans, recipe batches, sorting) each person may make per day, resetting at midnight UTC; shown in the account menu. `0` = unlimited |

## Develop

```bash
npm run dev        # restart on change
npm test           # node:test, no network: OpenAI is faked
npm run typecheck  # tsc --noEmit
npm run check      # both
```

### Android and web: one frontend

The website and Android app use the same screens, styles and application logic in `public/`.
Capacitor bundles that directory into Android; `mobile/native.js` supplies native HTTP, camera,
photo picker, browser sign-in and Back-button behavior through `public/js/platform.js`.
The Node server remains the shared backend. Pantry edits, saved recipes, kitchen settings and
server jobs belong to the same account on both platforms. AI features require connectivity.

Develop features with `npm run dev` as usual. To package the current frontend for Android:

```bash
npm install
npm run android:sync
npm run android:open
```

Android builds require a **JDK 21** (including `javac`) and an Android SDK with platform/build
tools 36. Install them through Android Studio or Android's command-line tools, and set
`ANDROID_HOME` to the SDK directory. Then build an installable development APK:

```bash
npm run android:apk
```

The result is `dist/android/pantry-scoop-debug.apk`. This APK uses Android's development signing
key. Store distribution requires a separately signed release build and your own signing key.

The current development APK is also available at
https://pantry.gabruel.xyz/downloads/pantry-scoop-debug.apk for phone downloads.
The nginx configuration in `deploy/nginx/pantry.gabruel.xyz.conf` serves only that file from
`/var/www/pantry-scoop/android/`. After rebuilding, publish the new APK atomically:

```bash
sudo install -d -m 755 /var/www/pantry-scoop/android
sudo install -m 644 dist/android/pantry-scoop-debug.apk /var/www/pantry-scoop/android/pantry-scoop-debug.apk.new
sudo mv /var/www/pantry-scoop/android/pantry-scoop-debug.apk.new /var/www/pantry-scoop/android/pantry-scoop-debug.apk
```

With an emulator or Android phone connected, run the packaged-app smoke test from `android/`:

```bash
./gradlew :app:connectedDebugAndroidTest
```

This checks the real WebView, native API transport and shared sign-in screen. Camera capture and
the provider's actual sign-in approval should also be tested on a physical phone before release.

`mobile/config.json` selects the backend HTTPS origin (currently `https://pantry.gabruel.xyz`).
For another instance, edit that file or set `MOBILE_SERVER_URL` while building. Only the public
server address is packaged: `.env`, databases and provider credentials are never copied. Deploy
the current Node backend before using Android's new sign-in endpoints. Cleartext HTTP is disabled.

Android's **Continue with Google** opens Google's native account chooser through Credential
Manager. The app sends its ID token to the same backend, which verifies Google's signature,
audience, issuer, expiry and the server's one-time nonce before creating the session. The shared
app then reloads to read that session. Google sign-in does not open a browser.

In the **same Google Cloud project** as the website's web OAuth client, register an **Android**
OAuth client (Google Auth Platform → Clients → Create client) with package
`xyz.gabruel.pantryscoop` and the APK signing certificate's SHA-1. For the current development
build the SHA-1 is `B9:AC:1D:90:D7:DD:87:42:42:5D:2D:88:D5:D6:A9:15:18:DF:07:30`.
Credential Manager uses the existing `GOOGLE_CLIENT_ID` web client as its server audience;
no new client secret is embedded in Android. Release or differently signed builds need their
own matching Android registration. See [Google's setup guide](https://developer.android.com/identity/sign-in/credential-manager-siwg)
and [client registration](https://support.google.com/cloud/answer/6158849).

ChatGPT connects your plan through the system browser. After approving, tap **Continue in Android**,
then **Open Pantry Scoop**. The return code works once, expires after ten minutes and requires the
verifier held by the initiating Android app. Session cookies stay in Android's native cookie store;
ChatGPT credentials stay on the server. Connecting another provider targets the Android account
even if the system browser is signed into a different account.

For the default loopback-only ChatGPT client, the browser uses the existing phone sign-in flow:
complete the pasted callback there, then return to Android. Alternatively, use **Use a phone
sign-in link** in Android and paste the link generated by a signed-in device. Google and registered
ChatGPT clients return through the normal website callbacks.

`npm run android:sync` recopies the shared frontend after edits. Generated bundles and copied
assets are ignored by Git. Web deployment updates the website; bundled Android changes need a
new APK. There is no second set of feature screens to maintain.

### Architecture

Ports and adapters: the domain and use cases know nothing about SQLite, HTTP or OpenAI.

```
src/
  domain/          pure rules + validation (ingredients, kitchen profile, recipes, images, users)
  ports/           interfaces the app depends on (repositories, detector, generator, OpenAI auth, model catalog)
  application/     use cases: Stock, Scan, Recipe, Profile, Account, Auth (sign-in), ChatGptCredentials (token refresh)
  infrastructure/
    db/            node:sqlite repositories (all per-user), versioned migrations, token encryption
    openai/        OAuth/OIDC client (auth.openai.com) and a Responses API client (SSE)
    ai/            prompts + schemas, and the adapter that runs them on a user's ChatGPT plan
  http/            Fastify: session hook, sign-in routes, feature routes, error → status mapping
  composition.ts   wires concrete adapters; builds a service graph per signed-in user
public/            framework-free ES-module front-end (no build step)
test/              unit + integration tests
```

How a request uses someone's plan:
1. The session cookie resolves to a user.
2. `ChatGptCredentials` returns their access token, refreshing it near expiry. Refreshes are
   serialised per user because the refresh token rotates.
3. `ResponsesClient` calls `POST /v1/responses` with `store: false`, `stream: true` and a strict
   JSON schema, and accepts the answer only after `response.completed`.
4. Usage-limit, eligibility and expired-session errors become clear messages. A usage limit gets
   a **Manage usage** link to ChatGPT settings.

Key decisions:
- **No duplicates:** the case/accent-insensitive name is unique per user, and
  `StockService.addIfMissing` is the only way to add. The detector also gets the current stock
  names, so it reuses them.
- **Swappable AI:** prompts depend only on a `StructuredModel` interface. Another backend (an API
  key, a local model) is one class plus a change in `composition.ts`.

## License

[MIT](LICENSE). "ChatGPT" and "OpenAI" are trademarks of OpenAI. This project is not affiliated
with or endorsed by OpenAI.

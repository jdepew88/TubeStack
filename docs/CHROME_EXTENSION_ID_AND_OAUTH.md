# Chrome extension ID and OAuth (TubeStack)

This guide explains how **Chrome extension IDs** relate to **Google OAuth** for TubeStack, and how to set up **development** vs **production** OAuth clients without mixing credentials or redirect URIs.

**Related:** [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) · [STORE_LISTING.md](STORE_LISTING.md) · [PRIVACY.md](PRIVACY.md)

---

## Why the extension ID matters

Google OAuth for a Chrome extension ties each **OAuth Web client** to one or more **authorized redirect URIs**. Those URIs are derived from the extension’s **Chrome extension ID**.

TubeStack uses Chrome’s identity APIs (`chrome.identity.launchWebAuthFlow` / `chrome.identity.getRedirectURL`). The redirect URI you register in Google Cloud Console should match what the extension generates—typically:

```txt
https://<extension-id>.chromiumapp.org/
```

If the extension ID changes, sign-in breaks until you update the OAuth client’s authorized redirect URIs (and any Client ID you ship in user-facing setup docs).

---

## Unpacked dev builds vs stable IDs

**Chrome extension OAuth needs a stable extension ID.**

- **Unpacked** installs (`Load unpacked` in `chrome://extensions`) often get an ID that can **change** when the load path changes, unless you pin the ID with a **`key`** field in `manifest.json` (derived from a private key you control).
- Without a stable dev ID, you will repeatedly fix redirect URIs in Google Cloud and confuse testers.

**Recommendation:** use a **dedicated dev extension ID** (stable unpacked build with `key`, or a separate dev upload) for all development and QA OAuth testing.

---

## Dev OAuth vs production OAuth

| Environment | Extension ID | Google OAuth client |
|-------------|----------------|---------------------|
| **Development** | Stable **dev** extension ID | **Separate** OAuth Web client (Testing mode, test users) |
| **Production** | **Chrome Web Store** extension ID (permanent after first listing upload) | **Separate** OAuth Web client (production consent / verification as required) |

**Do not** use one OAuth client for both dev and production. Redirect URIs, extension IDs, and risk profiles differ.

**Do not commit** to this repository (or any public issue/screenshot):

- Private keys used to fix a dev extension ID (`manifest.json` `key`)
- OAuth **client secrets** (Web clients used only in extension flows may not need secrets in-repo; never publish secrets regardless)
- **Access tokens**, **refresh tokens**, or user session data
- **YouTube Data API keys**, **OpenAI API keys**, or other live credentials

TubeStack stores user-supplied Client IDs and API keys **locally** in the browser; the repo should only contain placeholders and documentation.

---

## How you get the production extension ID

The **permanent production extension ID** is assigned by Google when you first upload the extension to the **Chrome Web Store** (even as an **unlisted** draft). Until that upload exists, you only have dev/unpacked IDs—not the ID end users will run after install from the store.

**Production OAuth should use the Chrome Web Store extension ID**, not a developer’s unpacked ID.

---

## Authorized redirect URI

When using **Chrome identity web auth flow**, register this pattern in Google Cloud Console → your OAuth client → **Authorized redirect URIs**:

```txt
https://<extension-id>.chromiumapp.org/
```

Replace `<extension-id>` with the **exact** ID shown on `chrome://extensions` for the build you are configuring (dev client → dev ID; production client → store ID).

Copy the precise URI from TubeStack **Settings** (OAuth section) after loading the matching build, or from `chrome.identity.getRedirectURL()` in the extension context for that ID.

Re-check after:

- Switching from unpacked dev to store build
- Re-uploading a draft that changes ID (rare if the same listing item is updated in place—still verify)
- Creating a new Chrome Web Store listing item

---

## End-to-end sequence (production)

Use this order for a **new** public TubeStack release with OAuth:

1. **Clean manifest** — Permissions, version, and store-facing copy match what you will ship; no dev-only keys or secrets in the package you upload.

2. **Upload unlisted Chrome Web Store draft** — First upload to obtain the listing item and **permanent production extension ID** (unlisted is fine for this step).

3. **Copy permanent extension ID** — From the Chrome Web Store developer dashboard or `chrome://extensions` after installing the draft/review build Google provides.

4. **Create production OAuth client in Google Cloud** — New **Web application** OAuth 2.0 Client ID in your TubeStack Google Cloud project (separate from dev).

5. **Add authorized redirect URI** — `https://<production-extension-id>.chromiumapp.org/` (and only what Chrome identity requires for that client).

6. **Update TubeStack production config / Client ID** — Ship or document the **production** OAuth Web Client ID for store users; do not overwrite dev instructions with production values.

7. **Test OAuth** — Sign in, token refresh (if applicable), and YouTube features (e.g. playlist create) on a build with the **production** extension ID and production OAuth client.

8. **Submit public review** — Chrome Web Store review and, if applicable, Google OAuth app verification for production scopes.

Until step 3 completes, treat production OAuth as **blocked**—see [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (*Production OAuth ID pending unlisted upload*).

---

## Development workflow (summary)

1. Stabilize a **dev** extension ID (`key` in manifest for unpacked, or a dedicated dev listing).
2. Create a **dev-only** OAuth Web client; keep the app in **Testing**; add **test users**.
3. Register `https://<dev-extension-id>.chromiumapp.org/` on that client.
4. Paste the **dev** Client ID into TubeStack Settings on dev builds only.
5. Never use the dev Client ID in store builds or in public README screenshots.

---

## Checklist cross-reference

Before each release, confirm in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md):

- Redirect URI matches the extension ID for **this** build
- Production OAuth client uses the **store** ID, not dev
- No secrets or tokens in git, screenshots, or store assets

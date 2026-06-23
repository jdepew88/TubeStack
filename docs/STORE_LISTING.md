# TubeStack Chrome Web Store Listing

Use this document when filling out the Chrome Web Store developer dashboard: listing text, permission justifications, privacy fields, and reviewer notes.

Keep wording aligned with **`manifest.json`**, **[PRIVACY.md](PRIVACY.md)**, and **[`privacy/privacy.html`](../privacy/privacy.html)**.

**Permission reference:** [PERMISSIONS.md](PERMISSIONS.md)

**Note:** The store imposes strict character limits (especially the **short description**, typically **132 characters**). Count before pasting.

---

## Extension name

**TubeStack**

---

## Short description (≤ 132 characters)

**Suggested:**

> Save YouTube tabs into a local library—organize, resume progress, focus sessions. Optional YouTube API, OAuth & OpenAI on your device.

If you need a shorter line, drop the last sentence or shorten “Optional” to “Opts.”

---

## Detailed description

**TubeStack** is a Chrome extension for people who keep many **YouTube** watch or Shorts tabs open. It helps you:

- **Save** open YouTube tabs into a **local** playlist-style library
- **Close** those tabs to free memory
- **Restore** videos later — with full watch progress on `/watch` pages (best-effort on Shorts; **saving Shorts works**)

Inside the **dashboard**, you can organize saved videos with lists, themes/categories, tags, notes, and priority. Build local playlists, use focus-session tools, and work through queues without losing context.

**Queue sidebar (Chrome side panel)**

From the toolbar popup, click **Open sidebar** to dock a compact queue panel beside your tabs:

- Select a local queue and **add YouTube tabs** from the current window
- **Drag to reorder** videos (saved locally)
- **Continue playing** — open the full queue in order (first video active; resume when tracked)
- **Shuffle** — random playback order without changing the saved list

The toolbar icon always opens the save popup first; the side panel is optional and user-initiated.

### Optional integrations (your choice)

These are **advanced optional features**. Local save and organize works without them.

**YouTube Data API key (optional)**

If you add a key, TubeStack can import and analyze public metadata from Google.

**YouTube OAuth (optional)**

If you add a Google OAuth Web application client ID, you can sign in from the extension for features that need your YouTube account (playlist creation, subscription sync). Tokens stay between your browser and Google; TubeStack has no backend that stores credentials.

**OpenAI (optional)**

If you add an OpenAI API key, AI-assisted tools run only when you use them. Requests go directly to OpenAI and may include selected video metadata (titles, channels) needed for categorization — not a log of all sites you visit.

### Privacy in one line

TubeStack is **local-first**. Your library, playlists, progress, and settings live in extension storage on your device. TubeStack does **not** request Chrome History permission, does **not** scan unrelated browsing history, and does **not** sell your data.

**Store listing URL:** [`privacy/privacy.html`](../privacy/privacy.html) (hosted on HTTPS). Expanded source: [PRIVACY.md](PRIVACY.md).

### Disclaimers

TubeStack is **not affiliated with**, **endorsed by**, or **sponsored by** YouTube, Google, or OpenAI. You are responsible for complying with YouTube’s Terms of Service, Google API/OAuth policies, and OpenAI’s terms when you use those services.

---

## Single-purpose explanation

TubeStack has **one clear purpose:** help users **save, organize, and reopen YouTube watch and Shorts tabs** inside Chrome, with an optional local library and optional user-configured Google (YouTube API / OAuth) and OpenAI integrations.

It is **not** a general-purpose web monitor, ad blocker, or unrelated browsing tracker.

**For the “single purpose” / “narrow use case” field:**

> Save, organize, and reopen YouTube watch and Shorts tabs in a local library inside Chrome. Optional user-configured YouTube API, Google OAuth, and OpenAI features for imports and organization.

---

## Permission justifications

Paste into each **Permission justification** field in the Chrome Web Store dashboard. Shorter variants are provided where character limits are tight.

### `contextMenus`

**Standard:**

> Adds right-click menu items on **YouTube pages** to save open YouTube watch and Shorts tabs (left/right/all), and on the **extension icon** to open the TubeStack dashboard. Menus do not appear on non-YouTube websites.

**Short:**

> YouTube-only save actions via right-click; open dashboard from the extension icon.

---

### `identity`

**Standard:**

> Uses Chrome’s **identity API** for **optional Google OAuth** when the user configures a Client ID and chooses YouTube account features (for example playlist export or subscription sync). Sign-in is interactive; TubeStack has no backend that stores Google credentials.

**Short:**

> Optional Google OAuth sign-in for user-enabled YouTube account features.

---

### `scripting`

**Standard:**

> Injects small helper scripts on **specific YouTube tabs** when a user saves tabs or runs import and the page did not already load a content script (for example a tab opened before install). Used to read **page-visible** video metadata only — not arbitrary sites.

**Short:**

> Fallback script injection on YouTube tabs for save/metadata when content scripts are not loaded.

---

### `sidePanel`

**Standard:**

> Opens TubeStack's **optional queue sidebar** in Chrome's side panel when the user clicks **Open sidebar** in the toolbar popup. The panel lets users pick a local queue, add window tabs, drag to reorder, and play the queue in order or shuffled. Data stays in local extension storage; the toolbar icon still opens the save popup.

**Short:**

> Optional queue sidebar (reorder, play all, shuffle) when user clicks Open sidebar in the popup.

---

### `storage`

**Standard:**

> Stores the user’s **local YouTube library**, playlists, organization data, settings, and locally tracked watch progress in **chrome.storage.local** on the device. Optional API keys the user enters are also stored locally.

**Short:**

> Local library, playlists, settings, and progress on the user’s device.

---

### Permissions TubeStack does not request

> TubeStack does **not** request **History**, **`tabs`**, **`windows`**, or **`<all_urls>`**. It does not use `chrome.history`. Tab access is limited to **YouTube URLs** via host permissions.

---

## Host permission justifications

### Required host permissions

| Host pattern | Dashboard justification |
|--------------|-------------------------|
| `https://www.youtube.com/*` | Save YouTube watch and Shorts tabs; content scripts on watch/Shorts/subscription pages; read tab metadata when saving; open saved videos |
| `https://m.youtube.com/*` | Same as desktop YouTube for mobile YouTube URLs Chrome may use |

**Combined (one field):**

> Limited to YouTube only. Required for saving/organizing YouTube watch and Shorts tabs, watch/Shorts progress helpers (full on `/watch`, best-effort on Shorts), and user-initiated features on YouTube subscription pages. No access to other websites at install time.

---

### Optional host permissions

| Host pattern | Dashboard justification |
|--------------|-------------------------|
| `https://www.googleapis.com/*` | Runtime grant when user runs YouTube Data API or OAuth features they configured |
| `https://api.openai.com/*` | Runtime grant when user adds OpenAI API key and runs optional AI features |

**Optional hosts (one field):**

> Optional runtime permissions for user-configured Google YouTube API/OAuth and OpenAI features. Not requested silently for unrelated sites.

---

## Content scripts

TubeStack declares two content-script entries in `manifest.json`:

| Pages | Behavior | User control |
|-------|----------|--------------|
| `/watch*` and `/shorts/*` on youtube.com / m.youtube.com | Metadata on save; progress heartbeats while tab is open (local only; full on `/watch`, best-effort on Shorts) | Saving is explicit; progress only on open tabs |
| `/feed/channels*` and `/feed/subscriptions*` on youtube.com | Reads visible channel names when user runs import/sync | User-initiated; may scroll feed to load rows |

**Justification text:**

> Content scripts run only on YouTube watch, Shorts, and subscription pages. They support saving tab metadata, local resume progress on open watch tabs (best-effort on Shorts), and optional user-initiated channel list import — not tracking on non-YouTube sites.

---

## Remote code / MV3 compliance

- **No remotely hosted extension logic** — all scripts bundled in the package (`script-src 'self'` on extension pages)
- **No `eval` / `new Function`** for extension behavior
- **Optional network calls** go to Google or OpenAI only when the user enables those features (API responses are data, not executed code)

---

## Data usage explanation

| Topic | Answer |
|-------|--------|
| What is collected | TubeStack does **not** send your full library to a TubeStack-operated server. Data you generate is stored **locally** unless **you** trigger Google or OpenAI |
| What may leave the device | **Google** — when you use optional API/OAuth features. **OpenAI** — when you run optional AI tools (selected metadata, your API key) |
| Selling / ads | TubeStack does **not** sell personal data |
| Deletion | Users can delete stored data from Settings or uninstall. See [`privacy/privacy.html`](../privacy/privacy.html) |

**Certification-style summary (if checkbox list):**

- [x] Data stored locally by default
- [x] No Chrome History permission
- [x] Third-party network use only for optional user-configured Google/OpenAI features
- [x] User can delete local data from Settings or uninstall

---

## OAuth explanation

TubeStack supports **optional Google OAuth** for YouTube-related actions **at your request** (playlist creation, subscription sync).

- You provide a **Google OAuth 2.0 Web application Client ID** in settings
- **Sign-in is interactive** (Google consent screen)
- **Access tokens** stay in service worker memory and between your browser and Google’s APIs — not in `chrome.storage.local`
- **Revocation:** sign out in Settings, remove Client ID, or revoke in Google Account security settings

**Scope note:** Describe only what your published build actually uses on your Google OAuth consent screen.

---

## OpenAI explanation

OpenAI is **optional**. If you paste an OpenAI API key:

- The key is stored **locally** in extension storage
- Network calls go to **`https://api.openai.com`** when **you** run a feature that needs a model
- **AI categorization** may send selected fields from videos in your library (title, channel, tags/notes)

You can remove the key and clear local AI cache from Settings.

---

## Local-first privacy summary

- **Default posture:** Library and organization data stay **on-device**
- **No TubeStack backend for your library**
- **Third parties only when you opt in:** Google and OpenAI when you enable those optional features

**Store listing URL:** [`privacy/privacy.html`](../privacy/privacy.html)

---

## Disclaimers (YouTube / Google / OpenAI)

- TubeStack is **not affiliated with, endorsed by, or sponsored by** YouTube, Google LLC, or OpenAI
- **YouTube** and **Google** are trademarks of Google LLC
- **OpenAI** is a trademark of OpenAI, L.P. (or affiliates), used here to describe optional integration
- Users must comply with **YouTube Terms of Service**, **Google API Services User Data Policy**, and **OpenAI** usage policies

---

## Checklist before submission

- [ ] Short description within Chrome’s character limit
- [ ] Screenshots prepared (no API keys or tokens visible)
- [ ] Privacy policy URL points to hosted [`privacy/privacy.html`](../privacy/privacy.html) (HTTPS via GitHub Pages or equivalent)
- [ ] OAuth consent screen matches scopes and branding you describe
- [ ] `manifest.json` version bumped for the build you upload
- [ ] `.\scripts\verify-privacy-permissions.ps1` passes on the release tree
- [ ] Permission justifications match **[PERMISSIONS.md](PERMISSIONS.md)** and the shipped build
- [ ] Optional host permissions described as runtime / user-initiated
- [ ] Content script behavior (watch/Shorts progress, channel scrape) disclosed in privacy policy

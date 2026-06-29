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

**Use this line:**

> Save YouTube tabs and Shorts into a local library, organize videos, and reopen them later.

(108 characters — within the 132-character limit.)

---

## Detailed description

### Opening (paste into store listing)

**TubeStack** is a **local-first** Chrome extension for saving **YouTube watch tabs** and **YouTube Shorts tabs** into a **local library** on your device. Organize videos with playlists, categories, tags, and notes, then **reopen them later** when you are ready. Your library, playlists, and settings stay in **Chrome extension storage** on your machine — not on a TubeStack server.

Core workflow:

- **Save** open YouTube watch and Shorts tabs from the toolbar popup or right-click menu
- **Organize** saved videos in the dashboard and library
- **Reopen** individual videos or playlists later
- **Close tabs** after saving to free browser memory (optional)

**Watch progress:** Resume position is tracked on open YouTube **`/watch`** tabs while TubeStack is installed. On **Shorts**, progress tracking is **best-effort** — **saving Shorts tabs works** and captures title, channel, URL, and thumbnail when the page allows.

### Queue sidebar (Chrome side panel)

TubeStack includes an **optional queue sidebar** — a compact panel for working through a local playlist. It is **not** the main headline feature; it uses the **same local library and playlists** as the dashboard.

- The toolbar icon **always opens the save popup first**
- Click **Open queue sidebar** in the popup to open the side panel (user-initiated only)
- Select a local queue, **add YouTube tabs** from the current window, and **drag to reorder** (saved locally)
- **Play** opens the queue **one video at a time** in a single tab; when a video finishes, the next opens automatically (resume when tracked)
- **Shuffle** reorders the queue locally, then plays through one video at a time the same way

### Optional advanced features

These are **optional**. TubeStack works without them. Nothing below is required to save, organize, or reopen videos locally.

**YouTube Data API key (optional)**

If you add your own API key, TubeStack can import public metadata from Google (for example channel scans and playlist previews).

**Google OAuth (optional)**

If you add a Google OAuth Web application Client ID, you can sign in for account features such as **playlist export/sync** and **subscription sync**. Sign-in is interactive. OAuth access tokens stay in the **service worker’s memory only** — not written to `chrome.storage.local`. Requests go directly between your browser and Google; TubeStack has **no backend server** that stores credentials.

**OpenAI tools (optional)**

If you add an OpenAI API key, AI-assisted organization tools run **only when you trigger them**. Requests go directly to OpenAI and may include selected video metadata (titles, channels, tags) from your saved library — not a log of all sites you visit.

### Privacy in one line

TubeStack is **local-first**. Your library, playlists, progress, and settings live in extension storage on your device. TubeStack does **not** request Chrome **History** permission, does **not** use the broad **`tabs`** permission or **`windows`** permission, does **not** request **`<all_urls>`**, does **not** scan unrelated browsing history, and does **not** sell your data. TubeStack has **no central backend** that collects your library.

**Privacy policy URL (store dashboard):** `https://jdepew88.github.io/TubeStack/privacy/privacy.html`  
**Do not** use `docs/PRIVACY.md` as the store URL (GitHub Pages serves it as raw Markdown).

### Disclaimers

TubeStack is **not affiliated with**, **endorsed by**, or **sponsored by** YouTube, Google, or OpenAI. You are responsible for complying with YouTube’s Terms of Service, Google API/OAuth policies, and OpenAI’s terms when you use those optional services.

---

## Reviewer notes

Paste or adapt for the Chrome Web Store **notes to reviewer** field (if available):

> TubeStack is a local-first YouTube tab and Shorts organizer. The default flow works **without** a YouTube Data API key, **without** Google OAuth, **without** OpenAI, and **without** any TubeStack-operated backend server.
>
> Users save YouTube watch and Shorts tabs via the **toolbar popup**, **context menu**, or **optional queue sidebar** (side panel opens only when the user clicks **Open queue sidebar** in the popup; the toolbar icon always opens the save popup first).
>
> Optional integrations (YouTube API, Google OAuth, OpenAI) are **user-configured** and requested at runtime when the user runs those features. OAuth access tokens are kept in the service worker’s **memory only** and are **not** written to `chrome.storage.local`.
>
> TubeStack does **not** request Chrome History, the broad `tabs` permission, `windows`, or `<all_urls>`. Host access at install is limited to `youtube.com` and `m.youtube.com`. Watch progress is recorded locally on open YouTube tabs (`/watch` full support; Shorts best-effort). Saving Shorts tabs works.

---

## Single-purpose explanation

TubeStack has **one clear purpose:** help users **save, organize, and reopen YouTube watch and Shorts tabs** in a **local library** inside Chrome.

It is **not** a general-purpose web monitor, ad blocker, or unrelated browsing tracker.

**For the “single purpose” / “narrow use case” field:**

> Save YouTube tabs and Shorts into a local library, organize videos, and reopen them later.

---

## Permission justifications

Paste into each **Permission justification** field in the Chrome Web Store dashboard. Shorter variants are provided where character limits are tight.

Install-time permissions in `manifest.json`: `contextMenus`, `identity`, `scripting`, `sidePanel`, `storage`.

### `contextMenus`

**Standard:**

> Adds right-click menu items on **YouTube pages** to save open YouTube watch and Shorts tabs (left/right/all), and on the **extension icon** to open the TubeStack dashboard. Menus do not appear on non-YouTube websites.

**Short:**

> YouTube-only save actions via right-click; open dashboard from the extension icon.

---

### `identity`

**Standard:**

> Uses Chrome’s **identity API** for **optional Google OAuth** when the user configures a Client ID and chooses YouTube account features (for example playlist export/sync or subscription sync). Sign-in is interactive; OAuth tokens stay in service worker memory only. TubeStack has no backend that stores Google credentials.

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

> Opens TubeStack’s **optional queue sidebar** in Chrome’s side panel when the user clicks **Open queue sidebar** in the toolbar popup. The panel uses the same local library and playlists: pick a queue, add window tabs, drag to reorder, and play sequentially (one video at a time with auto-advance) or shuffle the queue order first. Data stays in local extension storage; the toolbar icon still opens the save popup.

**Short:**

> Optional queue sidebar (reorder, sequential play, shuffle) when user clicks Open queue sidebar in the popup.

---

### `storage`

**Standard:**

> Stores the user’s **local YouTube library**, playlists, organization data, settings, and locally tracked watch progress in **chrome.storage.local** on the device. Optional API keys the user enters are also stored locally.

**Short:**

> Local library, playlists, settings, and progress on the user’s device.

---

### Permissions TubeStack does not request

> TubeStack does **not** request **History**, **`tabs`**, **`windows`**, or **`<all_urls>`**. It does not use `chrome.history`. YouTube tab access is scoped via **YouTube host permissions** only. TubeStack has **no TubeStack-operated backend server** for your library.

---

## Host permission justifications

### Required host permissions

| Host pattern | Dashboard justification |
|--------------|-------------------------|
| `https://www.youtube.com/*` | Save YouTube watch and Shorts tabs; content scripts on watch/Shorts/subscription pages; read tab metadata when saving; open saved videos |
| `https://m.youtube.com/*` | Same as desktop YouTube for mobile YouTube URLs Chrome may use |

**Combined (one field):**

> Limited to YouTube only. Required for saving/organizing YouTube watch and Shorts tabs, local progress on open tabs (full on `/watch`, best-effort on Shorts; saving Shorts works), and user-initiated channel import on subscription pages. No access to other websites at install time.

---

### Optional host permissions

| Host pattern | Dashboard justification |
|--------------|-------------------------|
| `https://www.googleapis.com/*` | Runtime grant when user runs optional YouTube Data API or Google OAuth features they configured |
| `https://api.openai.com/*` | Runtime grant when user adds OpenAI API key and runs optional AI features |

**Optional hosts (one field):**

> Optional runtime permissions for user-configured Google APIs and OpenAI. Not requested silently for unrelated sites.

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
| What is collected | TubeStack does **not** send your full library to a TubeStack-operated server. Data you generate is stored **locally** unless **you** trigger optional Google or OpenAI features |
| What may leave the device | **Google** — when you use optional API/OAuth features. **OpenAI** — when you run optional AI tools (selected metadata, your API key) |
| Selling / ads | TubeStack does **not** sell personal data |
| Deletion | Users can delete stored data from Settings or uninstall. See [`privacy/privacy.html`](../privacy/privacy.html) |

**Certification-style summary (if checkbox list):**

- [x] Data stored locally by default
- [x] No Chrome History permission
- [x] No broad `tabs`, `windows`, or `<all_urls>` permissions
- [x] No TubeStack backend server for the library
- [x] Third-party network use only for optional user-configured Google/OpenAI features
- [x] User can delete local data from Settings or uninstall

---

## OAuth explanation

TubeStack supports **optional Google OAuth** for YouTube-related actions **at your request** (playlist export/sync, subscription sync).

- You provide a **Google OAuth 2.0 Web application Client ID** in settings
- **Sign-in is interactive** (Google consent screen)
- **Access tokens** stay in service worker memory and between your browser and Google’s APIs — **not** in `chrome.storage.local`
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
- **No TubeStack backend** for your library
- **Third parties only when you opt in:** Google and OpenAI when you enable those optional features

**Store listing URL:** [`privacy/privacy.html`](../privacy/privacy.html) (host at `https://jdepew88.github.io/TubeStack/privacy/privacy.html`)

---

## Disclaimers (YouTube / Google / OpenAI)

- TubeStack is **not affiliated with, endorsed by, or sponsored by** YouTube, Google LLC, or OpenAI
- **YouTube** and **Google** are trademarks of Google LLC
- **OpenAI** is a trademark of OpenAI, L.P. (or affiliates), used here to describe optional integration
- Users must comply with **YouTube Terms of Service**, **Google API Services User Data Policy**, and **OpenAI** usage policies

---

## Checklist before submission

- [ ] Short description: `Save YouTube tabs and Shorts into a local library, organize videos, and reopen them later.`
- [ ] Detailed description leads with local-first save/organize/reopen — optional features below
- [ ] Screenshots prepared (no API keys or tokens visible)
- [ ] Privacy policy URL: `https://jdepew88.github.io/TubeStack/privacy/privacy.html` (not `docs/PRIVACY.md`)
- [ ] Reviewer notes pasted (see **Reviewer notes** section above)
- [ ] OAuth consent screen matches scopes and branding you describe (if testing OAuth)
- [ ] `manifest.json` version bumped for the build you upload
- [ ] `.\scripts\verify-privacy-permissions.ps1` passes on the release tree
- [ ] Permission justifications match **[PERMISSIONS.md](PERMISSIONS.md)** and the shipped build (including `sidePanel`)
- [ ] Optional host permissions described as runtime / user-initiated
- [ ] Content script behavior (watch/Shorts progress, channel scrape) disclosed in privacy policy

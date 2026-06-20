# TubeStack — permissions (Chrome Web Store)

This document matches **`manifest.json`** in this repository (Manifest V3). Use it when filling out Chrome Web Store **permission justification** fields, privacy questionnaires, and internal review before upload.

**Related:** [STORE_LISTING.md](STORE_LISTING.md) (copy-paste listing text) · [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) · [PRIVACY.md](PRIVACY.md)

---

## Summary for reviewers

TubeStack is a **single-purpose** extension: save and organize **YouTube watch tabs** in a **local library**. It:

- **Does not** request Chrome **History**, **`tabs`**, **`windows`**, **`<all_urls>`**, or broad site access.
- **Does not** call `chrome.history` or read unrelated browsing history.
- Limits **host access** to **YouTube** (`youtube.com`, `m.youtube.com`) at install time.
- Keeps **Google APIs** and **OpenAI** as **optional host permissions** granted only when the user runs a feature that needs them.
- Stores library data **locally** in `chrome.storage.local` on the user’s device.

---

## Current `manifest.json` (permissions)

```json
"permissions": ["contextMenus", "identity", "scripting", "storage"],
"host_permissions": [
  "https://www.youtube.com/*",
  "https://m.youtube.com/*"
],
"optional_host_permissions": [
  "https://www.googleapis.com/*",
  "https://api.openai.com/*"
]
```

**Content scripts** (declared in manifest, not separate permissions):

| Matches | Scripts | Purpose |
|---------|---------|---------|
| `https://www.youtube.com/watch*`, `https://m.youtube.com/watch*` | `youtube-metadata.js`, `youtube-progress.js` | Read page-visible video metadata on save; track playback progress on open watch tabs (local only) |
| `https://www.youtube.com/feed/channels*`, `https://www.youtube.com/feed/subscriptions*` | `channel-scrape.js` | User-initiated channel-name scrape on YouTube subscription pages |

---

## Declared permissions — detail

### `contextMenus`

| | |
|--|--|
| **Why declared** | Chrome requires this permission to register extension context menu items. |
| **Where used** | `background/service-worker.js` — `rebuildTubeStackContextMenus()` |
| **User trigger** | User right-clicks on a **YouTube page** or on the **extension toolbar icon**. |
| **Scope** | **YouTube pages only** for save actions (`documentUrlPatterns`: `youtube.com`, `m.youtube.com`). **Open dashboard** appears on **extension icon** right-click (`contexts: ["action"]`), not on every website. |
| **Data accessed** | None directly from the menu. Save actions query **YouTube watch tabs** in the current window (see host permissions + tabs API below). |

**Chrome Web Store justification (short):**

> Adds right-click menu items on YouTube pages to save open YouTube watch tabs, and on the extension icon to open the TubeStack dashboard.

**Chrome Web Store justification (long):**

> TubeStack registers context menu entries so users can save YouTube watch tabs without opening the popup. Save items appear only on YouTube URLs. “Open dashboard” appears when right-clicking the extension icon. Menu actions do not read Chrome History or non-YouTube sites.

---

### `identity`

| | |
|--|--|
| **Why declared** | Required for `chrome.identity.launchWebAuthFlow` and `chrome.identity.getRedirectURL` (Google OAuth). |
| **Where used** | `background/service-worker.js` — YouTube OAuth sign-in and token exchange when user enables account features. |
| **User trigger** | User adds an OAuth Client ID and runs **Connect YouTube**, playlist export, subscription sync, or similar **optional** flows. |
| **Scope** | OAuth only; interactive Google consent screen. Tokens kept in **service worker memory**, not written to `chrome.storage.local`. |
| **If unused** | Extension works without OAuth for local save/organize flows. Permission is declared because OAuth is an offered feature. |

**Chrome Web Store justification (short):**

> Optional Google sign-in for YouTube account features (for example playlist export) using Chrome’s identity API and an interactive OAuth flow.

**Chrome Web Store justification (long):**

> When the user configures a Google OAuth Web Client ID and chooses a YouTube account feature, TubeStack uses chrome.identity.launchWebAuthFlow so the user signs in with Google in a standard consent screen. Access tokens are used between the browser and Google APIs; TubeStack has no backend that stores Google passwords or OAuth tokens.

---

### `scripting`

| | |
|--|--|
| **Why declared** | Required for `chrome.scripting.executeScript` when a content script is not already present on a tab. |
| **Where used** | `background/service-worker.js` — fallback injection of `youtube-metadata.js` or `channel-scrape.js` on **specific YouTube tab IDs** before `sendMessage`. |
| **User trigger** | Saving tabs, importing channels, or other actions that need metadata from a YouTube tab that did not load a content script (for example `/shorts/` URLs). |
| **Scope** | **YouTube tab IDs only** — never arbitrary URLs or non-YouTube sites. |
| **Relationship to content scripts** | Watch pages normally use manifest content scripts; scripting is a **fallback**, not a substitute for broad injection. |

**Chrome Web Store justification (short):**

> Injects small helper scripts on YouTube tabs when needed to read page-visible metadata for save/restore (fallback when content scripts are not loaded).

**Chrome Web Store justification (long):**

> TubeStack declares scripting to inject youtube-metadata.js or channel-scrape.js on specific YouTube tab IDs when saving tabs or running a user-initiated import and the manifest content script is not present (for example some Shorts URLs). Injection is limited to YouTube tabs involved in an explicit user action.

---

### `storage`

| | |
|--|--|
| **Why declared** | Required for `chrome.storage.local` (and `chrome.storage.onChanged`). |
| **Where used** | Service worker, dashboard, popup, library, home — entire extension. |
| **User trigger** | Any save, organize, settings, or progress feature. |
| **What is stored** | Library items, playlists, categories, notes, settings, `videoProgress`, `watchByDay`, optional API **keys the user pastes**, UI preferences. |
| **What is not stored remotely** | No TubeStack-operated server receives this data by default. |

**Chrome Web Store justification (short):**

> Saves your local YouTube library, playlists, settings, and watch progress on your device in Chrome extension storage.

**Chrome Web Store justification (long):**

> TubeStack is local-first. Saved videos, playlists, organization fields, extension settings, and locally tracked YouTube watch progress are persisted with chrome.storage.local on the user’s device. Optional API keys the user enters are also stored locally. TubeStack does not upload the library to a TubeStack backend.

---

## Host permissions — detail

### Required: `https://www.youtube.com/*` and `https://m.youtube.com/*`

| | |
|--|--|
| **Why required** | Core product scope; content scripts; tab URL/title access for YouTube tabs; opening YouTube links from the library. |
| **Where used** | Content scripts (watch + subscription pages); `chrome.tabs.query` filtered to YouTube URLs; opening saved watch URLs. |
| **User trigger** | Saving tabs, viewing library, resuming videos, optional channel scrape on YouTube subscription pages. |
| **Not used for** | Reading non-YouTube pages, background tracking on other sites, or History API replacement. |

**Chrome Web Store justification (short):**

> TubeStack only works with YouTube watch tabs and YouTube pages for save, metadata, progress, and organization features.

**Chrome Web Store justification (long):**

> Host permission is limited to youtube.com and m.youtube.com. TubeStack saves and organizes YouTube watch tabs, runs content scripts on YouTube watch and subscription pages, and reads tab metadata for YouTube URLs when the user saves tabs. No access to other websites is requested at install time.

---

### Optional: `https://www.googleapis.com/*`

| | |
|--|--|
| **Why optional** | YouTube Data API v3 and OAuth-backed Google API calls. |
| **Grant mechanism** | `chrome.permissions.request` at runtime when user runs a feature (`ensureOptionalHostOrigins`). |
| **User trigger** | User adds API key or OAuth Client ID and runs import, playlist create, subscription sync, API test, etc. |
| **If denied** | Local save/organize features continue to work; Google API features show a clear error. |

**Chrome Web Store justification (short):**

> Optional access to Google APIs when you use YouTube Data API or OAuth features you configure yourself.

---

### Optional: `https://api.openai.com/*`

| | |
|--|--|
| **Why optional** | Optional AI categorization and connection test. |
| **Grant mechanism** | Runtime permission request before fetch to OpenAI. |
| **User trigger** | User adds OpenAI API key and runs AI categorization or test. |
| **Data sent** | Selected metadata from **saved library items** only (titles, channels, tags, notes)—not a log of all browsing. |

**Chrome Web Store justification (short):**

> Optional access to OpenAI when you add an API key and run AI organization features yourself.

---

## APIs used without extra permissions

TubeStack intentionally **does not** declare these permissions:

| API | How TubeStack uses it | Why no extra permission |
|-----|----------------------|-------------------------|
| `chrome.tabs.query` / `create` / `update` / `remove` | Save YouTube tabs by position; open library videos; open dashboard | **Host permissions** on YouTube URLs allow reading `url`/`title` for matching tabs without the broad **`tabs`** permission |
| `chrome.runtime.*` | Messaging, extension pages | Always available |
| `chrome.permissions.request` | Optional Google/OpenAI hosts | Used to request optional hosts only when needed |

**Important for reviewers:** The absence of **`tabs`** permission means TubeStack **cannot** read tab URLs/titles on arbitrary non-YouTube sites.

---

## Intentionally not declared

| Permission / pattern | Reason |
|---------------------|--------|
| `history` | Not needed; TubeStack does not read browsing history. |
| `tabs` | Avoids broad tab access; YouTube scope covered by host permissions. |
| `windows` | Not needed; tab operations use `chrome.tabs`; setup guide opens via `chrome.tabs.create`. |
| `<all_urls>` / `*://*/*` | Single-purpose YouTube tool; not a general page monitor. |
| `webNavigation`, `cookies`, `debugger`, `bookmarks` | Unused. |
| Context menus on all URLs | Removed — menus limited to YouTube + extension icon (see `contextMenus` above). |

---

## Content scripts — disclosure for store / privacy forms

When the dashboard asks what runs on web pages:

1. **Watch pages** — Passive message listener for metadata on user save; periodic progress ticks **only while a watch tab is open** (stored locally as `videoProgress` / `watchByDay`). No Chrome History API.
2. **Subscription / channels feed** — Scrapes **visible channel names from the DOM** only when the user triggers import/sync; may scroll the page to load more rows.
3. **No content scripts** on non-YouTube sites.

Align wording with [PRIVACY.md — Watch progress](PRIVACY.md#watch-progress-local-youtube-pages-only).

---

## Common reviewer questions — suggested answers

**Does TubeStack collect browsing history?**  
No. It does not use the Chrome History permission or `chrome.history`. Progress is observed on **open YouTube watch tabs** via a content script and stored locally.

**Why `identity` if OAuth is optional?**  
Chrome requires the `identity` permission for `launchWebAuthFlow`. The feature is optional; local library use does not require sign-in.

**Why `scripting` if you have content scripts?**  
Fallback injection on specific YouTube tabs (for example Shorts) when saving, if the manifest content script did not load.

**Why context menus on many context types (`page`, `link`, `video`, etc.)?**  
So users can right-click a video link or the page on **YouTube** and still reach save actions. Menu entries are restricted to **YouTube URL patterns**, not all websites.

**Does TubeStack access tabs on non-YouTube sites?**  
Tab queries filter to YouTube watch URLs. Without the `tabs` permission and without host access to other origins, TubeStack cannot read unrelated tab URLs.

---

## Verify before upload

From the repo root:

```powershell
.\scripts\verify-privacy-permissions.ps1
```

The script fails if:

- `history`, `tabs`, or `windows` appear in `manifest.json`
- Broad host patterns (`*://*/*`, `<all_urls>`) appear
- `chrome.history` is used in code
- Context menus use all-URL `documentUrlPatterns`
- A declared permission has no matching API usage in `*.js`

Manual spot-check:

```powershell
# Should return zero matches in application code
rg "chrome\.history" tube-stack --glob "*.js"
```

---

## Keeping docs in sync

When changing `manifest.json`:

1. Update this file and [STORE_LISTING.md](STORE_LISTING.md) permission tables.
2. Run `.\scripts\verify-privacy-permissions.ps1`.
3. Update [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) if new verification steps apply.
4. Bump store listing “Permission justification” fields in the Chrome Web Store dashboard to match the shipped build.

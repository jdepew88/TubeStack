# TubeStack — permissions (Chrome Web Store)

This document matches **`manifest.json`** in this repository (Manifest V3). Use it when filling out Chrome Web Store **permission justification** fields, privacy questionnaires, and internal review before upload.

**Privacy policy (store listing URL):** host [`privacy/privacy.html`](../privacy/privacy.html) at a public HTTPS URL (for example GitHub Pages). The extension popup and Settings link to the bundled copy.

**Related docs:** [STORE_LISTING.md](STORE_LISTING.md) · [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) · [PRIVACY.md](PRIVACY.md)

---

## Summary for reviewers

TubeStack is a **single-purpose** extension: save and organize **YouTube watch and Shorts tabs** in a **local library**.

| Claim | Detail |
|-------|--------|
| No History / tabs / windows / all_urls | TubeStack does not request these permissions or read unrelated browsing history |
| Host access at install | Limited to `youtube.com` and `m.youtube.com` |
| Optional hosts | Google APIs and OpenAI — granted at runtime when the user runs those features |
| Data storage | Library data stored locally in `chrome.storage.local` on the user’s device |

---

## Current `manifest.json`

### Permissions

```json
"permissions": ["contextMenus", "identity", "scripting", "storage"]
```

### Host permissions

```json
"host_permissions": [
  "https://www.youtube.com/*",
  "https://m.youtube.com/*"
]
```

### Optional host permissions

```json
"optional_host_permissions": [
  "https://www.googleapis.com/*",
  "https://api.openai.com/*"
]
```

### Content scripts (declared in manifest)

| Page patterns | Scripts | Purpose |
|---------------|---------|---------|
| `https://www.youtube.com/watch*` | `lib/youtube-url.js`, `youtube-metadata.js`, `youtube-progress.js` | Metadata on save; local progress (full) |
| `https://m.youtube.com/watch*` | same | same |
| `https://www.youtube.com/shorts/*` | same | Metadata on save; local progress (best-effort) |
| `https://m.youtube.com/shorts/*` | same | same |
| `https://www.youtube.com/feed/channels*` | `channel-scrape.js` | User-initiated channel-name scrape |
| `https://www.youtube.com/feed/subscriptions*` | `channel-scrape.js` | User-initiated channel-name scrape |
| `https://m.youtube.com/feed/channels*` | `channel-scrape.js` | User-initiated channel-name scrape |
| `https://m.youtube.com/feed/subscriptions*` | `channel-scrape.js` | User-initiated channel-name scrape |

---

## Declared permissions — detail

### `contextMenus`

| Field | Detail |
|-------|--------|
| Why declared | Chrome requires this permission to register extension context menu items |
| Where used | `background/service-worker.js` — `rebuildTubeStackContextMenus()` |
| User trigger | User right-clicks on a YouTube page or on the extension toolbar icon |
| Scope | Save actions on YouTube URLs only (`documentUrlPatterns`: `youtube.com`, `m.youtube.com`). **Open dashboard** on extension icon right-click only |
| Data accessed | Save actions query YouTube watch and Shorts tabs in the current window, save to library, create a new local playlist, open dashboard (same as popup) |

**Chrome Web Store justification (short):**

> Adds right-click menu items on YouTube pages to save open YouTube watch and Shorts tabs, and on the extension icon to open the TubeStack dashboard.

**Chrome Web Store justification (long):**

> TubeStack registers context menu entries so users can save YouTube watch and Shorts tabs without opening the popup. Save items appear only on YouTube URLs. “Open dashboard” appears when right-clicking the extension icon. Menu actions do not read Chrome History or non-YouTube sites.

---

### `identity`

| Field | Detail |
|-------|--------|
| Why declared | Required for `chrome.identity.launchWebAuthFlow` and `chrome.identity.getRedirectURL` |
| Where used | `background/service-worker.js` — YouTube OAuth sign-in and token exchange |
| User trigger | User adds OAuth Client ID and runs Connect YouTube, playlist export, subscription sync, or similar optional flows |
| Scope | Interactive Google consent screen only. Tokens in **service worker memory**, not `chrome.storage.local` |
| If unused | Local save/organize works without OAuth |

**Chrome Web Store justification (short):**

> Optional Google sign-in for YouTube account features (for example playlist export) using Chrome’s identity API and an interactive OAuth flow.

**Chrome Web Store justification (long):**

> When the user configures a Google OAuth Web Client ID and chooses a YouTube account feature, TubeStack uses chrome.identity.launchWebAuthFlow for a standard Google consent screen. Access tokens are used between the browser and Google APIs; TubeStack has no backend that stores Google passwords or OAuth tokens.

---

### `scripting`

| Field | Detail |
|-------|--------|
| Why declared | Required for `chrome.scripting.executeScript` when a content script is not already on the tab |
| Where used | Fallback injection of `lib/youtube-url.js` + `youtube-metadata.js`, or `channel-scrape.js`, on specific YouTube tab IDs |
| User trigger | Saving tabs or importing channels when the manifest content script did not load (for example tab opened before install) |
| Scope | YouTube tab IDs only — never arbitrary URLs |
| Relationship to content scripts | Watch and Shorts pages normally use manifest content scripts; scripting is a **fallback** |

**Chrome Web Store justification (short):**

> Injects small helper scripts on YouTube tabs when needed to read page-visible metadata for save/restore (fallback when content scripts are not loaded).

**Chrome Web Store justification (long):**

> TubeStack declares scripting to inject lib/youtube-url.js and youtube-metadata.js (or channel-scrape.js for channel import) on specific YouTube tab IDs when saving or importing and the manifest content script is not present. Injection is limited to YouTube tabs involved in an explicit user action.

---

### `storage`

| Field | Detail |
|-------|--------|
| Why declared | Required for `chrome.storage.local` and `chrome.storage.onChanged` |
| Where used | Service worker, dashboard, popup, library, home |
| User trigger | Any save, organize, settings, or progress feature |
| What is stored | Library items, playlists, categories, notes, settings, `videoProgress`, `watchByDay`, optional API keys, UI preferences |
| What is not stored remotely | No TubeStack-operated server receives this data by default |

**Chrome Web Store justification (short):**

> Saves your local YouTube library, playlists, settings, and watch progress on your device in Chrome extension storage.

**Chrome Web Store justification (long):**

> TubeStack is local-first. Saved videos, playlists, organization fields, extension settings, and locally tracked YouTube watch progress are persisted with chrome.storage.local on the user’s device. Optional API keys the user enters are also stored locally. TubeStack does not upload the library to a TubeStack backend.

---

## Host permissions — detail

### Required: YouTube (`youtube.com`, `m.youtube.com`)

| Field | Detail |
|-------|--------|
| Why required | Core product scope; content scripts; YouTube tab URL/title access; opening saved links |
| Where used | Content scripts on watch, Shorts, and subscription pages; `chrome.tabs.query` filtered to YouTube URLs |
| User trigger | Saving tabs, viewing library, resuming videos, optional channel scrape |
| Not used for | Non-YouTube pages, background tracking on other sites, History API replacement |

**Chrome Web Store justification (short):**

> TubeStack only works with YouTube watch/Shorts tabs and YouTube pages for save, metadata, progress, and organization features.

**Chrome Web Store justification (long):**

> Host permission is limited to youtube.com and m.youtube.com. TubeStack saves and organizes YouTube watch and Shorts tabs, runs content scripts on YouTube watch, Shorts, and subscription pages, and reads tab metadata for YouTube URLs when the user saves tabs. No access to other websites is requested at install time.

---

### Optional: `https://www.googleapis.com/*`

| Field | Detail |
|-------|--------|
| Why optional | YouTube Data API v3 and OAuth-backed Google API calls |
| Grant mechanism | `chrome.permissions.request` at runtime (`ensureOptionalHostOrigins`) |
| User trigger | User adds API key or OAuth Client ID and runs import, playlist create, subscription sync, API test, etc. |
| If denied | Local save/organize continues; Google API features show a clear error |

**Chrome Web Store justification (short):**

> Optional access to Google APIs when you use YouTube Data API or OAuth features you configure yourself.

---

### Optional: `https://api.openai.com/*`

| Field | Detail |
|-------|--------|
| Why optional | Optional AI categorization and connection test |
| Grant mechanism | Runtime permission request before fetch to OpenAI |
| User trigger | User adds OpenAI API key and runs AI categorization or test |
| Data sent | Selected metadata from saved library items only — not a log of all browsing |

**Chrome Web Store justification (short):**

> Optional access to OpenAI when you add an API key and run AI organization features yourself.

---

## APIs used without extra permissions

| API | How TubeStack uses it | Why no extra permission |
|-----|----------------------|-------------------------|
| `chrome.tabs.query` / `create` / `update` / `remove` | Save YouTube tabs by position; open library videos; open dashboard | YouTube **host permissions** allow reading `url`/`title` for matching tabs without the broad **`tabs`** permission |
| `chrome.runtime.*` | Messaging, extension pages | Always available |
| `chrome.permissions.request` | Optional Google/OpenAI hosts | Requests optional hosts only when needed |

**Important for reviewers:** Without the **`tabs`** permission and without host access to other origins, TubeStack **cannot** read tab URLs/titles on arbitrary non-YouTube sites.

---

## Intentionally not declared

| Permission / pattern | Reason |
|---------------------|--------|
| `history` | Not needed; TubeStack does not read browsing history |
| `tabs` | Avoids broad tab access; YouTube scope covered by host permissions |
| `windows` | Not needed; tab operations use `chrome.tabs` |
| `<all_urls>` / `*://*/*` | Single-purpose YouTube tool |
| `webNavigation`, `cookies`, `debugger`, `bookmarks` | Unused |
| Context menus on all URLs | Menus limited to YouTube + extension icon |

---

## Content scripts — store / privacy disclosure

1. **Watch and Shorts pages** — Metadata on user save; progress ticks while a watch or Shorts tab is open (`videoProgress` / `watchByDay`). Full progress on `/watch`; **best-effort** on Shorts. No Chrome History API.
2. **Subscription / channels feed** — Scrapes visible channel names when the user triggers import/sync; may scroll to load rows.
3. **Non-YouTube sites** — No content scripts.

Align with [PRIVACY.md — Watch progress](PRIVACY.md#watch-progress-local-best-effort-on-shorts).

---

## Common reviewer questions

**Does TubeStack collect browsing history?**

No. It does not use the Chrome History permission or `chrome.history`. Progress is observed on open YouTube `/watch` tabs via a content script (best-effort on Shorts) and stored locally.

**Why `identity` if OAuth is optional?**

Chrome requires the `identity` permission for `launchWebAuthFlow`. Local library use does not require sign-in.

**Why `scripting` if you have content scripts?**

Fallback injection on specific YouTube tabs when saving or importing, if the manifest content script did not load (for example a tab opened before install).

**Why context menus on many context types (`page`, `link`, `video`, etc.)?**

So users can right-click a video link or the page on YouTube and still reach save actions. Menu entries are restricted to YouTube URL patterns.

**Does TubeStack access tabs on non-YouTube sites?**

Tab queries filter to YouTube watch and Shorts URLs. Without `tabs` permission and without host access to other origins, unrelated tab URLs cannot be read.

---

## Verify before upload

From the repo root:

```powershell
.\scripts\verify-privacy-permissions.ps1
node scripts/test-youtube-url.cjs
```

The privacy audit script fails if:

- `history`, `tabs`, or `windows` appear in `manifest.json`
- Broad host patterns (`*://*/*`, `<all_urls>`) appear
- `chrome.history` is used in code
- Context menus use all-URL `documentUrlPatterns`
- A declared permission has no matching API usage in `*.js`

Manual spot-check:

```powershell
rg "chrome\.history" . --glob "*.js"
```

---

## Keeping docs in sync

When changing `manifest.json`:

1. Update this file and [STORE_LISTING.md](STORE_LISTING.md).
2. Run `.\scripts\verify-privacy-permissions.ps1`.
3. Update [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) if verification steps change.
4. Update Chrome Web Store dashboard justification fields to match the shipped build.

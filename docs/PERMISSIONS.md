# TubeStack — permissions (Chrome Web Store)

This document matches **`manifest.json`** in this repository. TubeStack does **not** read the user’s Chrome browsing history.

## Declared permissions

| Permission | Purpose |
|------------|---------|
| `contextMenus` | Right-click actions to save YouTube tabs / open TubeStack |
| `identity` | Google OAuth when the user enables YouTube account features |
| `scripting` | Inject scripts on **YouTube** pages for metadata and progress |
| `storage` | Local library, playlists, settings, watch progress on device |
| `windows` | Save YouTube tabs in the **current window** (left/right/all) |

**Not declared:** `history`, `tabs`, `bookmarks`, `topSites`, `webNavigation`, or broad `<all_urls>` host access.

## Host permissions

| Host | Required |
|------|----------|
| `https://www.youtube.com/*` | Yes |
| `https://m.youtube.com/*` | Yes |
| `https://www.googleapis.com/*` | Optional (YouTube Data API / OAuth when user uses those features) |
| `https://api.openai.com/*` | Optional (OpenAI when user configures and runs AI features) |

## What TubeStack uses instead of History

- **Open tabs** (`chrome.tabs.query`) — only to save YouTube watch tabs the user chooses.
- **YouTube page content scripts** — titles, progress on the active watch page, optional channel list scrape on YouTube subscription pages.
- **Local storage** (`chrome.storage.local`) — `videoProgress`, `watchByDay`, library items.

No `chrome.history.search`, `getVisits`, or similar APIs.

## Verify before upload

From the repo root:

```powershell
.\scripts\verify-privacy-permissions.ps1
```

Or search manually: `chrome.history` should return **zero** matches; `manifest.json` should not list `"history"`.

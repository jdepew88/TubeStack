# TubeStack Privacy Policy

**Last updated:** July 2026

**Chrome Web Store listing:** Publish the HTML copy at [`privacy/privacy.html`](../privacy/privacy.html) to a public HTTPS URL and paste that URL in the developer dashboard. The extension links to the bundled copy from the popup and Settings.

**Source repository:** [github.com/jdepew88/TubeStack](https://github.com/jdepew88/TubeStack)

This policy describes how the **TubeStack** Chrome Extension handles information when you use it. It is written in plain English for the Chrome Web Store listing and for anyone using the extension.

The hosted HTML version at [`privacy/privacy.html`](../privacy/privacy.html) is the canonical policy for store submission. This Markdown file is the expanded source copy for the repository.

---

## What TubeStack is

**TubeStack is a Chrome Extension** (Manifest V3) that runs in your browser. It helps you save and organize YouTube watch and Shorts tabs, build a local video library, and optionally use YouTube’s APIs and an AI provider (OpenAI or Anthropic) for advanced features you configure yourself.

**TubeStack is not affiliated with YouTube, Google, OpenAI, or Anthropic.** Those are separate companies with their own terms and privacy policies.

---

## Chrome Web Store Limited Use disclosure

TubeStack’s use of information received from Google APIs and of user data handled in the extension complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the **Limited Use** requirements. TubeStack uses permissions and data only to provide or improve its single purpose—saving, organizing, and reopening YouTube watch and Shorts tabs in a local library. TubeStack does **not** sell user data, does **not** use user data for personalized or interest-based advertising, and does **not** transfer user data to third parties except when **you** explicitly use optional Google or OpenAI features (requests go directly to those services), or when required by law or for security.

## In-product consent

Before TubeStack saves YouTube tabs or records local watch progress, you must accept a short privacy notice in the extension popup or setup wizard. That notice summarizes local storage of library data and progress on this device. You can open the full policy anytime from the popup or Settings.

## Local-first design

TubeStack is **local-first**. Most of what you see in TubeStack—including saved tabs, playlists, categories, tags, notes, and locally tracked watch progress—is stored **locally in your browser** using Chrome extension storage (`chrome.storage.local`), not on a TubeStack-owned server. The **`unlimitedStorage`** permission raises the local storage quota so larger libraries can remain on-device.

TubeStack has **no central backend** that collects or stores your library, API keys, or OAuth tokens for TubeStack’s own purposes.

---

## What is stored on your device

Depending on how you use TubeStack, the extension may store locally, among other things:

- **Saved YouTube tabs and library items** — titles, channels, URLs, watch states, tags, notes, and related fields you add in the app.
- **Local playlists and organization data** — stack notes, research summaries, and decision logs.
- **Categories, themes, tags, and similar labels** you use to organize your library.
- **Locally tracked watch progress** — on open YouTube `/watch` tabs (`videoProgress` and daily totals in `watchByDay`). On `/shorts` tabs, progress tracking is **best-effort** (**saving Shorts still works**). TubeStack does **not** use the Chrome History API.
- **Extension settings and UI preferences** — dashboard sidebar visibility, selected queue, color theme, import options, and similar configuration.

### Credentials stay on your device

- **YouTube Data API keys** — stored locally in Chrome extension storage (Settings or Setup Integrations).
- **YouTube OAuth Web Client IDs** — stored locally; Connect YouTube helps you set them up without sending credentials to TubeStack.
- **Google account email (optional)** — stored locally to help you remember which Google Cloud project your API key belongs to. Not sent to a TubeStack server.
- **OAuth access tokens** — kept **in the service worker’s memory only** (not in `chrome.storage.local`) until they expire or you choose **Sign out of Google** in Settings.
- **OpenAI and Anthropic API keys** — stored locally in Chrome extension storage, together with your selected AI provider and model.
- **AI undo point** — the category list and per-video category from just before your most recent AI categorization or category rebuild, so you can restore it. Replaced by the next run; removed when you delete your library.

---

## Network requests and third parties

### Google / YouTube (optional)

**YouTube and Google API calls only happen when you configure and use those optional features** (API lookups, playlist operations, OAuth sign-in). Requests go **directly from the extension to Google’s services**. TubeStack does not route those requests through a TubeStack-owned server.

### AI categorization: OpenAI or Anthropic (optional)

TubeStack remains local-first; AI categorization is optional. In **Settings → AI categorization** you choose one provider — **OpenAI** or **Anthropic (Claude)** — and TubeStack contacts it **only when you explicitly run an AI tool** (AI categorize, an AI category rebuild, Watch State suggestions, or **Test connection**). TubeStack does **not** send your library to either provider in the background.

- If **OpenAI** is selected, the metadata needed for that operation is sent **directly** to OpenAI (`api.openai.com`) with your OpenAI API key.
- If **Anthropic** is selected, the metadata needed for that operation is sent **directly** to Anthropic (`api.anthropic.com`) with your Anthropic API key.
- Metadata is limited to what TubeStack already stored for the videos you chose (title, channel, list category, tags, the video’s own note, Watch State, a short description snippet, current category) plus your category names. Transcripts, watch URLs, browsing history, unrelated playlists, Google API keys, and OAuth tokens are **not** sent.
- API keys are stored locally in Chrome extension storage and are sent only to the provider they belong to, in request headers. Usage is billed to **your** provider account; TubeStack cannot see your balance.
- AI results are previewed first. Categories and Watch States change only after you confirm (**Apply Changes** / **Apply**), and the last applied AI categorization can be undone.

---

## Chrome side panel (queue sidebar)

TubeStack includes an **optional queue sidebar** in Chrome’s side panel (`sidebar/sidebar.html`). The toolbar icon **always** opens the save popup; the side panel opens only when you click **Open queue sidebar** in that popup.

In the sidebar you can:

- Select a **local queue** (playlist) and **add YouTube tabs** from the current window.
- **Drag to reorder** videos in the queue (order is saved locally via `TUBESTACK_REORDER_LOCAL_PLAYLIST_ITEMS`).
- **Play** — open the queue **one video at a time** in a single tab; when a video finishes, the next opens automatically (resume on `/watch` when TubeStack has tracked it; best-effort on Shorts).
- **Shuffle** — reorder the queue locally, then play through one video at a time the same way.

The sidebar uses the same **local library and playlists** as the dashboard. It communicates with the extension service worker via `chrome.runtime` messaging and reads/writes `chrome.storage.local` through existing APIs. It does **not** add host permissions, content scripts, or network calls to a TubeStack server.

---

## Watch progress

TubeStack does **not** request Chrome History permission and does **not** scan unrelated browsing history.

TubeStack can **locally record playback progress** for YouTube videos in open tabs while the extension is installed:

- **`/watch` tabs** — full progress tracking (resume position, remaining time estimates, Focused Playlists).
- **`/shorts` tabs** — **best-effort** progress tracking because the Shorts player may not expose stable duration metadata. **Saving Shorts tabs** still captures title, channel, URL, thumbnail, and video id when the page allows.

Progress is stored locally in `videoProgress` and `watchByDay`.

Progress may come from:

- **Observed playback** on open tabs (`content/youtube-progress.js` heartbeats). On Shorts, heartbeats are sent when a video id and playhead are available (duration optional).
- **Capture on save** when you save tabs (playhead read from the page when available).
- **URL timestamps** when a saved watch-tab URL includes a `t=` start time.

TubeStack does **not** reconstruct what you watched before install or on sites other than YouTube watch and Shorts pages.

---

## Permissions and page access

TubeStack declares **`contextMenus`**, **`identity`**, **`scripting`**, **`sidePanel`**, **`storage`**, and **`unlimitedStorage`**, plus **YouTube host permissions** at install time. **Google APIs**, **OpenAI** (`api.openai.com`), and **Anthropic** (`api.anthropic.com`) are **optional host permissions** requested at runtime when you use those features.

TubeStack does **not** request Chrome History, the broad **`tabs`** permission, **`windows`**, or **`<all_urls>`**.

| Page type | What runs | User control |
|-----------|-----------|--------------|
| YouTube `/watch` and `/shorts` | Metadata on save; local progress while tab is open (full on `/watch`, best-effort on Shorts) | Saving is explicit; progress only on open tabs |
| YouTube subscription / channel feeds | Reads visible channel names when you run import or sync | User-initiated |
| Other websites | No content scripts; no context-menu save | N/A |

For a permission-by-permission breakdown, see **[PERMISSIONS.md](PERMISSIONS.md)**.

---

## What TubeStack does not do

- Does **not** request Chrome History permission.
- Does **not** request the broad **`tabs`** permission (YouTube tab access is scoped via YouTube host permissions only).
- Does **not** request **`windows`** or **`<all_urls>`**.
- Does **not** scan unrelated browsing history.
- Does **not** sell user data.

---

## Your choices and deleting data

You can **delete local TubeStack data** from Settings in the dashboard:

| Action | Removes | Keeps (unless you use other buttons) |
|--------|---------|--------------------------------------|
| **Delete saved videos, progress & local playlists** | Library videos, `videoProgress`, `watchByDay`, local playlist snapshots, related import/scan summary fields | API keys, OAuth Client ID, categories/themes, Subbed Channels list, UI preferences |
| **Sign out of Google** | In-memory OAuth access token | Saved OAuth Client ID |
| **Uninstall extension** | All extension local storage | N/A |

You can also clear API keys, clear AI cache, and clear the Subbed Channels list separately from Settings.

Clearing data in TubeStack does not delete your Google, OpenAI, or Anthropic accounts or change those companies’ API usage records.

---

## Changes to this policy

If TubeStack’s data practices change in a meaningful way, this document and [`privacy/privacy.html`](../privacy/privacy.html) should be updated and reflected in the Chrome Web Store listing.

---

## Contact

For privacy questions about **TubeStack**, use the contact or support channel in the Chrome Web Store listing or the project repository:

**https://github.com/jdepew88/TubeStack**

For **Google**, **YouTube**, **OpenAI**, or **Anthropic** data practices, refer to those companies’ official policies.

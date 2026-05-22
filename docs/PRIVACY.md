# TubeStack — Privacy policy

**Last updated:** May 2026

This policy describes how the **TubeStack** Chrome Extension handles information when you use it. It is written in plain English for Chrome Web Store listing and for anyone using the extension.

---

## What TubeStack is

**TubeStack is a Chrome Extension** (Manifest V3) that runs in your browser. It helps you save and organize YouTube watch tabs, build a local video library, and optionally use YouTube’s APIs and OpenAI for extra features.

**TubeStack is not affiliated with YouTube, Google, or OpenAI.** Those are separate companies with their own terms and privacy policies.

---

## Local-first design

**TubeStack is local-first.** Most of what you see in TubeStack—saved tabs, folders/playlists, categories, tags, notes, and locally tracked watch progress—is stored **locally in your browser** using Chrome’s extension storage (for example `chrome.storage.local`), not on a TubeStack-owned server.

**TubeStack has no central backend server** that collects or stores your library, API keys, or OAuth tokens for TubeStack’s own purposes.

---

## What is stored on your device

Depending on how you use TubeStack, the extension may store locally, among other things:

- **Saved YouTube tabs and library items** (titles, channels, URLs, **Watch States**, **tags**, video notes, timestamp notes, and related fields you add in the app).
- **Playlists and organization data** you create inside TubeStack (including local playlist snapshots, **stack notes**, **research summaries**, and **decision logs**).
- **Categories, themes, tags, Watch States, and similar labels** you use to organize your library.
- **Locally tracked watch progress** for YouTube videos you watch in YouTube tabs **while TubeStack is installed** — for example `playheadSec`, `durationSec`, `totalWatchedSec`, `updatedAt`, and daily totals in `watchByDay`. TubeStack observes open YouTube watch pages via its content scripts; it does **not** use the Chrome History API.
- **Extension settings** (for example sidebar preferences, import options, and similar configuration).

**Credentials stay on your device:**

- **YouTube Data API keys** you enter are stored locally in Chrome extension storage.
- **YouTube OAuth** configuration (such as your OAuth Web Client ID) and **OAuth access tokens** used for signed-in Google features are handled **on your device**.
- **OpenAI API keys** you enter are stored locally in Chrome extension storage.

---

## Network requests and third parties

### Google (YouTube)

**YouTube and Google API calls only happen when you enable or use YouTube API / OAuth features** (for example API lookups, playlist operations, or OAuth sign-in). Requests go **directly from the extension to Google’s services**, subject to your browser and Chrome’s permission prompts. TubeStack does not route those requests through a TubeStack-owned server.

### OpenAI

**OpenAI API calls only happen when you enable or use optional AI features** (for example AI-assisted categorization). Requests go **directly from the extension to OpenAI’s API** (`api.openai.com`), using your OpenAI API key only when you have provided one and only for those user-initiated actions.

**AI categorization** and **AI Watch State suggestions** may send **selected video metadata** the feature needs to work—for example titles, channel names, tags, notes, current Watch State, and related fields the extension already has in your **saved library**. Watch States and tags are kept separate; AI does not overwrite your Watch States unless you confirm an apply step.

---

## Watch progress (local, YouTube pages only)

TubeStack does **not** request Chrome History permission and does **not** scan unrelated browsing history. TubeStack can **locally record playback progress** for YouTube videos watched in YouTube tabs while the extension is installed, so it can preserve resume position, estimate remaining time, and build Focused Playlists. This playback progress is stored locally in Chrome extension storage (`videoProgress` and `watchByDay`).

Progress may come from:

- **Observed playback** on open watch tabs (`content/youtube-progress.js` heartbeats)
- **Capture on save** when you save/close tabs (playhead read from the page when available)
- **URL timestamps** when a saved tab URL includes a `t=` start time

TubeStack does **not** reconstruct what you watched before install or on sites other than YouTube watch pages.

---

## What TubeStack does not do

- **TubeStack does not request the Chrome History permission.**
- **TubeStack does not scan unrelated browsing history.**
- **TubeStack does not sell user data.**

---

## Your choices and deleting data

You can **delete local TubeStack data** from the extension’s **Settings / dashboard**, including actions to clear your saved library, API keys, OAuth session cache, OpenAI key, AI-related local cache, and similar controls where provided.

You can also remove all extension data by **uninstalling TubeStack** from Chrome.

Clearing data in TubeStack does not delete your Google or OpenAI accounts or change those companies’ records of API usage on their side; it removes what this extension keeps locally (and in-memory session data where applicable).

---

## Changes to this policy

If TubeStack’s data practices change in a meaningful way, this document should be updated and reflected in the Chrome Web Store listing. Continued use of the extension after an update means you accept the updated policy.

---

## Contact

For privacy questions about **TubeStack the extension**, use the contact or support channel provided in the Chrome Web Store listing or project repository (if any).

For questions about **Google**, **YouTube**, or **OpenAI** data practices, refer to those companies’ official policies and account tools.

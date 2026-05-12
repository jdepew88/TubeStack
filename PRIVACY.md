# TubeStack — Privacy policy

**Last updated:** May 2026

This policy describes how the **TubeStack** Chrome Extension handles information when you use it. It is written in plain English for Chrome Web Store listing and for anyone using the extension.

---

## What TubeStack is

**TubeStack is a Chrome Extension** (Manifest V3) that runs in your browser. It helps you save and organize YouTube watch tabs, build a local video library, and optionally use YouTube’s APIs and OpenAI for extra features.

**TubeStack is not affiliated with YouTube, Google, or OpenAI.** Those are separate companies with their own terms and privacy policies.

---

## Local-first design

**TubeStack is local-first.** Most of what you see in TubeStack—saved queues, playlists, categories, tags, watch progress, and general settings—is stored **locally in your browser** using Chrome’s extension storage (for example `chrome.storage.local`), not on a TubeStack-owned server.

---

## What is stored on your device

Depending on how you use TubeStack, the extension may store locally, among other things:

- **Saved YouTube tabs and library items** (titles, channels, URLs, notes, and related fields you add in the app).
- **Playlists and organization data** you create inside TubeStack (including local playlist snapshots).
- **Categories, themes, tags, and similar labels** you use to organize your library.
- **Watch progress and related tallies** the extension tracks to support “resume later” and similar features.
- **Extension settings** (for example sidebar preferences, import options, and similar configuration).

**Credentials stay on your device:**

- **YouTube Data API keys** you enter are stored locally in extension storage.
- **YouTube OAuth** configuration (such as your OAuth Web Client ID) and **OAuth access tokens** used for signed-in Google features are handled **on your device** (tokens used for API calls are not sent to a TubeStack backend—see below).
- **OpenAI API keys** you enter are stored locally in extension storage.

TubeStack **does not operate a backend server that collects or stores your API keys, OAuth tokens, or your TubeStack library** for TubeStack’s own purposes.

---

## Network requests and third parties

### Google (YouTube)

When you use features that need Google (for example API lookups, playlist operations, or OAuth sign-in), **requests go directly from the extension to Google’s services** (such as the YouTube Data API and Google OAuth), subject to your browser and Chrome’s permission prompts.

TubeStack does not route those requests through a TubeStack-owned server.

### OpenAI

When you use **optional AI features** (for example AI-assisted categorization or similar tools), **requests go directly from the extension to OpenAI’s API** (`api.openai.com`), using your OpenAI API key only when you have provided one and only for those user-initiated actions.

**AI categorization** may send **selected video metadata** that the feature needs to work—for example titles, channel names, and related fields the extension already has locally—not your full browsing history as a separate “tracking” feed.

---

## What TubeStack does not do

- **TubeStack does not sell user data.**
- **TubeStack does not collect unrelated browsing history** as a general analytics or profiling product. Features that touch history or Google data are tied to specific actions you take in the extension (and Chrome’s own permission model), not to selling a log of everywhere you browse.

---

## Your choices and deleting data

You can **remove stored data from TubeStack’s Settings / dashboard**, including actions to clear your saved library, API keys, OAuth session cache, OpenAI key, AI-related local cache, and similar controls where provided.

Clearing data in TubeStack does not delete your Google or OpenAI accounts or change those companies’ records of API usage on their side; it removes what this extension keeps locally (and in-memory session data where applicable).

---

## Changes to this policy

If TubeStack’s data practices change in a meaningful way, this document should be updated and reflected in the Chrome Web Store listing. Continued use of the extension after an update means you accept the updated policy.

---

## Contact

For privacy questions about **TubeStack the extension**, use the contact or support channel provided in the Chrome Web Store listing or project repository (if any).

For questions about **Google**, **YouTube**, or **OpenAI** data practices, refer to those companies’ official policies and account tools.

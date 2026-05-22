# TubeStack — Chrome Web Store listing (submission readiness)

Use this document when filling out the Chrome Web Store developer dashboard (listing text, permission justifications, and privacy fields). Keep wording aligned with `manifest.json` and **[PRIVACY.md](PRIVACY.md)**.

**Note:** The store imposes strict character limits (especially the **short description**, typically **132 characters**). Count before pasting; trim if the dashboard rejects the text.

---

## Extension name

**TubeStack**

---

## Short description (suggested — verify length ≤ 132)

**Suggested (132 chars max):**

> Save YouTube tabs into a local library—organize, resume progress, focus sessions. Optional YouTube API, OAuth & OpenAI on your device.

*(If you need a shorter line, drop the last sentence or shorten “Optional” to “Opts.” per your remaining budget.)*

---

## Detailed description (store listing body)

**TubeStack** is a Chrome extension for people who keep many **YouTube** watch tabs open. It helps you **save open YouTube tabs** into a **local** playlist-style library, **close** those tabs to free memory, and **restore** videos later—often with **watch progress** preserved when the page allows it.

Inside the **dashboard**, you can **organize** saved videos with **lists**, **themes / categories**, **tags**, **notes**, and **priority**. You can build **local playlists**, use **focus-session** tools, and work through queues without losing context.

**Optional integrations (your choice):**

- **YouTube Data API key (optional):** If you add a key, TubeStack can **import** and **analyze** public metadata (for example channel or catalog helpers) directly from **Google**—see host permissions below.
- **YouTube OAuth (optional):** If you add a Google OAuth **Web application** client ID, you can sign in to Google **from the extension** for features that need your **YouTube account** (for example creating playlists or syncing subscription lists). Tokens are used **between your browser and Google**; TubeStack does **not** operate a backend that stores your Google password or OAuth tokens for its own servers.
- **OpenAI (optional):** If you add an OpenAI API key, **AI-assisted** tools can run **only when you use them**. Requests go **directly** from the extension to **OpenAI**; they may include **selected video metadata** (for example titles and channel names) needed for categorization—not a separate log of all sites you visit.

**Privacy in one line:** TubeStack is **local-first**. Your saved library, playlists, progress, and settings live in **extension storage on your device**. **TubeStack does not request Chrome History permission and does not scan unrelated browsing history.** TubeStack **does not sell** your data. For the full policy, see **[PRIVACY.md](PRIVACY.md)**.

**Disclaimers:** TubeStack is **not affiliated with**, **endorsed by**, or **sponsored by** **YouTube**, **Google**, or **OpenAI**. YouTube and Google trademarks belong to their owners. You are responsible for complying with YouTube’s Terms of Service, Google API/OAuth policies, and OpenAI’s terms when you use those services.

---

## Single-purpose explanation

TubeStack has **one clear purpose:** to help users **save, organize, and reopen YouTube watch tabs and related metadata** inside Chrome, with an optional **local library** and optional **user-configured** connections to **Google (YouTube API / OAuth)** and **OpenAI** for advanced workflows. It is **not** a general-purpose web monitor, ad blocker, or unrelated browsing tracker.

---

## Permission justifications

Use these in the **“Permission justification”** fields (paraphrase if the form requires shorter text).

| Permission | Why TubeStack needs it |
|------------|-------------------------|
| **contextMenus** | Adds **right-click menu items** so you can save YouTube tabs or open the TubeStack dashboard without hunting for buttons. |
| **identity** | Uses Chrome’s **identity API** for **Google OAuth** when you enable features that require signing in to your YouTube/Google account. |
| **scripting** | Lets the extension **inject** small scripts on **YouTube** pages when needed to **read page-visible metadata** (for example titles or progress hints) to support save/restore and local organization. |
| **storage** | Persists your **local library**, playlists, settings, and progress in **Chrome extension storage** (`chrome.storage.local` / related APIs)—**on your device**. |
| **windows** | Reads **open tabs in the current window** so TubeStack can **save YouTube watch tabs** by position (for example “tabs to the left/right”) in a predictable way. |

TubeStack **does not request Chrome History permission** and **does not scan unrelated browsing history**.

---

## Host permission justifications

### Required host permissions

| Host pattern | Why TubeStack needs it |
|--------------|-------------------------|
| **`https://www.youtube.com/*`** | Core functionality runs on **YouTube**: saving tabs, opening the dashboard flow, content helpers on YouTube pages, and organizing what you saved. |
| **`https://m.youtube.com/*`** | Same support for **mobile YouTube** URLs that Chrome may use. |

### Optional host permissions

| Host pattern | Why it is optional |
|--------------|---------------------|
| **`https://www.googleapis.com/*`** | Used **only when** you use features that call **Google APIs** (for example **YouTube Data API v3** with your own API key, or OAuth-backed calls). Chrome can grant this **at runtime** when a feature needs it—not silently in the background for unrelated sites. |
| **`https://api.openai.com/*`** | Used **only when** you configure an **OpenAI API key** and run **optional AI features**. Requests go **directly** to OpenAI from your browser context. |

---

## Data usage explanation (for “Data usage” / privacy questions)

- **What is collected:** TubeStack **does not** send your full library to a **TubeStack-operated server**. Data you generate (saved videos, playlists, categories, tags, notes, progress, settings) is stored **locally** in the browser unless **you** trigger a call to **Google** or **OpenAI** for an optional feature.
- **What may leave the device:** (1) **Google** — when you use API/OAuth features, requests go **from the extension to Google**. (2) **OpenAI** — when you run AI tools, **selected metadata** needed for that action may be sent **from the extension to OpenAI** using **your** API key.
- **Selling / ads:** TubeStack **does not sell** personal data and is **not** an advertising product.
- **Deletion:** Users can **delete stored data** from **Settings** in the extension (library, keys, session cache, AI cache, etc., as provided in the UI). See **[PRIVACY.md](PRIVACY.md)** for plain-language detail.

---

## OAuth explanation (for Google / OAuth disclosure fields)

TubeStack supports **optional Google OAuth** so **you** can sign in to your **Google account** for **YouTube-related actions** the extension performs **at your request** (for example creating a playlist on your channel or listing subscriptions when you sync).

- You provide a **Google OAuth 2.0 Web application Client ID** in settings if you want these features.
- **Sign-in is interactive** (you see Google’s consent screen) when a feature needs it.
- **Access tokens** are used **between your browser and Google’s APIs**; TubeStack **does not** route OAuth traffic through a TubeStack-owned backend for credential harvesting.
- **Revocation / cleanup:** You can **sign out** (clear the extension’s session cache) and **remove** the saved Client ID from Settings; you can also revoke the app in your **Google Account** security settings at any time.

**Scope note for your OAuth consent screen:** TubeStack may request a **YouTube-related OAuth scope** broad enough to cover both **read** and **write** operations the app offers (for example playlist creation). Describe only what your published build actually uses, in line with Google’s policy.

---

## OpenAI explanation

OpenAI is **optional**. If you paste an **OpenAI API key** into TubeStack:

- The key is stored **locally** in extension storage on your device.
- Network calls go **directly** from the extension to **`https://api.openai.com`** when **you** run a feature that needs a model (for example **AI categorization** or a **connection test**).
- **AI categorization** may send **selected fields** from videos already in your library (such as **title**, **channel**, and **tags/notes** you have)—enough for the model to suggest categories. It uses only metadata TubeStack already stored locally.

You can **remove the key** and **clear local AI cache** from Settings. OpenAI’s retention and logging are governed by **OpenAI’s** policies and your account settings there.

---

## Local-first privacy summary

- **Default posture:** Your **TubeStack library** and **organization data** stay **on-device** in Chrome storage.
- **No TubeStack backend for your library:** TubeStack is **not** designed to upload your saved queue to a first-party TubeStack server for storage or resale.
- **Third parties only when you opt in:** **Google** and **OpenAI** are contacted **because you enabled** API keys, OAuth, or a feature that needs them.

Full policy: **[PRIVACY.md](PRIVACY.md)**.

---

## Disclaimers (YouTube / Google / OpenAI)

Copy as needed into the listing or “Additional information”:

- **TubeStack is not affiliated with, endorsed by, or sponsored by YouTube, Google LLC, or OpenAI.**  
- **YouTube** and **Google** are trademarks of Google LLC.  
- **OpenAI** is a trademark of OpenAI, L.P. (or its affiliates), used here only to describe optional integration.  
- Users must comply with **YouTube Terms of Service**, **Google API Services User Data Policy** (and OAuth verification rules if applicable), and **OpenAI** usage policies when using those services.

---

## Checklist before submission

- [ ] Short description within Chrome’s character limit.  
- [ ] Screenshots and promotional images prepared.  
- [ ] Privacy policy URL points to **`docs/PRIVACY.md`** (hosted where the store can fetch HTTPS) or an equivalent page.  
- [ ] OAuth consent screen (Google Cloud) matches the scopes and branding you describe.  
- [ ] `manifest.json` version bumped for the build you upload.  
- [ ] Permission justifications in the dashboard match the **actual** shipped build.

# TubeStack Release Checklist (Chrome Web Store)

Use this before uploading a build to the Chrome Web Store or tagging a release. Check boxes as you complete each item.

**Related docs:** [PRIVACY.md](PRIVACY.md) · [PERMISSIONS.md](PERMISSIONS.md) · [STORE_LISTING.md](STORE_LISTING.md) · [README.md](../README.md)

---

## Security and policy compliance

- [ ] **No real secrets committed**
  - No production API keys, OAuth client secrets, or `.env` files with live credentials
  - Run a final search for `AIza`, `sk-`, client secrets, and private keys

- [ ] **Privacy audit script passes**
  - From repo root: `.\scripts\verify-privacy-permissions.ps1`
  - See [PERMISSIONS.md](PERMISSIONS.md)

- [ ] **YouTube URL helpers**
  - `node scripts/test-youtube-url.cjs` passes (watch + Shorts URL parsing)

- [ ] **Permissions reviewed**
  - `manifest.json` matches [PERMISSIONS.md](PERMISSIONS.md)
  - **Approved install-time permissions (manifest only):** `contextMenus`, `identity`, `scripting`, `sidePanel`, `storage`
  - **Forbidden:** `history`, `tabs`, `windows`, `<all_urls>` — must not appear in `manifest.json`
  - Store dashboard justification for `sidePanel` pasted from [PERMISSIONS.md](PERMISSIONS.md) / [STORE_LISTING.md](STORE_LISTING.md)

- [ ] **Host permissions minimized**
  - Required: `youtube.com`, `m.youtube.com` only
  - Optional: `www.googleapis.com`, `api.openai.com` (runtime grant)

- [ ] **Context menus scoped**
  - Save menus on **YouTube URLs only**
  - “Open dashboard” on **extension icon** only
  - Confirm in `background/service-worker.js` (`TUBESTACK_CTX_YT`)

- [ ] **Content scripts scoped**
  - Watch, Shorts, and subscription YouTube paths only
  - No scripts on non-YouTube sites (see `manifest.json` `content_scripts`)

- [ ] **No Chrome History permission**
  - `manifest.json` does **not** include `"history"`

- [ ] **No `chrome.history` usage**
  - Grep returns **zero** matches in `*.js`

- [ ] **Store and privacy copy aligned**
  - [STORE_LISTING.md](STORE_LISTING.md), [PERMISSIONS.md](PERMISSIONS.md), [PRIVACY.md](PRIVACY.md), and [`privacy/privacy.html`](../privacy/privacy.html) match the shipped build

- [ ] **No remote executable code**
  - MV3 packaging matches Chrome policy

- [ ] **No `eval` / `new Function`**
  - Grep the codebase; neither used for extension behavior

---

## OAuth and Google

- [ ] **OAuth works**
  - Sign-in, token refresh (if applicable), and error handling verified

- [ ] **Redirect URI matches extension ID**
  - Google Cloud authorized redirect URIs match `https://<extension-id>.chromiumapp.org/`
  - Re-check after unpacked dev vs Chrome Web Store ID change

- [ ] **Production OAuth ID pending unlisted upload**
  - Production OAuth finalized after first store upload provides permanent extension ID

- [ ] **Test users configured**
  - While OAuth app is in Testing, all tester accounts are added

---

## Disclosures, privacy, and data

- [ ] **OpenAI disclosure present**
  - Store listing and in-extension copy state optional AI may send selected video metadata to OpenAI

- [ ] **Privacy policy present**
  - [`privacy/privacy.html`](../privacy/privacy.html) is valid standalone HTML and matches [PRIVACY.md](PRIVACY.md)
  - Host on HTTPS (example: `https://jdepew88.github.io/TubeStack/privacy/privacy.html`)
  - **Do not** use `docs/PRIVACY.md` as the store URL (GitHub Pages serves it as raw Markdown)

- [ ] **Privacy link in extension**
  - Popup footer and Settings → Data & privacy link to bundled policy page

- [ ] **Data deletion controls tested**
  - Delete library, clear API keys, OAuth sign-out, OpenAI key removal, AI cache clear

- [ ] **Local storage cleared successfully**
  - After deletion actions, verify `chrome.storage.local` reflects expected removals

---

## Documentation and listing

- [ ] **README updated**
  - Privacy summary links to [PRIVACY.md](PRIVACY.md) and store URL to [`privacy/privacy.html`](../privacy/privacy.html)
  - Permissions summary links to [PERMISSIONS.md](PERMISSIONS.md)

- [ ] **STORE_LISTING.md prepared**
  - Descriptions and justifications copied into store dashboard; character limits verified

- [ ] **Disclaimers present**
  - TubeStack not affiliated with YouTube, Google, or OpenAI

---

## Assets and packaging

- [ ] **Screenshots do not expose secrets**
  - No API keys, tokens, or private playlists visible

- [ ] **Extension loads unpacked successfully**
  - No manifest errors; service worker starts without crash loops

---

## Functional QA (manual)

- [ ] **Core save / restore flow**
  - Save watch and Shorts tabs (popup, context menu, dashboard)
  - Confirm library items and correct watch/Shorts URLs on restore
  - Full progress on `/watch`; best-effort on Shorts

- [ ] **Sidebar (side panel) queue**
  - Toolbar icon opens the **popup first** (save actions); side panel does not replace it
  - **Open queue sidebar** in the popup opens the side panel
  - Sidebar loads and shows the queue dropdown
  - Queue selection switches the visible video list
  - **Add window tabs** appends YouTube tabs from the current window to the selected queue
  - **Drag reorder** updates and persists queue order
  - **Play** (continue playing) opens one video at a time; sidebar shows now playing and strikethrough for finished videos; next video auto-advances when the current one ends
  - **Shuffle** reorders the queue locally, then plays through one video at a time with the same sidebar progress UI

- [ ] **AI categorization (small batch)**
  - Test with a small set and test OpenAI key; confirm metadata sent matches disclosure

- [ ] **YouTube playlist creation**
  - OAuth path creates playlist on intended account with expected visibility

---

## Final submission

- [ ] **Version bumped** — `manifest.json` `version` incremented appropriately
- [ ] **Zip matches repo** — Packaged folder is the same tree you tested
- [ ] **Store justification fields** — Paste from [STORE_LISTING.md](STORE_LISTING.md) and [PERMISSIONS.md](PERMISSIONS.md), including `sidePanel`
- [ ] **Privacy policy URL** — `privacy/privacy.html` on HTTPS, not `docs/PRIVACY.md`

---

## Sign-off

| Role | Name | Date |
|------|------|------|
| Prepared by | | |
| Reviewed by | | |

# TubeStack — Release checklist (Chrome Web Store)

Use this before uploading a build to the Chrome Web Store or tagging a release. Check boxes as you complete each item.

**Related docs:** [PRIVACY.md](PRIVACY.md) · [STORE_LISTING.md](STORE_LISTING.md) · [README.md](../README.md)

---

## Security & policy compliance

- [ ] **No real secrets committed** — Repo has no production API keys, OAuth client secrets, or `.env` files with live credentials. `.gitignore` covers common secret paths; run a final search for `AIza`, `sk-`, client secrets, and private keys.
- [ ] **Permissions reviewed** — `manifest.json` `permissions` and `optional_host_permissions` match what the shipped build uses; remove anything unused.
- [ ] **No Chrome History permission** — `manifest.json` does **not** include `"history"` in `permissions` or `optional_permissions`.
- [ ] **No `chrome.history` usage** — Repo-wide search for `chrome.history` returns **zero** results.
- [ ] **Store & privacy copy** — [STORE_LISTING.md](STORE_LISTING.md) and [PRIVACY.md](PRIVACY.md) do **not** imply unrelated browsing history collection; they state TubeStack does **not** request Chrome History permission.
- [ ] **Host permissions minimized** — Required hosts limited to what the extension needs (e.g. YouTube); optional hosts (`www.googleapis.com`, `api.openai.com`) remain optional and justified in [STORE_LISTING.md](STORE_LISTING.md).
- [ ] **No remote executable code** — No remotely loaded scripts executed as extension logic; MV3 packaging matches Chrome policy.
- [ ] **No `eval` / `new Function`** — Grep the codebase and bundled assets; neither is used for extension behavior (or justify/document any unavoidable exception—prefer none).

---

## OAuth & Google

- [ ] **OAuth works** — Sign-in, token refresh (if applicable), and error handling verified for the OAuth Client ID you ship instructions for.
- [ ] **Redirect URI matches extension ID** — In Google Cloud Console, authorized redirect URIs match **this** build’s extension ID (`chrome-extension://<id>/...` per Chrome identity docs). Re-check after any ID change (new unpack path, published ID vs dev ID).
- [ ] **Test users configured** — While the OAuth app is in **Testing** (or equivalent), all tester Google accounts are added; production path documented if using **In production** with verification.

---

## Disclosures, privacy, and data

- [ ] **OpenAI disclosure present** — Store listing and/or in-extension copy states that optional AI features may send **selected video metadata** to OpenAI; [STORE_LISTING.md](STORE_LISTING.md) and [PRIVACY.md](PRIVACY.md) aligned with actual behavior.
- [ ] **Privacy policy present** — [PRIVACY.md](PRIVACY.md) is complete; a **hosted HTTPS URL** (or GitHub raw/pages link the store accepts) is ready for the dashboard “Privacy policy” field.
- [ ] **Data deletion controls tested** — Settings actions for deleting library data, clearing API keys, OAuth sign-out / Client ID removal, OpenAI key removal, and AI cache clear were exercised and confirmed in the UI (with confirmations).
- [ ] **Local storage cleared successfully** — After deletion actions, verify `chrome.storage.local` (via devtools / extension storage inspector) reflects expected keys removed or emptied; no silent retention beyond what the policy describes.

---

## Documentation & listing

- [ ] **README updated** — Version highlights, install notes, and **Privacy summary** link to [PRIVACY.md](PRIVACY.md); any breaking setup steps (OAuth redirect, optional APIs) are current.
- [ ] **STORE_LISTING.md prepared** — Short/long descriptions, single-purpose text, and permission/host justifications are copied or adapted into the store dashboard; character limits verified.
- [ ] **Disclaimers present** — Listing and/or [PRIVACY.md](PRIVACY.md) state TubeStack is **not affiliated** with YouTube, Google, or OpenAI.

---

## Assets & packaging

- [ ] **Screenshots do not expose secrets** — No API keys, OAuth client secrets, tokens, email addresses, or private playlists visible in store screenshots or promo images.
- [ ] **Extension loads unpacked successfully** — Fresh `Load unpacked` on the release folder; no manifest errors; service worker starts without crash loops.

---

## Functional QA (manual)

- [ ] **Core save / restore YouTube tab flow tested** — Save tabs (popup/context menu/dashboard as applicable), confirm items in library, restore opens correct watch URLs; progress behavior spot-checked where supported.
- [ ] **AI categorization tested with small batch** — Run on a **small** set of items with a test OpenAI key; confirm results, errors, and that you are comfortable with metadata sent (per disclosure).
- [ ] **YouTube playlist creation tested** — OAuth path creates a playlist on the intended Google account; verify visibility (public/unlisted/private) matches expectation.

---

## Final submission

- [ ] **Version bumped** — `manifest.json` `version` incremented appropriately.
- [ ] **Zip matches repo** — Packaged folder is the same tree you tested (no stray dev files).
- [ ] **Store “Justification” fields** — Paste trimmed text from [STORE_LISTING.md](STORE_LISTING.md) where the dashboard asks for permission / data justifications.

---

## Sign-off

| Role | Name | Date |
|------|------|------|
| Prepared by | | |
| Reviewed by | | |

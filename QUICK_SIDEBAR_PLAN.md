# Quick Sidebar Mode — Implementation Plan

Status: **planning**. No feature code should be written until this plan is reviewed.

## Goal

Add an optional **Quick Sidebar Mode** that opens TubeStack's quick-save UI in Chrome's
built-in **side panel** instead of the toolbar popup. The sidebar mirrors the popup's save
actions and adds a live, read-only **Queue** list drawn from the local library.

Hard constraints (must hold):

- **Local-first only** — the panel reads/writes `chrome.storage.local` and uses the existing
  `TUBESTACK_*` runtime messages. No new network calls.
- **No YouTube API dependency** — the sidebar works with zero credentials, exactly like the popup.
- **Do not break the full dashboard** — changes are additive; `dashboard/*` is untouched.
- **No unnecessary permissions** — add exactly one API permission (`sidePanel`); no new host
  permissions, no content scripts, no `tabs`/`windows`/`history`.
- **Chrome Web Store review safety** — every permission is justified and audited by
  `scripts/verify-privacy-permissions.ps1`.

The mode **defaults OFF**, so out-of-the-box behavior (toolbar popup) is byte-for-byte unchanged.

### Key MV3 mechanic (the one real subtlety)

`action.default_popup` takes precedence over the side panel on toolbar click. So the toggle is:

- **OFF (default):** `chrome.action.setPopup({ popup: "popup/popup.html" })` +
  `setPanelBehavior({ openPanelOnActionClick: false })` → identical to today.
- **ON:** `chrome.action.setPopup({ popup: "" })` +
  `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` → clicking the icon
  opens the side panel.

The panel path is fixed by the manifest `side_panel.default_path`, so no per-tab `setOptions`
is needed.

---

## User flow

1. **Default state** — user clicks the toolbar icon → the standard popup opens (unchanged).
2. **Enable** — in the popup, user clicks **Pin as sidebar** → popup closes, mode is persisted ON.
3. **Use** — user clicks the toolbar icon → the side panel opens, showing:
   - Library count + per-window video-tab counts.
   - Save actions: Save all / Save all except current / Save all to the left / Save all to the right.
   - A **Queue** list (library items with `watchState === "queue"`), each row click-to-open.
   - Footer: **Open full dashboard** and **Use popup instead**.
4. **Disable** — user clicks **Use popup instead** in the sidebar → mode OFF, popup restored.
5. **Persistence** — the choice survives browser restarts and service-worker termination
   (re-applied on every worker wake and on `onInstalled`).

---

## Files to change

| File | Change |
|------|--------|
| `manifest.json` | Add `"sidePanel"` to `permissions`; add top-level `"side_panel": { "default_path": "sidebar/sidebar.html" }`. |
| `background/service-worker.js` | Add `applyQuickSidebarMode(enabled)`, `initQuickSidebarModeFromSettings()`, a `TUBESTACK_SET_QUICK_SIDEBAR_MODE` message case, and reactions in `onInstalled` + the existing `storage.onChanged` settings listener, plus a top-level init call. |
| `popup/popup.html` | Add a **Pin as sidebar** button to the footer. |
| `popup/popup.css` | Add a `.ftr .btn.ghost.ftr-wide { grid-column: 1 / -1; }` rule so the toggle wraps as a full-width row below the 3-column nav grid. |
| `popup/popup.js` | Add the `btnSidebar` element ref + click handler that sends `TUBESTACK_SET_QUICK_SIDEBAR_MODE { enabled: true }` and closes the popup. |
| `scripts/verify-privacy-permissions.ps1` | Add `sidePanel` to `$expectedPerms` and to the `$declared` map (`sidePanel = 'chrome\.sidePanel'`). |
| `docs/PERMISSIONS.md` | Add a `sidePanel` justification section + update the permissions JSON snippet. |

Optionally: add a manual smoke-test line to `docs/RELEASE_CHECKLIST.md` (verification commands do not change).

---

## New files to add

| File | Purpose |
|------|---------|
| `sidebar/sidebar.html` | Panel markup: header, save controls, status, queue section, footer. Loads `lib/ui-themes.css` + `sidebar.css`. |
| `sidebar/sidebar.css` | Panel styling. Reuses the same design tokens as the popup but laid out for a tall, scrollable panel (no fixed `width`/`max-height` like `popup.css`). |
| `sidebar/sidebar.js` | Reuses the popup's `send()`/save-handler pattern, renders the Queue from `TUBESTACK_GET_ITEMS`, wires the footer buttons, and binds `storage.onChanged` for live updates. Loads `lib/ui-themes.js` for theming. |

---

## Required manifest permissions

```jsonc
"permissions": ["contextMenus", "identity", "scripting", "sidePanel", "storage"]
```

- **`sidePanel`** — **new**, required to use `chrome.sidePanel.*` (declares the global panel via
  `side_panel.default_path` and toggles `setPanelBehavior`).
- `contextMenus`, `identity`, `scripting`, `storage` — **unchanged**.

No changes to:

- `host_permissions` (still only `youtube.com` / `m.youtube.com`).
- `optional_host_permissions` (still `googleapis.com` / `openai.com`).
- `content_scripts`.

The `sidePanel` permission is an **API permission**, not host access — it grants no ability to
read additional sites or tabs.

---

## Data model changes

Minimal: **one boolean added to the existing `settings` object in `chrome.storage.local`.**

```jsonc
// chrome.storage.local.settings
{
  // ...existing fields (uiThemePreset, onboardingComplete, currentPlaylistId, etc.)...
  "quickSidebarMode": false   // NEW. Absent/undefined === false (popup mode).
}
```

- Default is absent/false. No migration needed — `applyQuickSidebarMode` treats anything
  other than `true` as OFF.
- **No changes** to `items`, `themes`, `localPlaylists`, `videoProgress`, `watchByDay`,
  or `subscriptionChannels`.
- The sidebar only **reads** `items` (filtering `watchState === "queue"`) and the same
  `TUBESTACK_*` responses the popup already uses; it writes nothing new beyond the toggle.

---

## Implementation phases

Each phase is independently verifiable and can be a separate commit.

### Phase 1 — Manifest + permission plumbing
- Add `sidePanel` permission and `side_panel.default_path` to `manifest.json`.
- Update `scripts/verify-privacy-permissions.ps1` (`$expectedPerms` + `$declared`).
- Update `docs/PERMISSIONS.md` (snippet + `sidePanel` section).
- **Exit criteria:** audit script passes (it will, once `chrome.sidePanel` is referenced — see Phase 2).

### Phase 2 — Service worker wiring
- Implement `applyQuickSidebarMode(enabled)` (idempotent: `setPanelBehavior` + `setPopup`).
- Implement `initQuickSidebarModeFromSettings()`.
- Add `TUBESTACK_SET_QUICK_SIDEBAR_MODE` message (persist via `saveSettings`, then apply).
- Extend the existing `storage.onChanged` settings listener to re-apply on `quickSidebarMode`
  change (mirrors the onboarding listener pattern).
- Call `initQuickSidebarModeFromSettings()` at top level (every wake) and inside `onInstalled`.
- **Exit criteria:** `node --check background/service-worker.js` clean; audit script green.

### Phase 3 — Sidebar page
- Create `sidebar/sidebar.html`, `sidebar/sidebar.css`, `sidebar/sidebar.js`.
- Port the popup's save/count logic; add Queue rendering (top N items, click-to-open).
- Bind `storage.onChanged` to refresh the queue/library live.
- **Exit criteria:** `node --check sidebar/sidebar.js` clean; loads with no console errors.

### Phase 4 — Toggle entry points
- Add **Pin as sidebar** to the popup footer (`popup.html`/`popup.css`/`popup.js`).
- Add **Use popup instead** to the sidebar footer (part of Phase 3 markup, wired here).
- **Exit criteria:** toggling both directions works and persists.

### Phase 5 — Verify
- `node scripts/test-youtube-url.cjs`
- `pwsh scripts/verify-privacy-permissions.ps1`
- Manual QA (next section).

---

## Manual QA checklist

Automated tests cannot exercise the real panel; these must be run in Chrome with the unpacked
extension loaded.

- [ ] Fresh load, mode off: clicking the toolbar icon opens the **popup** (unchanged).
- [ ] Popup layout intact: 3 nav buttons + full-width **Pin as sidebar** row.
- [ ] Click **Pin as sidebar** → popup closes; status shows before close.
- [ ] Click toolbar icon → **side panel** opens to `sidebar/sidebar.html`.
- [ ] Side panel theme matches the selected UI preset (changes live when preset changes).
- [ ] Tab counts populate; save buttons enable/disable correctly (left/right/all/except).
- [ ] Each save action creates a session playlist and updates the status line; panel stays open.
- [ ] Queue list shows library items with `watchState === "queue"`; clicking a row opens the video.
- [ ] Queue updates live when the dashboard changes an item's watch state (storage sync).
- [ ] **Open full dashboard** opens the dashboard tab (most-recent playlist).
- [ ] **Use popup instead** restores popup mode; icon click opens the popup again.
- [ ] **Persistence:** toggle ON, restart Chrome → icon click still opens the panel
      (verifies worker-wake re-application of `setPanelBehavior`/`setPopup`).
- [ ] **Persistence:** toggle OFF, restart → popup restored.
- [ ] No new permissions prompt on install/update beyond the declared `sidePanel`.
- [ ] No `chrome.windows` / `chrome.history` / `tabs` permission introduced
      (`verify-privacy-permissions.ps1` still green).

---

## Chrome Web Store review notes

- **Single permission added: `sidePanel`.** It is an API permission enabling Chrome's side panel;
  it grants no host access and reads no additional sites. Justification is captured in
  `docs/PERMISSIONS.md` (short + long forms).
- **Defaults off.** Reviewers see the standard popup by default; the side panel only appears after
  an explicit user action. This minimizes perceived scope creep.
- **No new data collection or transmission.** The panel reuses existing local storage and runtime
  messaging; the privacy policy (`privacy/privacy.html` / `docs/PRIVACY.md`) needs no substantive
  change because the feature stores/transmits nothing new beyond a boolean UI preference.
- **No broad permissions.** Still no `tabs`/`windows`/`history`, no `<all_urls>`, no new host
  patterns — enforce with `verify-privacy-permissions.ps1` before upload.
- **Docs to keep in sync before submission:** `docs/PERMISSIONS.md`, `docs/STORE_LISTING.md`
  (mention Quick Sidebar Mode in the feature list), and `docs/RELEASE_CHECKLIST.md` (add the
  manual panel smoke-test). Re-run `verify-privacy-permissions.ps1` as the final gate.

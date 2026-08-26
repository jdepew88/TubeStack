const libraryLine = document.getElementById("libraryLine");
const countLine = document.getElementById("countLine");
const btnSaveLeft = document.getElementById("btnSaveLeft");
const btnSaveRight = document.getElementById("btnSaveRight");
const btnSaveAll = document.getElementById("btnSaveAll");
const btnSaveExcept = document.getElementById("btnSaveExcept");
const status = document.getElementById("status");
const btnDash = document.getElementById("btnDash");
const btnHome = document.getElementById("btnHome");
const btnLibrary = document.getElementById("btnLibrary");
const btnSidebar = document.getElementById("btnSidebar");

const saveButtons = [btnSaveLeft, btnSaveRight, btnSaveAll, btnSaveExcept].filter(Boolean);

/** Message timeout. Saving many tabs fetches metadata per tab, so this has to be generous. */
const SEND_TIMEOUT_MS = 90000;

/**
 * Resolves to a real object even when the channel dies. `chrome.runtime.sendMessage` invokes its
 * callback with `undefined` and sets `chrome.runtime.lastError` when the service worker goes away or
 * this page is torn down mid-flight; leaving that unchecked made a dropped response indistinguishable
 * from a genuine failure.
 */
function send(type, payload = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: "timeout", transportError: "timeout" }),
      SEND_TIMEOUT_MS
    );
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          finish({
            ok: false,
            error: lastError.message || "message_channel_closed",
            transportError: "lastError",
          });
          return;
        }
        if (res === undefined || res === null) {
          finish({ ok: false, error: "no_response", transportError: "empty" });
          return;
        }
        finish(res);
      });
    } catch (err) {
      finish({ ok: false, error: String(err?.message || err), transportError: "throw" });
    }
  });
}

function newOperationId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Human-readable outcome for a save operation result, including partial failures. */
function describeSaveResult(r, mode) {
  if (r?.nothingToSave) return r.message || "No YouTube tabs found in this window.";
  if (r?.error === "save_in_progress") return "A save is already running — give it a moment.";
  const kept = r?.keptOpenTabIds?.length || 0;
  const closed = r?.closedTabIds?.length || 0;
  if (r?.ok) {
    const base = labelForMode(mode, closed || r.confirmedCount || r.savedCount || 0);
    return r.playlistName ? `${base} Playlist: ${r.playlistName}.` : base;
  }
  if (r?.partial) {
    const reasons = [...new Set((r.failures || []).map((f) => f.reason))].join(", ");
    return `Saved ${closed}, but ${kept} tab${kept === 1 ? "" : "s"} left open — not confirmed saved (${reasons}). Nothing was lost; try again.`;
  }
  if (kept) {
    return `Save failed (${r?.error || "unknown"}). All ${kept} tab${kept === 1 ? "" : "s"} were left open.`;
  }
  return r?.error ? `Save failed: ${r.error}` : "Something went wrong. No tabs were closed.";
}

/** Open TubeStack in a new tab and close the toolbar popup (does not replace the active page). */
async function openExtensionInNewTabAndClose(path) {
  const url = chrome.runtime.getURL(path);
  await chrome.tabs.create({ url, active: true });
  window.close();
}

function dashboardPlaylistPath(playlistId) {
  const id = String(playlistId || "").trim();
  if (!id) return "dashboard/dashboard.html";
  return `dashboard/dashboard.html?playlist=${encodeURIComponent(id)}`;
}

async function resolveMostRecentPlaylistId() {
  const r = await send("TUBESTACK_GET_STATE");
  const lists = Array.isArray(r?.localPlaylists) ? r.localPlaylists : [];
  const fromSettings = String(r?.settings?.currentPlaylistId || "").trim();
  if (fromSettings && lists.some((x) => x.id === fromSettings)) return fromSettings;
  if (!lists.length) return null;
  const sorted = [...lists].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
  return sorted[0]?.id || null;
}

async function refreshLibraryLine() {
  const data = await chrome.storage.local.get("items");
  const n = Array.isArray(data.items) ? data.items.length : 0;
  libraryLine.textContent =
    n === 0 ? "Local library: empty" : `Local library: ${n} saved video${n === 1 ? "" : "s"}`;
}

async function refreshCount() {
  await refreshLibraryLine();
  const r = await send("TUBESTACK_GET_SAVE_TAB_COUNTS");
  if (!r?.ok) {
    countLine.textContent =
      r?.error === "No active tab." ? "Open this popup from a window with tabs." : "Could not read tabs.";
    for (const b of saveButtons) b.disabled = true;
    return;
  }
  const { left, right, all: allN, exceptCurrent } = r;
  countLine.textContent = `${allN} video tab${allN === 1 ? "" : "s"} here · ${left} left · ${right} right · ${exceptCurrent} except this tab`;

  btnSaveLeft.disabled = left === 0;
  btnSaveRight.disabled = right === 0;
  btnSaveAll.disabled = allN === 0;
  btnSaveExcept.disabled = exceptCurrent === 0;
}

function labelForMode(mode, n) {
  const word = n === 1 ? "tab" : "tabs";
  if (mode === "left") return `Saved ${n} ${word} to the left into your local library.`;
  if (mode === "right") return `Saved ${n} ${word} to the right into your local library.`;
  if (mode === "all") return `Saved ${n} video ${word} to your local library.`;
  if (mode === "except_current") return `Saved ${n} ${word} (except current) to your local library.`;
  return `Saved ${n} ${word} to your local library.`;
}

/**
 * One message, one operation. The background worker persists, verifies, then closes — so if Chrome
 * dismisses this popup mid-flight (which closing the active tab does), the save still completes and
 * is recoverable from its operation record rather than leaving tabs closed with nothing saved.
 */
function attachSaveHandler(btn, mode) {
  if (!btn) return;
  let busy = false;
  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    status.textContent = "Saving…";
    for (const b of saveButtons) b.disabled = true;

    const r = await send("TUBESTACK_SAVE_AND_ATTACH_TABS", {
      mode,
      operationId: newOperationId(),
      target: { kind: "new" },
    });

    status.textContent = describeSaveResult(r, r?.mode || mode);
    busy = false;

    if (r?.playlistId && (r.ok || r.partial)) {
      await openExtensionInNewTabAndClose(dashboardPlaylistPath(r.playlistId));
      return;
    }
    await refreshCount();
  });
}

/**
 * Finish and report any operation interrupted by a teardown. Runs before the counts refresh so the
 * user sees the outcome of the save they thought had vanished.
 */
async function reportInterruptedSaves() {
  const r = await send("TUBESTACK_SAVE_OPS_RESUME");
  const resumed = Array.isArray(r?.resumed) ? r.resumed : [];
  if (!resumed.length) return;
  const kept = resumed.reduce((n, x) => n + (x.keptOpenTabIds?.length || 0), 0);
  const closed = resumed.reduce((n, x) => n + (x.closedTabIds?.length || 0), 0);
  status.textContent = kept
    ? `Recovered an interrupted save: ${closed} closed, ${kept} left open (not confirmed saved).`
    : `Recovered an interrupted save: ${closed} tab${closed === 1 ? "" : "s"} finished safely.`;
}

attachSaveHandler(btnSaveLeft, "left");
attachSaveHandler(btnSaveRight, "right");
attachSaveHandler(btnSaveAll, "all");
attachSaveHandler(btnSaveExcept, "except_current");

btnDash.addEventListener("click", async () => {
  const playlistId = await resolveMostRecentPlaylistId();
  await openExtensionInNewTabAndClose(dashboardPlaylistPath(playlistId));
});

btnHome?.addEventListener("click", async () => {
  await openExtensionInNewTabAndClose("home/home.html");
});

btnLibrary?.addEventListener("click", async () => {
  await openExtensionInNewTabAndClose("dashboard/library.html");
});

btnSidebar?.addEventListener("click", () => {
  btnSidebar.disabled = true;
  // sidePanel.open() must run in the click gesture chain — not via service worker messaging.
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const windowId = tabs[0]?.windowId;
    if (windowId == null) {
      btnSidebar.disabled = false;
      status.textContent = "Could not detect this window.";
      return;
    }
    chrome.sidePanel.open({ windowId }, () => {
      if (chrome.runtime.lastError) {
        btnSidebar.disabled = false;
        status.textContent = "Could not open sidebar — try again.";
        return;
      }
      window.close();
    });
  });
});

async function initPopupTheme() {
  const data = await chrome.storage.local.get("settings");
  globalThis.TUBESTACK_UI_THEMES?.applyUiTheme(data.settings?.uiThemePreset);
  globalThis.TUBESTACK_UI_THEMES?.bindUiThemeStorageSync();
}

void initPopupTheme();
void (async () => {
  await reportInterruptedSaves();
  await refreshCount();
})();

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

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
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
    n === 0 ? "Library: empty" : `Library: ${n} saved video${n === 1 ? "" : "s"}`;
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
  if (mode === "left") return `Saved ${n} ${word} to the left into a new playlist.`;
  if (mode === "right") return `Saved ${n} ${word} to the right into a new playlist.`;
  if (mode === "all") return `Saved ${n} video ${word} into a new playlist.`;
  if (mode === "except_current") return `Saved ${n} ${word} (except current) into a new playlist.`;
  return `Saved ${n} ${word} into a new playlist.`;
}

function attachSaveHandler(btn, mode) {
  if (!btn) return;
  btn.addEventListener("click", async () => {
    status.textContent = "Saving…";
    for (const b of saveButtons) b.disabled = true;
    const r = await send("TUBESTACK_SAVE_YT_TABS", { mode });
    if (r?.ok) {
      if (r.savedCount === 0) {
        status.textContent = "Nothing to save.";
      } else {
        const savePl = await send("TUBESTACK_LOCAL_PLAYLIST_SAVE", {
          name: "",
          items: r.saved,
          playlistSource: "session",
        });
        if (!savePl?.ok) {
          status.textContent = savePl?.error || "Saved tabs, but playlist creation failed.";
        } else {
          const playlistId = savePl.playlistId || savePl.playlists?.[0]?.id;
          status.textContent = labelForMode(r.mode || mode, r.savedCount);
          if (playlistId) {
            await openExtensionInNewTabAndClose(dashboardPlaylistPath(playlistId));
            return;
          }
        }
      }
    } else {
      status.textContent = r?.error || "Something went wrong.";
    }
    await refreshCount();
  });
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
refreshCount();

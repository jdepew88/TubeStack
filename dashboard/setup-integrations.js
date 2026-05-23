function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

let state = {
  hasYoutubeApiKey: false,
  hasOpenaiKey: false,
  hasYoutubeOAuthClientId: false,
  settings: {},
  oauthRedirectUri: "",
  extensionId: "",
  integrationHealth: null,
  youtubeApiTested: false,
  youtubeOAuthTested: false,
};

function qs(name) {
  return new URLSearchParams(location.search).get(name) || "";
}

function setStatus(el, text, ok) {
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("ok", "err");
  if (!text) return;
  el.classList.add(ok ? "ok" : "err");
}

function friendlyOAuthMessage(r) {
  const msg = r?.message || r?.error || "OAuth test failed.";
  const low = String(msg).toLowerCase();
  if (low.includes("redirect") || low.includes("redirect_uri")) {
    return (
      "Google rejected the sign-in. Make sure this redirect URI is added to your OAuth Client in Google Cloud: " +
      (state.oauthRedirectUri || "(reload page)")
    );
  }
  if (r?.error === "missing_oauth_client_id") {
    return "Paste your OAuth Client ID first.";
  }
  return msg;
}

async function copyFromElement(targetId, btn) {
  const el = document.getElementById(targetId);
  const text = el?.textContent?.trim() || "";
  if (!text || text === "—") return;
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.textContent = prev;
      }, 1400);
    }
  } catch {
    alert("Could not copy — select the text manually.");
  }
}

async function copyInputValue(inputId, btn) {
  const v = document.getElementById(inputId)?.value?.trim() || "";
  if (!v) return;
  try {
    await navigator.clipboard.writeText(v);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.textContent = prev;
      }, 1400);
    }
  } catch {
    alert("Could not copy.");
  }
}

function checklistLabel(kind) {
  if (kind === "youtube_api") {
    if (!state.hasYoutubeApiKey) return "Not set";
    if (state.youtubeApiTested) return "Tested";
    return "Saved on this device";
  }
  if (kind === "youtube_oauth") {
    if (!state.hasYoutubeOAuthClientId) return "Not set";
    if (state.youtubeOAuthTested) return "Sign-in tested";
    return "Saved";
  }
  if (kind === "openai") {
    if (!state.hasOpenaiKey) return "Not set";
    return "Saved · Optional";
  }
  return "—";
}

function renderChecklist() {
  const ul = document.getElementById("siChecklist");
  if (!ul) return;
  const rows = [
    ["YouTube API key", "youtube_api"],
    ["Google OAuth Client ID", "youtube_oauth"],
    ["OpenAI API key", "openai"],
  ];
  ul.innerHTML = rows
    .map(([label, kind]) => {
      const val = checklistLabel(kind);
      const done = val.includes("Tested") || val.includes("Saved");
      return `<li><span class="si-check-label">${label}</span><span class="si-check-value${done ? " done" : ""}">${val}</span></li>`;
    })
    .join("");
}

function applyLoadedState(r) {
  state.hasYoutubeApiKey = Boolean(r.hasYoutubeApiKey);
  state.hasOpenaiKey = Boolean(r.hasOpenaiKey);
  state.hasYoutubeOAuthClientId = Boolean(
    r.hasYoutubeOAuthClientId || String(r.settings?.youtubeOAuthClientId || "").trim()
  );
  state.settings = r.settings || {};
  state.oauthRedirectUri = r.oauthRedirectUri || "";
  state.extensionId = r.extensionId || chrome.runtime?.id || "";
  state.integrationHealth = r.integrationHealth || null;
  state.youtubeApiTested = state.integrationHealth?.youtubeApi?.lastTestOk === true;
  state.youtubeOAuthTested = state.integrationHealth?.youtubeOAuth?.lastTestOk === true;

  const ext = document.getElementById("siExtensionId");
  if (ext) ext.textContent = state.extensionId || "—";
  const rd = document.getElementById("siOAuthRedirect");
  if (rd) rd.textContent = state.oauthRedirectUri || "—";
  const oci = document.getElementById("siOAuthClientId");
  if (oci) oci.value = state.settings.youtubeOAuthClientId || "";

  const yk = document.getElementById("siYoutubeApiKey");
  if (yk) {
    yk.value = "";
    yk.placeholder = state.hasYoutubeApiKey ? "Key on file — enter only to replace" : "AIza…";
  }
  const ykh = document.getElementById("siYoutubeKeyHint");
  if (ykh) {
    ykh.textContent = state.hasYoutubeApiKey
      ? "Saved on this device. Paste a new key only to replace it."
      : "Paste your YouTube Data API v3 key from Google Cloud Console.";
  }

  const ok = document.getElementById("siOpenaiKey");
  if (ok) {
    ok.value = "";
    ok.placeholder = state.hasOpenaiKey ? "Key on file — enter only to replace" : "sk-…";
  }
  const okh = document.getElementById("siOpenaiKeyHint");
  if (okh) {
    okh.textContent = state.hasOpenaiKey
      ? "Saved on this device. Paste a new key only to replace it."
      : "Optional — paste when you want AI features.";
  }

  renderChecklist();
}

async function loadState() {
  const r = await send("TUBESTACK_GET_STATE");
  if (!r?.ok) return;
  applyLoadedState(r);
}

function backUrl() {
  const from = qs("from");
  if (from === "onboarding" || from === "wizard") {
    return "dashboard.html?resumeOobe=1";
  }
  return "dashboard.html#settings";
}

function wireNav() {
  const from = qs("from");
  const backDash = document.getElementById("siBackDashboard");
  const backSet = document.getElementById("siBackSettings");
  if (from === "settings") {
    backSet?.classList.remove("hidden");
    if (backDash) backDash.textContent = "← Back to TubeStack";
  }
  const skip = document.getElementById("siBtnSkip");
  const cont = document.getElementById("siBtnSaveContinue");
  const go = () => {
    location.href = backUrl();
  };
  skip?.addEventListener("click", go);
  cont?.addEventListener("click", go);
}

document.querySelectorAll(".si-copy").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const target = btn.getAttribute("data-copy-target");
    const source = btn.getAttribute("data-copy-source");
    if (target) await copyFromElement(target, btn);
    else if (source) await copyInputValue(source, btn);
  });
});

document.getElementById("siSaveYoutubeApi")?.addEventListener("click", async () => {
  const raw = document.getElementById("siYoutubeApiKey")?.value.trim() || "";
  const st = document.getElementById("siYoutubeApiStatus");
  if (raw.length < 20) {
    setStatus(st, "Paste your YouTube Data API key first.", false);
    return;
  }
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { youtubeDataApiKey: raw } });
  if (!r?.ok) {
    setStatus(st, "Could not save.", false);
    return;
  }
  state.hasYoutubeApiKey = Boolean(r.hasYoutubeApiKey);
  const yk = document.getElementById("siYoutubeApiKey");
  if (yk) yk.value = "";
  setStatus(st, "API key saved on this device.", true);
  await loadState();
});

document.getElementById("siTestYoutubeApi")?.addEventListener("click", async () => {
  const key = document.getElementById("siYoutubeApiKey")?.value.trim() || "";
  const st = document.getElementById("siYoutubeApiStatus");
  if (!key && !state.hasYoutubeApiKey) {
    setStatus(st, "Paste your YouTube Data API key first.", false);
    return;
  }
  setStatus(st, "Testing…", true);
  const r = await send("TUBESTACK_TEST_YOUTUBE_API_KEY", { apiKey: key });
  if (r?.ok) state.youtubeApiTested = true;
  setStatus(st, r?.ok ? r.message || "Key works." : r?.message || r?.error || "Test failed.", Boolean(r?.ok));
  await loadState();
});

document.getElementById("siClearYoutubeApi")?.addEventListener("click", async () => {
  if (!confirm("Remove the saved YouTube Data API key from this device?")) return;
  const st = document.getElementById("siYoutubeApiStatus");
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { youtubeDataApiKey: "" } });
  if (!r?.ok) {
    setStatus(st, "Could not clear.", false);
    return;
  }
  state.hasYoutubeApiKey = false;
  state.youtubeApiTested = false;
  setStatus(st, "API key cleared.", true);
  await loadState();
});

document.getElementById("siSaveOAuth")?.addEventListener("click", async () => {
  const v = document.getElementById("siOAuthClientId")?.value.trim() || "";
  const st = document.getElementById("siOAuthStatus");
  if (!v) {
    setStatus(st, "Paste your OAuth Client ID first.", false);
    return;
  }
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { youtubeOAuthClientId: v } });
  if (!r?.ok) {
    setStatus(st, "Could not save.", false);
    return;
  }
  state.hasYoutubeOAuthClientId = true;
  setStatus(st, "Client ID saved.", true);
  await loadState();
});

document.getElementById("siTestOAuth")?.addEventListener("click", async () => {
  const v = document.getElementById("siOAuthClientId")?.value.trim() || "";
  const st = document.getElementById("siOAuthStatus");
  if (!v && !state.hasYoutubeOAuthClientId) {
    setStatus(st, "Paste your OAuth Client ID first.", false);
    return;
  }
  setStatus(st, "Opening Google sign-in…", true);
  const r = await send("TUBESTACK_TEST_YOUTUBE_OAUTH", { youtubeOAuthClientId: v });
  if (r?.ok) state.youtubeOAuthTested = true;
  setStatus(st, r?.ok ? r.message || "Sign-in OK." : friendlyOAuthMessage(r), Boolean(r?.ok));
  await loadState();
});

document.getElementById("siClearOAuth")?.addEventListener("click", async () => {
  if (!confirm("Remove the saved OAuth Client ID from this device?")) return;
  const st = document.getElementById("siOAuthStatus");
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { youtubeOAuthClientId: "" } });
  if (!r?.ok) {
    setStatus(st, "Could not clear.", false);
    return;
  }
  document.getElementById("siOAuthClientId").value = "";
  state.hasYoutubeOAuthClientId = false;
  state.youtubeOAuthTested = false;
  setStatus(st, "Client ID cleared.", true);
  await loadState();
});

document.getElementById("siSaveOpenai")?.addEventListener("click", async () => {
  const raw = document.getElementById("siOpenaiKey")?.value.trim() || "";
  const st = document.getElementById("siOpenaiStatus");
  if (raw.length < 20) {
    setStatus(st, "Paste a valid OpenAI API key first.", false);
    return;
  }
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { openaiApiKey: raw } });
  if (!r?.ok) {
    setStatus(st, "Could not save.", false);
    return;
  }
  state.hasOpenaiKey = Boolean(r.hasOpenaiKey);
  document.getElementById("siOpenaiKey").value = "";
  setStatus(st, "OpenAI key saved on this device.", true);
  await loadState();
});

document.getElementById("siTestOpenai")?.addEventListener("click", async () => {
  const key = document.getElementById("siOpenaiKey")?.value.trim() || "";
  const st = document.getElementById("siOpenaiStatus");
  if (!key && !state.hasOpenaiKey) {
    setStatus(st, "Paste your OpenAI API key first.", false);
    return;
  }
  setStatus(st, "Testing…", true);
  const r = await send("TUBESTACK_TEST_OPENAI_CONNECTION", { openaiApiKey: key });
  const msg = r?.ok
    ? `Connected (${r.modelCount ?? 0} models).`
    : r?.message ||
      (r?.error === "openai_http"
        ? "OpenAI rejected this key. Check the key and billing/quota on your OpenAI account."
        : r?.error || "Test failed.");
  setStatus(st, msg, Boolean(r?.ok));
  await loadState();
});

document.getElementById("siClearOpenai")?.addEventListener("click", async () => {
  if (!confirm("Remove the saved OpenAI API key from this device?")) return;
  const st = document.getElementById("siOpenaiStatus");
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { openaiApiKey: "" } });
  if (!r?.ok) {
    setStatus(st, "Could not clear.", false);
    return;
  }
  state.hasOpenaiKey = false;
  setStatus(st, "OpenAI key cleared.", true);
  await loadState();
});

async function initPageTheme() {
  const r = await send("TUBESTACK_GET_STATE");
  globalThis.TUBESTACK_UI_THEMES?.applyUiTheme(r?.settings?.uiThemePreset);
  globalThis.TUBESTACK_UI_THEMES?.bindUiThemeStorageSync();
}

wireNav();
void initPageTheme();
loadState();

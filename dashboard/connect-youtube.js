function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

let step = 1;
let state = {
  oauthRedirectUri: "",
  extensionId: "",
  hasClientId: false,
  lastTestOk: false,
  clientId: "",
};

function qs(name) {
  return new URLSearchParams(location.search).get(name) || "";
}

function backUrl() {
  const from = qs("from");
  if (from === "onboarding") return "dashboard.html?resumeOobe=1";
  if (from === "settings") return "dashboard.html#settings";
  if (from === "home") return "../home/home.html";
  return "dashboard.html";
}

function setStep(n) {
  step = n;
  document.querySelectorAll(".cy-panel").forEach((p) => {
    p.classList.toggle("hidden", Number(p.dataset.step) !== n);
  });
  document.querySelectorAll(".cy-step-pill").forEach((pill) => {
    const s = Number(pill.dataset.step);
    pill.classList.toggle("active", s === n);
    pill.classList.toggle("done", s < n);
  });
}

function setClientIdStatus(text, ok) {
  const el = document.getElementById("cyClientIdStatus");
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("ok", "err");
  if (text) el.classList.add(ok ? "ok" : "err");
}

function setTestStatus(text, ok) {
  const el = document.getElementById("cyTestStatus");
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("ok", "err");
  if (text) el.classList.add(ok ? "ok" : "err");
}

function updateStep2Continue() {
  const btn = document.getElementById("cyToStep3");
  if (btn) btn.disabled = !state.hasClientId;
}

function updateStep3Continue() {
  const btn = document.getElementById("cyToStep4");
  if (btn) btn.disabled = !state.lastTestOk;
}

async function copyText(text, btn) {
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
    alert("Could not copy — select the text and copy manually.");
  }
}

function friendlyOAuthError(r) {
  const msg = r?.message || r?.error || "Sign-in failed.";
  const low = String(msg).toLowerCase();
  if (low.includes("redirect") || low.includes("redirect_uri")) {
    return (
      "Google rejected the sign-in. Add this redirect URI to your OAuth client in Google Cloud, then try again:\n" +
      (state.oauthRedirectUri || "")
    );
  }
  if (r?.error === "missing_oauth_client_id") {
    return "Save your OAuth Client ID on the previous step first.";
  }
  return msg;
}

function renderDonePanel(mode) {
  const title = document.getElementById("cyDoneTitle");
  const msg = document.getElementById("cyDoneMessage");
  const extra = document.getElementById("cyDoneExtra");
  if (mode === "local") {
    if (title) title.textContent = "Local mode — you’re ready";
    if (msg) {
      msg.textContent =
        "TubeStack will keep working on this device without YouTube sign-in. You can connect YouTube anytime from Settings → Connect YouTube.";
    }
    if (extra) extra.textContent = "";
  } else if (mode === "connected") {
    if (title) title.textContent = "YouTube connected";
    if (msg) {
      msg.textContent =
        "Sign-in worked. You can import playlists from Settings and save queues to your YouTube channel when you choose.";
    }
    if (extra) {
      extra.textContent =
        "Optional: add a YouTube Data API key in Settings or Setup Integrations for channel scans and richer metadata.";
    }
  } else {
    if (title) title.textContent = "Setup saved — test when you’re ready";
    if (msg) {
      msg.textContent =
        "Your Client ID is saved on this device. Run the sign-in test from Settings whenever you want, or come back to this page.";
    }
    if (extra) extra.textContent = "";
  }
}

async function loadState() {
  const r = await send("TUBESTACK_GET_STATE");
  if (!r?.ok) return;
  state.oauthRedirectUri = r.oauthRedirectUri || "";
  state.extensionId = r.extensionId || chrome.runtime?.id || "";
  state.hasClientId = Boolean(
    r.hasYoutubeOAuthClientId || String(r.settings?.youtubeOAuthClientId || "").trim()
  );
  state.clientId = r.settings?.youtubeOAuthClientId || "";
  state.lastTestOk = r.integrationHealth?.youtubeOAuth?.lastTestOk === true;

  const rd = document.getElementById("cyRedirectUri");
  if (rd) rd.textContent = state.oauthRedirectUri || "—";
  const ext = document.getElementById("cyExtensionId");
  if (ext) ext.textContent = state.extensionId || "—";
  const inp = document.getElementById("cyClientId");
  if (inp) inp.value = state.clientId;

  if (state.hasClientId) {
    setClientIdStatus("Client ID saved on this device.", true);
  }
  updateStep2Continue();
  updateStep3Continue();
}

document.getElementById("cyBackLink")?.setAttribute("href", backUrl());
document.getElementById("cyDoneDashboard")?.setAttribute("href", backUrl());

document.getElementById("cyChooseLocal")?.addEventListener("click", () => {
  renderDonePanel("local");
  setStep(4);
});

document.getElementById("cyChooseConnect")?.addEventListener("click", () => {
  setStep(2);
});

document.getElementById("cyCopyRedirect")?.addEventListener("click", (e) => {
  copyText(state.oauthRedirectUri, e.currentTarget);
});

document.getElementById("cyCopyExtId")?.addEventListener("click", (e) => {
  copyText(state.extensionId, e.currentTarget);
});

document.getElementById("cySaveClientId")?.addEventListener("click", async () => {
  const v = document.getElementById("cyClientId")?.value.trim() || "";
  if (!v) {
    setClientIdStatus("Paste the Client ID from Google Cloud first.", false);
    return;
  }
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { youtubeOAuthClientId: v } });
  if (!r?.ok) {
    setClientIdStatus("Could not save. Try again.", false);
    return;
  }
  state.hasClientId = true;
  state.clientId = v;
  setClientIdStatus("Saved. Continue to test sign-in.", true);
  updateStep2Continue();
});

document.getElementById("cyBackTo1")?.addEventListener("click", () => setStep(1));
document.getElementById("cyToStep3")?.addEventListener("click", () => setStep(3));
document.getElementById("cyBackTo2")?.addEventListener("click", () => setStep(2));

document.getElementById("cyTestSignIn")?.addEventListener("click", async () => {
  const v = document.getElementById("cyClientId")?.value.trim() || state.clientId;
  if (!v && !state.hasClientId) {
    setTestStatus("Save your Client ID first (step 2).", false);
    return;
  }
  setTestStatus("Opening Google sign-in…", true);
  const r = await send("TUBESTACK_TEST_YOUTUBE_OAUTH", { youtubeOAuthClientId: v });
  if (r?.ok) {
    state.lastTestOk = true;
    setTestStatus(r.message || "Connected! Google sign-in succeeded.", true);
    updateStep3Continue();
  } else {
    state.lastTestOk = false;
    setTestStatus(friendlyOAuthError(r), false);
    updateStep3Continue();
  }
  await loadState();
});

document.getElementById("cyToStep4")?.addEventListener("click", () => {
  renderDonePanel(state.lastTestOk ? "connected" : "skipped");
  setStep(4);
});

const from = qs("from");
if (from === "settings") {
  document.getElementById("cyBackLink")?.setAttribute("href", "dashboard.html#settings");
}

loadState();

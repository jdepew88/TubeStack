/**
 * Setup guide: fill in this install's OAuth redirect URI and extension ID, wire copy buttons, follow the UI theme.
 * Read-only — never writes extension storage.
 */
(function () {
  const ext = typeof chrome !== "undefined" ? chrome : null;

  try {
    const uri = ext?.identity?.getRedirectURL?.();
    if (uri) document.getElementById("sgRedirectUri").textContent = uri;
  } catch {
    /* opened outside the extension: keep the placeholder text */
  }
  if (ext?.runtime?.id) document.getElementById("sgExtensionId").textContent = ext.runtime.id;

  if (ext?.storage?.local) {
    ext.storage.local.get("settings").then(
      (bag) => globalThis.TUBESTACK_UI_THEMES?.applyUiTheme(bag?.settings?.uiThemePreset),
      () => {}
    );
    globalThis.TUBESTACK_UI_THEMES?.bindUiThemeStorageSync();
  }

  for (const btn of document.querySelectorAll(".sg-copy")) {
    btn.addEventListener("click", async () => {
      const text = document.getElementById(btn.dataset.copyTarget)?.textContent?.trim() || "";
      if (!text || text === "—") return;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Select & copy";
      }
      setTimeout(() => {
        btn.textContent = "Copy";
      }, 1600);
    });
  }
})();

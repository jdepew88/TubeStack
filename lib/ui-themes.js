/**
 * TubeStack UI color themes (TabStack presets). No custom backgrounds.
 */
(function (root) {
  const UI_THEME_PRESETS = [
    { id: "zinc", label: "Zinc / lime" },
    { id: "emerald", label: "Emerald mist" },
    { id: "ocean", label: "Ocean slate" },
    { id: "sunset", label: "Sunset" },
    { id: "crimson", label: "Crimson noir" },
  ];

  const UI_THEME_IDS = new Set(UI_THEME_PRESETS.map((x) => x.id));
  const DEFAULT_UI_THEME = "zinc";

  function normalizeUiThemePreset(value) {
    const v = String(value || "").trim();
    return UI_THEME_IDS.has(v) ? v : DEFAULT_UI_THEME;
  }

  function applyUiTheme(preset) {
    const p = normalizeUiThemePreset(preset);
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.dataset.theme = p;
    }
    return p;
  }

  function themePresetOptionsHtml(selected) {
    const sel = normalizeUiThemePreset(selected);
    return UI_THEME_PRESETS.map(
      (t) => `<option value="${t.id}"${t.id === sel ? " selected" : ""}>${escapeHtml(t.label)}</option>`
    ).join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bindUiThemeStorageSync() {
    if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes.settings) return;
      const next = changes.settings.newValue;
      if (next && typeof next === "object" && next.uiThemePreset) {
        applyUiTheme(next.uiThemePreset);
      }
    });
  }

  root.TUBESTACK_UI_THEMES = {
    UI_THEME_PRESETS,
    UI_THEME_IDS,
    DEFAULT_UI_THEME,
    normalizeUiThemePreset,
    applyUiTheme,
    themePresetOptionsHtml,
    bindUiThemeStorageSync,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);

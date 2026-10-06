#!/usr/bin/env node
/**
 * Browser end-to-end tests (run: node scripts/e2e-browser.cjs [--only <name-part>] [--keep] [--shots <dir>]).
 *
 * Loads this folder as an unpacked extension into a standalone Chromium (Playwright's build — branded
 * Google Chrome ignores --load-extension) using brand-new temporary profiles, then drives the real
 * dashboard over the Chrome DevTools Protocol: real downloads, the real file picker, real mouse and
 * keyboard events. It never touches your own Chrome profile or its TubeStack library.
 *
 * Zero dependencies: Node 22+ (global WebSocket). Chromium is found via TUBESTACK_CHROMIUM or the
 * Playwright cache (`npx playwright install chromium` installs one).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { populatedStorage, SECRETS } = require("./fixtures/populated-library.cjs");

const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const SHOTS = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

let failed = 0;
let ran = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("  FAIL:", msg);
    failed++;
  }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    console.error(`  FAIL: ${msg}\n    expected ${b}\n    actual   ${a}`);
    failed++;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- browser plumbing

function findChromium() {
  if (process.env.TUBESTACK_CHROMIUM) return process.env.TUBESTACK_CHROMIUM;
  const caches = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  for (const dir of caches) {
    if (!fs.existsSync(dir)) continue;
    const builds = fs
      .readdirSync(dir)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const b of builds) {
      for (const rel of [
        "chrome-win64/chrome.exe",
        "chrome-win/chrome.exe",
        "chrome-linux64/chrome",
        "chrome-linux/chrome",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
      ]) {
        const p = path.join(dir, b, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(`${m.error.message} ${m.error.data || ""}`));
        else resolve(m.result);
      } else {
        for (const fn of this.listeners) fn(m);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, 20000);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
    });
  }
}

async function launch(label) {
  const exe = findChromium();
  if (!exe) return null;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `tubestack-e2e-${label}-`));
  const profile = path.join(base, "profile");
  const downloads = path.join(base, "downloads");
  fs.mkdirSync(downloads, { recursive: true });
  const proc = spawn(
    exe,
    [
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--remote-debugging-port=0",
      `--load-extension=${ROOT}`,
      `--disable-extensions-except=${ROOT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
  const [port, wsPath] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });

  let extId = null;
  for (let i = 0; i < 100 && !extId; i++) {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const sw = targetInfos.find((t) => /^chrome-extension:\/\/[a-p]{32}\/background\/service-worker\.js$/.test(t.url));
    if (sw) extId = sw.url.split("/")[2];
    else await sleep(100);
  }
  if (!extId) throw new Error("TubeStack service worker did not start in Chromium");

  return {
    cdp,
    extId,
    downloads,
    url: (p) => `chrome-extension://${extId}/${p}`,
    async close() {
      try {
        await cdp.send("Browser.close");
      } catch {
        /* already gone */
      }
      ws.close();
      await new Promise((r) => (proc.exitCode != null ? r() : proc.once("exit", r)));
      if (!KEEP) {
        for (let i = 0; i < 10; i++) {
          try {
            fs.rmSync(base, { recursive: true, force: true });
            break;
          } catch {
            await sleep(300);
          }
        }
      }
    },
  };
}

async function openPage(b, url) {
  const { targetId } = await b.cdp.send("Target.createTarget", { url });
  return attach(b, targetId);
}

async function attach(b, targetId) {
  const { sessionId } = await b.cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (m, p) => b.cdp.send(m, p, sessionId);
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  // A JS dialog would block the page forever; record and dismiss it so the test fails loudly instead.
  b.cdp.listeners.add((m) => {
    if (m.sessionId !== sessionId || m.method !== "Page.javascriptDialogOpening") return;
    page.dialogs.push(m.params.message);
    void send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
  });
  const page = {
    targetId,
    send,
    dialogs: [],
    async eval(expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      }
      return r.result.value;
    },
    async waitFor(expression, { timeout = 10000, label = expression } = {}) {
      const end = Date.now() + timeout;
      let last;
      while (Date.now() < end) {
        try {
          last = await page.eval(expression);
          if (last) return last;
        } catch (e) {
          last = e.message;
        }
        await sleep(100);
      }
      throw new Error(`timed out waiting for: ${label} (last: ${JSON.stringify(last)})`);
    },
    async center(selector) {
      return page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
    },
    /** Real mouse click(s): clickCount 2 produces a genuine double-click (detail 1 then 2). */
    async mouseClick(selector, clickCount = 1) {
      const c = await page.center(selector);
      if (!c) throw new Error(`no element for ${selector}`);
      for (let n = 1; n <= clickCount; n++) {
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button: "left", clickCount: n });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c.x, y: c.y, button: "left", clickCount: n });
      }
    },
    async key(key, { shift = false } = {}) {
      const code = key === " " ? "Space" : key;
      const base = { key, code, modifiers: shift ? 8 : 0, windowsVirtualKeyCode: key === "Enter" ? 13 : 32 };
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: key === "Enter" ? "\r" : " " });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    },
    async setFile(selector, file) {
      const { root } = await send("DOM.getDocument", { depth: 0 });
      const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
      await send("DOM.setFileInputFiles", { nodeId, files: [file] });
    },
    async shot(name) {
      if (!SHOTS) return;
      fs.mkdirSync(SHOTS, { recursive: true });
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
    },
  };
  return page;
}

async function openDashboard(b) {
  const page = await openPage(b, b.url("dashboard/dashboard.html"));
  await page.waitFor(`document.readyState === "complete" && typeof loadState === "function" && Array.isArray(allItems)`);
  await page.waitFor(`!!settings && Object.keys(settings).length >= 0 && document.querySelector("#onboarding") !== null`);
  await sleep(300);
  return page;
}

const storageGet = (page, keys = null) => page.eval(`chrome.storage.local.get(${JSON.stringify(keys)})`);

async function waitForDownload(b, { prefix, before = new Set(), timeout = 10000 }) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const hit = fs
      .readdirSync(b.downloads)
      .find((f) => f.startsWith(prefix) && f.endsWith(".json") && !before.has(f));
    if (hit) {
      const p = path.join(b.downloads, hit);
      await sleep(150);
      return { name: hit, path: p, text: fs.readFileSync(p, "utf8") };
    }
    await sleep(100);
  }
  throw new Error(`no ${prefix}*.json download appeared`);
}

// ---------------------------------------------------------------- scenarios

const scenarios = [];
function scenario(name, fn) {
  scenarios.push({ name, fn });
}

const shared = {};

scenario("export from a populated install downloads a complete, secret-free backup without changing storage", async () => {
  const b = await launch("source");
  try {
    let page = await openDashboard(b);
    await page.eval(`chrome.storage.local.set(${JSON.stringify(populatedStorage())})`);
    page = await openDashboard(b);
    eq(await page.eval(`allItems.length`), 14, "dashboard shows the seeded library");
    const before = await storageGet(page);

    await page.eval(`setActiveWindow("settings")`);
    await page.mouseClick("#btnExportBackup");
    const file = await waitForDownload(b, { prefix: "tubestack-backup-" });
    await page.waitFor(`document.getElementById("backupStatus").classList.contains("success")`);
    await page.shot("01-settings-export-done");

    assert(/^tubestack-backup-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(file.name), `filename ${file.name}`);
    const backup = JSON.parse(file.text);
    eq([backup.format, backup.version], ["tubestack-backup", 1], "identifier and version");
    eq(backup.counts.videos, 14, "videos in file");
    eq(backup.counts.playlists, 4, "playlists in file");
    eq(backup.counts.superFavoriteCategories, 2, "super favorites in file");
    for (const v of Object.values(SECRETS)) assert(!file.text.includes(v), "no secret value in downloaded file");
    const status = await page.eval(`document.getElementById("backupStatus").textContent`);
    assert(status.includes(file.name), "status names the file");
    const statText = await page.eval(`document.getElementById("backupExportSummary").innerText`);
    assert(/14\s*\n?\s*Videos|Videos\s*\n?\s*14/.test(statText), `summary shows 14 videos: ${statText}`);
    eq(await storageGet(page), before, "export left chrome.storage.local byte-identical");
    shared.backupPath = path.join(os.tmpdir(), `tubestack-e2e-backup-${process.pid}.json`);
    fs.copyFileSync(file.path, shared.backupPath);
  } finally {
    await b.close();
  }
});

scenario("a fresh install restores the backup from the onboarding Welcome step", async () => {
  if (!shared.backupPath) throw new Error("needs the export scenario");
  const b = await launch("dest");
  try {
    const page = await openDashboard(b);
    await page.waitFor(`!document.getElementById("onboarding").classList.contains("hidden")`, { label: "onboarding visible" });
    eq(await page.eval(`allItems.length`), 0, "destination starts empty");
    await page.eval(`(async () => {
      const cur = (await chrome.storage.local.get("settings")).settings || {};
      await chrome.storage.local.set({ settings: { ...cur, openaiApiKey: "sk-DEST-KEEP" } });
    })()`);

    await page.setFile("#backupFileInput", shared.backupPath);
    await page.waitFor(`!document.getElementById("backupImportModal").classList.contains("hidden")`, { label: "preview modal" });
    await page.shot("02-import-preview-empty-install");
    const stats = await page.eval(`document.getElementById("biStats").innerText`);
    assert(/Videos\s*\n?\s*14/.test(stats), `preview shows 14 videos: ${stats}`);
    eq(await page.eval(`document.getElementById("biConfirmWrap").classList.contains("hidden")`), true, "no confirm needed on empty install");
    eq((await storageGet(page, "items")).items.length, 0, "preview wrote nothing");

    await page.mouseClick("#biApply");
    await page.waitFor(`!/^(|Restoring…)$/.test(document.getElementById("biStatus").textContent)`, { label: "restore finished" });
    eq(await page.eval(`document.getElementById("biStatus").className + " | " + document.getElementById("biStatus").textContent`).then((t) => t.startsWith("modal-status success") || t), true, "restore reported success");
    const st = await storageGet(page);
    eq(st.items.length, 14, "videos restored");
    eq(st.localPlaylists.length, 4, "playlists restored");
    eq(st.themes.filter((t) => t.tier === "favorite").length, 2, "super favorites restored");
    eq(Object.keys(st.videoProgress).length, 4, "progress restored");
    eq(st.settings.openaiApiKey, "sk-DEST-KEEP", "destination key kept");
    for (const k of Object.keys(SECRETS)) {
      if (k !== "openaiApiKey") assert(!(k in st.settings), `${k} not imported`);
    }
    eq(await page.eval(`allItems.length`), 14, "dashboard state refreshed without reload");
    eq(await page.eval(`document.getElementById("onboarding").classList.contains("hidden")`), true, "onboarding closed (backup had it complete)");
    eq(fs.readdirSync(b.downloads).filter((f) => f.startsWith("tubestack-pre-restore")).length, 0, "no safety file for an empty install");

    await page.mouseClick("#biCancel"); // "Done" → reloads the page
    const again = await openDashboard(b);
    eq(await again.eval(`allItems.length`), 14, "library still there after reload");
    eq(await again.eval(`localStorage.getItem("ts_view_mode")`), null, "fixture had no ui prefs; nothing invented");
    shared.destOk = true;
  } finally {
    await b.close();
  }
});

scenario("replacing an existing library asks for confirmation and downloads a safety backup first", async () => {
  if (!shared.backupPath) throw new Error("needs the export scenario");
  const b = await launch("replace");
  try {
    let page = await openDashboard(b);
    const own = {
      items: [{ id: "own-1", videoId: "zzzzzzzzzzz", url: "https://www.youtube.com/watch?v=zzzzzzzzzzz", title: "My own video" }],
      localPlaylists: [],
      settings: { onboardingComplete: true },
    };
    await page.eval(`chrome.storage.local.set(${JSON.stringify(own)})`);
    page = await openDashboard(b);
    await page.eval(`setActiveWindow("settings")`);

    await page.setFile("#backupFileInput", shared.backupPath);
    await page.waitFor(`!document.getElementById("backupImportModal").classList.contains("hidden")`);
    eq(await page.eval(`document.getElementById("biApply").disabled`), true, "Replace disabled until confirmed");
    eq(await page.eval(`document.getElementById("biConfirmWrap").classList.contains("hidden")`), false, "confirm shown");
    const replaceText = await page.eval(`document.getElementById("biReplaceText").textContent`);
    assert(/1 video/.test(replaceText), `replace text mentions current library: ${replaceText}`);
    await page.shot("03-import-preview-replace");

    await page.mouseClick("#biConfirm");
    eq(await page.eval(`document.getElementById("biApply").disabled`), false, "Replace enabled after confirm");
    await page.mouseClick("#biApply");
    const safety = await waitForDownload(b, { prefix: "tubestack-pre-restore-backup-" });
    eq(JSON.parse(safety.text).data.items.map((x) => x.id), ["own-1"], "safety file holds the previous library");
    await page.waitFor(`document.getElementById("biStatus").classList.contains("success")`);
    eq((await storageGet(page, "items")).items.length, 14, "library replaced");
  } finally {
    await b.close();
  }
});

scenario("a corrupt or unrelated file is rejected in the preview and nothing changes", async () => {
  const b = await launch("bad");
  try {
    let page = await openDashboard(b);
    await page.eval(`chrome.storage.local.set({ settings: { onboardingComplete: true } })`);
    page = await openDashboard(b);
    const before = await storageGet(page);
    const files = {
      "garbage.json": "{ this is not json",
      "unrelated.json": JSON.stringify({ roots: { bookmark_bar: {} } }),
      "future.json": JSON.stringify({ format: "tubestack-backup", version: 99, data: {} }),
    };
    for (const [name, text] of Object.entries(files)) {
      const p = path.join(b.downloads, name);
      fs.writeFileSync(p, text);
      await page.setFile("#backupFileInput", p);
      await page.waitFor(`!document.getElementById("backupImportModal").classList.contains("hidden")`);
      eq(await page.eval(`document.getElementById("biTitle").textContent`), "This file can’t be restored", `${name} rejected`);
      eq(await page.eval(`document.getElementById("biApply").classList.contains("hidden")`), true, `${name}: no Replace button`);
      if (name === "future.json") {
        assert(/newer TubeStack/.test(await page.eval(`document.getElementById("biStatus").textContent`)), "explains version");
        await page.shot("04-import-rejected");
      }
      await page.mouseClick("#biCancel");
    }
    eq(await storageGet(page), before, "storage unchanged");
  } finally {
    await b.close();
  }
});

scenario("onboarding: YouTube setup is optional, skippable, and the full guide opens styled", async () => {
  const b = await launch("oobe");
  try {
    const page = await openDashboard(b);
    await page.waitFor(`!document.getElementById("onboarding").classList.contains("hidden")`);
    await page.shot("05-welcome");
    await page.mouseClick("#obNext0");
    await page.waitFor(`!document.getElementById("obStep1").classList.contains("hidden")`);
    const step1 = await page.eval(`document.getElementById("obStep1").innerText`);
    for (const s of ["Connect YouTube", "Optional", "Set Up YouTube Integration", "Skip for Now", "View full setup guide"]) {
      assert(step1.toLowerCase().includes(s.toLowerCase()), `step shows "${s}"`);
    }
    await page.shot("06-connect-youtube-step");

    const { targetInfos: beforeTargets } = await b.cdp.send("Target.getTargets");
    await page.mouseClick("#obShowFullGuide");
    let guide = null;
    for (let i = 0; i < 50 && !guide; i++) {
      const { targetInfos } = await b.cdp.send("Target.getTargets");
      guide = targetInfos.find((t) => t.url.endsWith("dashboard/setup-guide.html") && !beforeTargets.some((x) => x.targetId === t.targetId));
      if (!guide) await sleep(100);
    }
    assert(guide, "full setup guide opened in a new tab");
    if (guide) {
      const g = await attach(b, guide.targetId);
      await g.waitFor(`document.readyState === "complete"`);
      await sleep(200);
      const bg = await g.eval(`getComputedStyle(document.body).backgroundColor`);
      assert(!/rgb\(255, 255, 255\)|rgba\(0, 0, 0, 0\)/.test(bg), `guide is themed, not white (${bg})`);
      const uri = await g.eval(`document.getElementById("sgRedirectUri").textContent`);
      assert(/^https:\/\/[a-p]{32}\.chromiumapp\.org\/?$/.test(uri), `redirect URI filled in: ${uri}`);
      eq(await g.eval(`document.querySelectorAll(".sg-step").length`), 6, "six step cards");
      assert((await g.eval(`document.querySelectorAll(".sg-faq").length`)) >= 4, "troubleshooting entries");
      await g.shot("07-setup-guide");
      await b.cdp.send("Target.closeTarget", { targetId: guide.targetId });
      await page.send("Page.bringToFront");
    }

    await page.mouseClick("#obSkipYoutube");
    await page.waitFor(`!document.getElementById("obStep5").classList.contains("hidden")`, { label: "skip jumps to categories" });
    shared.oobe = { b, page };
  } catch (e) {
    await b.close();
    throw e;
  }
});

scenario("onboarding: click favorites, double-click super-favorites, keyboard and ★ alternatives", async () => {
  if (!shared.oobe) throw new Error("needs the previous onboarding scenario");
  const { b, page } = shared.oobe;
  try {
    const legend = await page.eval(`document.getElementById("obGenreLegend").innerText`);
    assert(/Click\s+to favorite/.test(legend) && /Double-click/.test(legend), `inline guidance: ${legend}`);
    const ids = await page.eval(`themes.slice(0, 5).map((t) => t.id)`);
    const tile = (i) => `[data-focus-key="${ids[i]}:tile"]`;
    const star = (i) => `[data-focus-key="${ids[i]}:star"]`;
    const tierOf = (i) => page.eval(`chrome.storage.local.get("themes").then((b) => b.themes.find((t) => t.id === ${JSON.stringify(ids[i])}).tier)`);

    // Single click → green favorite.
    await page.mouseClick(tile(0));
    await page.waitFor(`document.querySelector('${tile(0)}')?.classList.contains("genre-tile-active")`, { label: "tile 0 green" });
    eq(await tierOf(0), "active", "single click stores favorite (green)");
    eq(await page.eval(`document.querySelector('${tile(0)}').getAttribute("aria-pressed")`), "true", "aria-pressed on favorite");
    eq(await page.eval(`document.querySelector('${tile(0)} .genre-tile-state').textContent`), "Favorite", "visible state label");

    // Double click → gold super favorite (and not a stray green toggle).
    await page.mouseClick(tile(1), 2);
    await page.waitFor(`document.querySelector('${tile(1)}')?.classList.contains("genre-tile-favorite")`, { label: "tile 1 gold" });
    await sleep(500);
    eq(await tierOf(1), "favorite", "double-click stores super favorite (gold)");
    eq(await page.eval(`document.querySelector('${tile(1)} .genre-tile-state').textContent`), "Super favorite", "gold label");
    eq(await page.eval(`document.querySelector('${star(1)}').getAttribute("aria-pressed")`), "true", "star pressed on gold");

    // The three states are visually distinct.
    const colors = await page.eval(`[${JSON.stringify(tile(2))}, ${JSON.stringify(tile(0))}, ${JSON.stringify(tile(1))}].map((s) => getComputedStyle(document.querySelector(s)).borderTopColor)`);
    eq(new Set(colors).size, 3, `normal/favorite/super have distinct borders ${colors}`);
    await page.shot("08-genre-tiles");

    // Keyboard: Enter → favorite, Shift+Enter → super favorite; focus survives the re-render.
    await page.eval(`document.querySelector('${tile(2)}').focus()`);
    await page.key("Enter");
    await page.waitFor(`document.querySelector('${tile(2)}')?.classList.contains("genre-tile-active")`, { label: "Enter favorites" });
    eq(await page.eval(`document.activeElement.dataset.focusKey`), `${ids[2]}:tile`, "focus kept on the tile");
    await page.key("Enter", { shift: true });
    await page.waitFor(`document.querySelector('${tile(2)}')?.classList.contains("genre-tile-favorite")`, { label: "Shift+Enter super" });

    // ★ button: reachable by keyboard / touch, toggles super favorite directly.
    await page.eval(`document.querySelector('${star(3)}').focus()`);
    await page.key(" ");
    await page.waitFor(`document.querySelector('${tile(3)}')?.classList.contains("genre-tile-favorite")`, { label: "star makes gold" });
    eq(await page.eval(`document.activeElement.dataset.focusKey`), `${ids[3]}:star`, "focus kept on the star");
    await page.mouseClick(star(3));
    await page.waitFor(`document.querySelector('${tile(3)}')?.classList.contains("genre-tile-active")`, { label: "star un-golds to green" });

    // Continue and finish without YouTube.
    await page.mouseClick("#obNextGenres");
    await page.waitFor(`!document.getElementById("obStep6").classList.contains("hidden")`);
    eq(await page.eval(`document.getElementById("obStep4OptionalLinks").classList.contains("hidden")`), true, "no repeat YouTube nag after skipping");
    eq(await page.eval(`document.getElementById("obStep4LeadMinimal").classList.contains("hidden")`), false, "one calm note instead");
    eq(page.dialogs, [], "no alert/confirm dialogs during onboarding");
    await page.mouseClick("#obFinish");
    await page.waitFor(`document.getElementById("onboarding").classList.contains("hidden")`, { label: "onboarding finished" });
    const s = (await storageGet(page, "settings")).settings;
    eq([s.onboardingComplete, s.personalizationMode], [true, "staple"], "setup completed in local mode");
  } finally {
    await b.close();
  }
});

// ---------------------------------------------------------------- runner

(async () => {
  if (!findChromium()) {
    console.log(
      "SKIP: no standalone Chromium found. Set TUBESTACK_CHROMIUM or run `npx playwright install chromium`.\n" +
        "(Branded Google Chrome is deliberately not used: it ignores --load-extension and holds your real profile.)"
    );
    process.exit(0);
  }
  for (const s of scenarios) {
    if (ONLY && !s.name.includes(ONLY)) continue;
    ran++;
    const before = failed;
    process.stdout.write(`- ${s.name}\n`);
    try {
      await s.fn();
    } catch (err) {
      console.error("  FAIL (threw):", err && err.stack ? err.stack : err);
      failed++;
    }
    if (failed === before) process.stdout.write("  ok\n");
  }
  if (shared.backupPath) fs.rmSync(shared.backupPath, { force: true });
  if (failed) {
    console.error(`\n${failed} assertion(s) failed across ${ran} scenario(s).`);
    process.exit(1);
  }
  console.log(`\nOK: browser e2e passed (${ran} scenarios).`);
})();

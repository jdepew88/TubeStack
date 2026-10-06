/**
 * Minimal in-memory Chrome extension API fake, just enough to run the real
 * background/service-worker.js under Node and drive it through chrome.runtime.onMessage.
 *
 * Deliberately loads the production worker rather than re-implementing it, so the tests exercise the
 * actual save/verify/close ordering instead of a parallel model of it.
 *
 * The "browser" (storage, tabs, event registries) lives in a `browser` object that outlives any
 * single worker sandbox, so `restartWorker()` can model an MV3 service worker being suspended and
 * started again: JS state is discarded, persisted state is not.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const nodeCrypto = require("crypto");

const ROOT = path.join(__dirname, "..");

function makeEvent() {
  const listeners = [];
  return {
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListener: (fn) => listeners.includes(fn),
    _listeners: listeners,
    _reset() {
      listeners.length = 0;
    },
    _emit(...args) {
      return listeners.slice().map((fn) => fn(...args));
    },
  };
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * @param {object} opts
 * @param {object}   [opts.storage]  initial chrome.storage.local contents
 * @param {Array}    [opts.tabs]     tabs: {id, windowId, index, url, title, active}
 * @param {object}   [opts.tabMeta]  tabId -> payload returned for TUBESTACK_GET_METADATA
 * @param {Function} [opts.onSet]    (obj, store) => may throw, to force a storage write failure
 * @param {Function} [opts.onRemove] (tabId)      => may throw, to force a tab close failure
 * @param {Function} [opts.fetch]    (url)        => Response-ish, for oembed
 */
function createBrowser(opts = {}) {
  const store = clone(opts.storage || {});
  const tabs = (opts.tabs || []).map((t) => ({ ...t }));
  const log = { closedTabIds: [], createdUrls: [], setKeys: [], fetches: [] };
  const hooks = { onSet: opts.onSet || null, onRemove: opts.onRemove || null, fetch: opts.fetch || null };
  let nextTabId = 9000;

  const events = {
    onMessage: makeEvent(),
    onInstalled: makeEvent(),
    storageChanged: makeEvent(),
    tabsRemoved: makeEvent(),
    contextMenusClicked: makeEvent(),
  };

  const currentWindowId = () =>
    opts.currentWindowId ?? tabs.find((t) => t.active)?.windowId ?? tabs[0]?.windowId ?? 1;

  const local = {
    async get(keys) {
      if (keys == null) return clone(store);
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in store) out[k] = clone(store[k]);
      return out;
    },
    async set(obj) {
      log.setKeys.push(Object.keys(obj));
      if (hooks.onSet) await hooks.onSet(obj, store);
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: clone(store[k]), newValue: clone(v) };
        store[k] = clone(v);
      }
      events.storageChanged._emit(changes, "local");
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      for (const k of list) {
        if (k in store) {
          changes[k] = { oldValue: clone(store[k]), newValue: undefined };
          delete store[k];
        }
      }
      if (Object.keys(changes).length) events.storageChanged._emit(changes, "local");
    },
  };

  const chrome = {
    runtime: {
      id: "tubestack-test",
      lastError: undefined,
      getURL: (p) => `chrome-extension://tubestack-test/${p}`,
      getManifest: () => JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")),
      onMessage: events.onMessage,
      onInstalled: events.onInstalled,
    },
    storage: { local, onChanged: events.storageChanged },
    tabs: {
      onRemoved: events.tabsRemoved,
      async query(info = {}) {
        const winId = info.currentWindow ? currentWindowId() : info.windowId;
        return tabs
          .filter((t) => (winId == null ? true : t.windowId === winId))
          .filter((t) => (info.active == null ? true : Boolean(t.active) === Boolean(info.active)))
          .map((t) => ({ ...t }));
      },
      async get(id) {
        const t = tabs.find((x) => x.id === id);
        if (!t) throw new Error(`No tab with id: ${id}`);
        return { ...t };
      },
      async remove(id) {
        if (hooks.onRemove) await hooks.onRemove(id);
        const i = tabs.findIndex((x) => x.id === id);
        if (i < 0) throw new Error(`No tab with id: ${id}`);
        tabs.splice(i, 1);
        log.closedTabIds.push(id);
        events.tabsRemoved._emit(id, {});
      },
      async create({ url }) {
        const t = { id: nextTabId++, windowId: currentWindowId(), index: tabs.length, url, title: url };
        tabs.push(t);
        log.createdUrls.push(url);
        return { ...t };
      },
      async update(id, props) {
        const t = tabs.find((x) => x.id === id);
        if (t) Object.assign(t, props);
        return t ? { ...t } : undefined;
      },
      async sendMessage(tabId, msg) {
        if (msg?.type !== "TUBESTACK_GET_METADATA") return undefined;
        const meta = (opts.tabMeta || {})[tabId];
        if (!meta) throw new Error("Could not establish connection.");
        return { ok: true, data: meta };
      },
    },
    scripting: {
      async executeScript() {
        return [];
      },
    },
    contextMenus: {
      onClicked: events.contextMenusClicked,
      create() {},
      removeAll(cb) {
        if (cb) cb();
      },
    },
    action: { async setPopup() {} },
    sidePanel: { async setPanelBehavior() {} },
    identity: {
      getRedirectURL: () => "https://tubestack-test.chromiumapp.org/",
      async launchWebAuthFlow() {
        throw new Error("not available in tests");
      },
    },
    permissions: {
      async contains() {
        return true;
      },
      async request() {
        return true;
      },
    },
  };

  return { chrome, store, tabs, log, events, hooks, opts };
}

/**
 * Boots a worker sandbox on top of `browser`. Calling it again on the same browser models a service
 * worker restart: listeners are re-registered from scratch and every in-memory cache is gone.
 */
function startWorker(browser, { quiet = true } = {}) {
  for (const ev of Object.values(browser.events)) ev._reset();

  const sandbox = {
    chrome: browser.chrome,
    console: quiet ? { log() {}, warn() {}, error() {}, info() {}, debug() {} } : console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortSignal,
    AbortController,
    Promise,
    crypto: { randomUUID: () => nodeCrypto.randomUUID() },
    async fetch(url) {
      browser.log.fetches.push(String(url));
      if (browser.hooks.fetch) return browser.hooks.fetch(String(url));
      return { ok: false, status: 404, async json() { return {}; } };
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.importScripts = (...rel) => {
    for (const r of rel) {
      const file = path.resolve(path.join(ROOT, "background"), r);
      vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
    }
  };

  const ctx = vm.createContext(sandbox);
  const swPath = path.join(ROOT, "background", "service-worker.js");
  vm.runInContext(fs.readFileSync(swPath, "utf8"), ctx, { filename: swPath });

  /** Dispatch a runtime message the way Chrome does and await the sendResponse value. */
  function send(msg) {
    return new Promise((resolve, reject) => {
      const listeners = browser.events.onMessage._listeners;
      if (!listeners.length) return reject(new Error("no onMessage listener registered"));
      let done = false;
      const timer = setTimeout(() => {
        if (!done) reject(new Error(`no response for ${msg?.type}`));
      }, 20000);
      if (timer.unref) timer.unref();
      listeners[0](msg, { id: "tubestack-test" }, (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      });
    });
  }

  return { browser, sandbox, send, restart: () => startWorker(browser, { quiet }) };
}

/** Convenience: fresh browser + worker in one call. */
function bootExtension(opts = {}) {
  const browser = createBrowser(opts);
  return startWorker(browser, { quiet: opts.quiet !== false });
}

module.exports = { bootExtension, createBrowser, startWorker, makeEvent };

#!/usr/bin/env node
/**
 * Lightweight tests for lib/youtube-url.js (run: node scripts/test-youtube-url.cjs)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const code = fs.readFileSync(path.join(root, "lib", "youtube-url.js"), "utf8");
const sandbox = { URL };
sandbox.globalThis = sandbox;
vm.runInNewContext(code, sandbox);
const YT = sandbox.TUBESTACK_YT_URL;

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  }
}

const WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const WATCH_M = "https://m.youtube.com/watch?v=dQw4w9WgXcQ";
const SHORTS = "https://www.youtube.com/shorts/dQw4w9WgXcQ";
const SHORTS_M = "https://m.youtube.com/shorts/dQw4w9WgXcQ";

assert(YT.extractYouTubeVideoId(WATCH) === "dQw4w9WgXcQ", "watch desktop id");
assert(YT.extractYouTubeVideoId(WATCH_M) === "dQw4w9WgXcQ", "watch mobile id");
assert(YT.extractYouTubeVideoId(SHORTS) === "dQw4w9WgXcQ", "shorts desktop id");
assert(YT.extractYouTubeVideoId(SHORTS_M) === "dQw4w9WgXcQ", "shorts mobile id");

assert(YT.isYouTubeWatchUrl(WATCH), "is watch desktop");
assert(YT.isYouTubeWatchUrl(WATCH_M), "is watch mobile");
assert(!YT.isYouTubeWatchUrl(SHORTS), "shorts not watch url");

assert(YT.isYouTubeShortsUrl(SHORTS), "is shorts desktop");
assert(YT.isYouTubeShortsUrl(SHORTS_M), "is shorts mobile");
assert(!YT.isYouTubeShortsUrl(WATCH), "watch not shorts url");

assert(YT.isSupportedYouTubeVideoUrl(WATCH), "supported watch");
assert(YT.isSupportedYouTubeVideoUrl(SHORTS), "supported shorts");
assert(!YT.isSupportedYouTubeVideoUrl("https://www.youtube.com/feed/subscriptions"), "feed not supported");

assert(
  YT.canonicalYouTubeVideoUrl("dQw4w9WgXcQ", { shorts: true }) ===
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
  "canonical shorts"
);

if (failed) {
  console.error(`${failed} test(s) failed.`);
  process.exit(1);
}
console.log("OK: youtube-url tests passed.");

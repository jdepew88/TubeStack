const test = require("node:test");
const assert = require("node:assert/strict");

require("../lib/youtube-url.js");

const { extractYouTubePlaylistId } = globalThis.TUBESTACK_YT_URL;

test("extracts playlist IDs from supported YouTube URL forms", () => {
  const id = "PL1234567890abcdef";
  assert.equal(extractYouTubePlaylistId(`https://www.youtube.com/playlist?list=${id}`), id);
  assert.equal(extractYouTubePlaylistId(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${id}`), id);
  assert.equal(extractYouTubePlaylistId(`music.youtube.com/playlist?list=${id}`), id);
  assert.equal(extractYouTubePlaylistId(id), id);
});

test("rejects malformed IDs and non-YouTube hosts", () => {
  assert.equal(extractYouTubePlaylistId("https://example.com/playlist?list=PL1234567890abcdef"), null);
  assert.equal(extractYouTubePlaylistId("https://www.youtube.com/playlist?list=short"), null);
  assert.equal(extractYouTubePlaylistId("not a playlist"), null);
});

test("rejects auto-generated mix/radio playlist IDs", () => {
  assert.equal(extractYouTubePlaylistId("RDEM1234567890abcdef"), null);
  assert.equal(
    extractYouTubePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ"),
    null
  );
});

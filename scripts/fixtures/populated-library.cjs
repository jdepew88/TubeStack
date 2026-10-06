/**
 * A realistic, populated chrome.storage.local for TubeStack — shaped like a long-lived install, not a
 * one-video toy. Used by scripts/test-backup.cjs. Every field name matches what background/service-worker.js
 * and lib/watch-states.js actually read and write.
 *
 * Secrets are obviously fake strings, used only to prove they never reach a backup file.
 */

const THEME = {
  music: "8d1c2a5e-0001-4a7b-9c1d-000000000001",
  diy: "8d1c2a5e-0002-4a7b-9c1d-000000000002",
  science: "8d1c2a5e-0003-4a7b-9c1d-000000000003",
  gaming: "8d1c2a5e-0004-4a7b-9c1d-000000000004",
  cooking: "8d1c2a5e-0005-4a7b-9c1d-000000000005",
  travel: "8d1c2a5e-0006-4a7b-9c1d-000000000006",
  history: "8d1c2a5e-0007-4a7b-9c1d-000000000007",
};

const VID = [
  "dQw4w9WgXcQ", "kJQP7kiw5Fk", "9bZkp7q19f0", "JGwWNGJdvx8", "OPf0YbXqDm0", "RgKAFK5djSk",
  "fJ9rUzIMcZQ", "hT_nvWreIhg", "CevxZvSJLk8", "YQHsXMglC9A", "e-ORhEE9VVg", "60ItHLz5WEA",
  "2Vv-BfVoq4g", "pRpeEdMmmQ0",
];

const SECRETS = {
  youtubeDataApiKey: "AIzaSyFAKE-youtube-data-api-key-0000000",
  openaiApiKey: "sk-proj-FAKE-openai-key-1111111111111111",
  youtubeOAuthClientId: "123456789012-fakeclientid.apps.googleusercontent.com",
  youtubeAccountEmail: "fake.person@example.com",
  // Fields a future build might add — the name-pattern guard must keep them out too.
  anthropicApiKey: "sk-ant-FAKE-anthropic-key-2222222222",
  googleRefreshToken: "1//FAKE-refresh-token-3333333333",
};

function item(i, extra = {}) {
  const vid = VID[i];
  return {
    id: `item-${String(i + 1).padStart(4, "0")}-6a2f-4c1e-9d3b`,
    url: `https://www.youtube.com/watch?v=${vid}`,
    videoId: vid,
    title: `Video title ${i + 1}`,
    channel: `Channel ${(i % 5) + 1}`,
    thumbnail: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
    durationSec: 300 + i * 97,
    timestampSec: null,
    savedAt: `2026-0${(i % 8) + 1}-1${i % 9}T12:00:00.000Z`,
    category: "watch_later",
    tags: [],
    suggestedTags: [],
    priority: "prio_med",
    notes: "",
    note: "",
    watchState: "queue",
    timestampNotes: [],
    themeId: null,
    ...extra,
  };
}

function snap(it, order) {
  return {
    itemId: it.id,
    videoId: it.videoId,
    url: it.url,
    title: it.title,
    channel: it.channel,
    thumbnail: it.thumbnail,
    durationSec: it.durationSec,
    order,
  };
}

function populatedStorage() {
  const items = [
    item(0, { themeId: THEME.music, priority: "prio_high", tags: ["synth", "live"], watchState: "finished" }),
    item(1, {
      themeId: THEME.diy,
      notes: "Great walkthrough of the wiring step.",
      note: "Great walkthrough of the wiring step.",
      watchState: "watching",
      timestampNotes: [
        { id: "tn_a1", timeSeconds: 95, label: "Wiring", note: "Ground goes first", createdAt: "2026-03-01T10:00:00.000Z" },
        { id: "tn_a2", timeSeconds: 610, label: "", note: "Torque spec 12Nm", createdAt: "2026-03-01T10:05:00.000Z", updatedAt: "2026-03-02T08:00:00.000Z" },
      ],
    }),
    item(2, { themeId: THEME.science, watchState: "important", priority: "prio_high", libraryAlbum: "Physics series", playlistName: "Physics series" }),
    item(3, { themeId: THEME.science, watchState: "reference", priority: "prio_low" }),
    item(4, { themeId: THEME.gaming, watchState: "skip", priority: "prio_low", tags: ["speedrun"] }),
    item(5, {
      themeId: THEME.cooking,
      notes: "Use less salt next time",
      note: "Use less salt next time",
      timestampNotes: [{ id: "tn_b1", timeSeconds: 42, label: "Dough", note: "Rest 30 min", createdAt: "2026-04-11T09:00:00.000Z" }],
    }),
    item(6, { themeId: THEME.travel, watchState: "saved" }),
    item(7, { themeId: THEME.music, watchState: "add_to_playlist", granularGenre: "synthwave" }),
    item(8, {
      themeId: THEME.history,
      libraryImportSource: "youtube_playlist",
      youtubePlaylistId: "PLfakeImport000001",
      libraryAlbum: "Ancient Rome",
      playlistName: "Ancient Rome",
      importBatchId: "batch-2026-05-01",
    }),
    item(9, { themeId: THEME.history, libraryImportSource: "youtube_playlist", youtubePlaylistId: "PLfakeImport000001", libraryAlbum: "Ancient Rome", playlistName: "Ancient Rome" }),
    item(10, { url: `https://www.youtube.com/shorts/${VID[10]}`, contentType: "shorts", durationSec: 45 }),
    item(11, { themeId: THEME.diy, priority: "prio_high", watchState: "finished", lastOpenedAt: "2026-06-20T19:30:00.000Z" }),
    item(12, { themeId: null, watchState: "queue" }),
    item(13, { themeId: THEME.cooking, priority: "prio_med", tags: ["bread", "weekend"] }),
  ];

  const themes = [
    { id: THEME.music, label: "Music", keywords: ["music", "synth", "concert"], tier: "favorite" },
    { id: THEME.diy, label: "DIY & repair", keywords: ["diy", "repair", "fix"], tier: "favorite" },
    { id: THEME.science, label: "Science & education", keywords: ["physics", "science"], tier: "active" },
    { id: THEME.gaming, label: "Gaming", keywords: ["game", "speedrun"], tier: "off" },
    { id: THEME.cooking, label: "Cooking", keywords: ["recipe", "bread"], tier: "active" },
    { id: THEME.travel, label: "Travel & culture", keywords: ["travel"], tier: "off" },
    { id: THEME.history, label: "History", keywords: ["rome", "history"], tier: "active", customLabel: true },
  ];

  const localPlaylists = [
    {
      id: "pl-0001-session-weekend",
      name: "Weekend projects",
      createdAt: "2026-06-01T15:00:00.000Z",
      // Deliberately non-chronological order: custom ordering must survive.
      items: [snap(items[11], 0), snap(items[1], 1), snap(items[13], 2), snap(items[5], 3)],
      kind: "static",
      groupBy: null,
      smartSummary: null,
      stackNote: "Do the wiring one first, then bake.",
      researchSummary: "Two DIY videos cover the same panel.",
      decisions: [{ id: "dec_1", title: "Buy the 12Nm torque wrench", reason: "Both videos use it", createdAt: "2026-06-02T09:00:00.000Z" }],
      playlistSource: "session",
    },
    {
      id: "pl-0002-smart-science",
      name: "Smart: Science by priority",
      createdAt: "2026-05-20T11:00:00.000Z",
      items: [snap(items[2], 0), snap(items[3], 1), snap(items[0], 2)],
      kind: "smart",
      groupBy: "priority",
      smartSummary: "Science & education, high priority first",
      stackNote: "",
      researchSummary: "",
      decisions: [],
      playlistSource: "session",
    },
    {
      id: "pl-0003-yt-import-rome",
      name: "Ancient Rome",
      createdAt: "2026-05-01T08:00:00.000Z",
      items: [snap(items[8], 0), snap(items[9], 1)],
      kind: "static",
      groupBy: null,
      smartSummary: null,
      stackNote: "",
      researchSummary: "",
      decisions: [],
      playlistSource: "youtube_import",
      youtubePlaylistId: "PLfakeImport000001",
    },
    {
      id: "pl-0004-session-music",
      name: "Late night music",
      createdAt: "2026-06-18T23:00:00.000Z",
      items: [snap(items[7], 0), snap(items[0], 1)],
      kind: "static",
      groupBy: null,
      smartSummary: null,
      stackNote: "",
      researchSummary: "",
      decisions: [],
      playlistSource: "session",
    },
  ];

  const videoProgress = {
    [VID[0]]: { playheadSec: 300, durationSec: 300, updatedAt: "2026-06-10T20:00:00.000Z", totalWatchedSec: 300, progressSource: "observed_youtube_page" },
    [VID[1]]: { playheadSec: 610, durationSec: 397, updatedAt: "2026-06-11T20:00:00.000Z", totalWatchedSec: 380, progressSource: "observed_youtube_page" },
    [VID[2]]: { playheadSec: 120, durationSec: 494, updatedAt: "2026-06-12T20:00:00.000Z", totalWatchedSec: 120, progressSource: "captured_on_save", capturedAt: "2026-06-12T20:00:00.000Z" },
    [VID[11]]: { playheadSec: 1367, durationSec: 1367, updatedAt: "2026-06-20T20:00:00.000Z", totalWatchedSec: 1367, progressSource: "manual" },
  };

  const watchByDay = { "2026-06-10": 300, "2026-06-11": 380, "2026-06-12": 120, "2026-06-20": 1367 };

  const subscriptionChannels = [
    { name: "Channel 1", channelId: "UCfake0000000000000001", thumbnailUrl: "", newItemCount: 2, fetchedAt: "2026-06-01T00:00:00.000Z", addedAt: "2026-01-01T00:00:00.000Z", source: "youtube_oauth" },
    { name: "Channel 2", channelId: "UCfake0000000000000002", thumbnailUrl: "", newItemCount: 0, fetchedAt: "2026-06-01T00:00:00.000Z", addedAt: "2026-01-01T00:00:00.000Z", source: "youtube_oauth" },
    { name: "Scraped Channel", addedAt: "2026-02-01T00:00:00.000Z", source: "scrape" },
  ];

  const settings = {
    onboardingComplete: true,
    uiThemePreset: "ocean",
    sidebarHidden: false,
    libraryShowYoutubeImported: false,
    currentPlaylistId: "pl-0001-session-weekend",
    currentPlaylistName: "Weekend projects",
    personalizationMode: "full",
    youtubeChannelHandle: "@fakechannel",
    latestImportBatchId: "batch-2026-05-01",
    latestImportAt: "2026-05-01T08:00:00.000Z",
    youtubeLastScanSummary: { channelTitle: "Fake channel", categoryBreakdown: { 10: 4, 28: 2 }, scannedAt: "2026-05-01T08:00:00.000Z" },
    sidebarSectionVisibility: { focus: true, watchAnalytics: false, subscriptions: true },
    // Per-install / secret fields that must not travel:
    youtubeApiLastTestAt: "2026-05-01T08:00:00.000Z",
    youtubeApiLastTestOk: true,
    openaiLastTestOk: true,
    focusSession: { startedAt: 1, endsAt: 2, minutes: 25 },
    ...SECRETS,
  };

  return {
    items,
    localPlaylists,
    themes,
    videoProgress,
    watchByDay,
    subscriptionChannels,
    settings,
    // Transient / cache keys that must not travel:
    saveOperations: [{ id: "op-1", state: "completed", createdAt: "2026-06-20T00:00:00.000Z", updatedAt: "2026-06-20T00:00:00.000Z" }],
    metadataRepairState: { [VID[12]]: { attempts: 2, lastAt: "2026-06-20T00:00:00.000Z" } },
    sidebarPlayback: { playlistId: "pl-0004-session-music", index: 1, activeTabId: 77 },
    openAiLibraryClassifyV1: { abc123: { themeId: THEME.music, at: 1 } },
  };
}

const UI_PREFERENCES = {
  ts_view_mode: "grid",
  ts_grid_tile_size: "3",
  ts_category_sort: "desc",
  ts_home_pl_sort: "recent",
  ts_library_scope: "all",
};

module.exports = { populatedStorage, SECRETS, THEME, VID, UI_PREFERENCES };

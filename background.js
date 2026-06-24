const STATIC_TRACKER_DOMAINS = [
  "google-analytics.com", "doubleclick.net", "facebook.net",
  "googlesyndication.com", "amazon-adsystem.com", "criteo.com",
  "taboola.com", "hotjar.com", "mixpanel.com", "googletagmanager.com",
  "outbrain.com", "scorecardresearch.com", "segment.io", "optimizely.com",
  "ads.yahoo.com", "bing.com", "tiktok.com", "twitter.com",
  "snap.licdn.com", "adnxs.com"
];

function todayString() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });

  const stored = await chrome.storage.local.get(["enabled", "stats", "trackerLog", "whitelist", "blacklist", "initialized"]);
  if (stored.enabled === undefined) await chrome.storage.local.set({ enabled: true });
  if (!stored.stats) {
    await chrome.storage.local.set({
      stats: {
        totalBlocked: 0,
        todayBlocked: 0,
        lastResetDate: todayString(),
        lastMatchedCount: 0,
        uniqueTrackers: {}
      }
    });
  }
  if (!stored.trackerLog) await chrome.storage.local.set({ trackerLog: [] });
  if (!stored.whitelist) await chrome.storage.local.set({ whitelist: [] });
  if (!stored.blacklist) await chrome.storage.local.set({ blacklist: [] });

  // Start polling for accurate counts
  startPolling();
});

chrome.runtime.onStartup.addListener(() => {
  startPolling();
});

// ---------------------------------------------------------------------------
// Accurate blocking via getMatchedRules polling
// This works in both packed and unpacked mode (unlike onRuleMatchedDebug)
// ---------------------------------------------------------------------------

let lastKnownMatchCount = 0;

async function pollMatchedRules() {
  try {
    const stored = await chrome.storage.local.get(["stats", "trackerLog"]);
    let stats = stored.stats || {
      totalBlocked: 0,
      todayBlocked: 0,
      lastResetDate: todayString(),
      lastMatchedCount: 0,
      uniqueTrackers: {}
    };
    const log = stored.trackerLog || [];

    // Daily reset check
    const today = todayString();
    if (stats.lastResetDate !== today) {
      stats.todayBlocked = 0;
      stats.lastResetDate = today;
      stats.lastMatchedCount = 0;
      lastKnownMatchCount = 0;
    }

    // Get actual matched rules from the browser
    const matched = await chrome.declarativeNetRequest.getMatchedRules({});
    const currentCount = matched.rulesMatchedInfo ? matched.rulesMatchedInfo.length : 0;

    // Only count new matches since last poll
    const lastCount = stats.lastMatchedCount || lastKnownMatchCount || 0;
    const newMatches = Math.max(0, currentCount - lastCount);

    if (newMatches > 0) {
      stats.totalBlocked = (stats.totalBlocked || 0) + newMatches;
      stats.todayBlocked = (stats.todayBlocked || 0) + newMatches;
      stats.lastMatchedCount = currentCount;
      lastKnownMatchCount = currentCount;

      // Log new matched domains
      const newEntries = matched.rulesMatchedInfo
        ? matched.rulesMatchedInfo.slice(lastCount).slice(0, newMatches)
        : [];

      for (const entry of newEntries) {
        try {
          const domain = new URL(entry.request.url).hostname.replace(/^www\./, "");
          stats.uniqueTrackers = stats.uniqueTrackers || {};
          stats.uniqueTrackers[domain] = (stats.uniqueTrackers[domain] || 0) + 1;
          log.unshift({ domain, url: entry.request.url, time: Date.now() });
        } catch (e) { /* ignore malformed URL */ }
      }
      if (log.length > 200) log.length = 200;

      await chrome.storage.local.set({ stats, trackerLog: log });

      // Update badge with today's count
      const enabled = (await chrome.storage.local.get(["enabled"])).enabled !== false;
      if (enabled) {
        chrome.action.setBadgeText({ text: String(stats.todayBlocked) });
        chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      }
    }
  } catch (e) {
    // getMatchedRules may not be available in all contexts — fall through silently
  }
}

// Also keep onRuleMatchedDebug for dev-mode instant feedback
if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (details) => {
    try {
      const stored = await chrome.storage.local.get(["stats", "trackerLog"]);
      let stats = stored.stats || {
        totalBlocked: 0, todayBlocked: 0, lastResetDate: todayString(),
        lastMatchedCount: 0, uniqueTrackers: {}
      };
      const log = stored.trackerLog || [];

      const today = todayString();
      if (stats.lastResetDate !== today) {
        stats.todayBlocked = 0;
        stats.lastResetDate = today;
      }

      stats.totalBlocked = (stats.totalBlocked || 0) + 1;
      stats.todayBlocked = (stats.todayBlocked || 0) + 1;

      try {
        const domain = new URL(details.request.url).hostname.replace(/^www\./, "");
        stats.uniqueTrackers = stats.uniqueTrackers || {};
        stats.uniqueTrackers[domain] = (stats.uniqueTrackers[domain] || 0) + 1;
        log.unshift({ domain, url: details.request.url, time: Date.now() });
        if (log.length > 200) log.pop();
      } catch (e) {}

      await chrome.storage.local.set({ stats, trackerLog: log });

      const enabled = (await chrome.storage.local.get(["enabled"])).enabled !== false;
      if (enabled) {
        chrome.action.setBadgeText({ text: String(stats.todayBlocked) });
        chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      }
    } catch (err) {
      console.error("Privacy Shield: error recording blocked request", err);
    }
  });
}

function startPolling() {
  // Poll every 3 seconds for accurate real-time counts
  setInterval(pollMatchedRules, 3000);
  // Also poll immediately
  pollMatchedRules();
}

// Start polling when service worker wakes
startPolling();

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "TOGGLE_EXTENSION") {
    chrome.storage.local.set({ enabled: msg.enabled }, () => {
      if (!msg.enabled) {
        chrome.action.setBadgeText({ text: "OFF" });
        chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
        chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ["static_blocklist"] });
      } else {
        chrome.action.setBadgeText({ text: "" });
        chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
        chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ["static_blocklist"] });
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "CLEAR_DATA") {
    const fresh = {
      enabled: true,
      whitelist: [],
      blacklist: [],
      stats: {
        totalBlocked: 0,
        todayBlocked: 0,
        lastResetDate: todayString(),
        lastMatchedCount: 0,
        uniqueTrackers: {}
      },
      trackerLog: []
    };
    chrome.storage.local.set(fresh, () => {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      lastKnownMatchCount = 0;
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "GET_STATIC_DOMAINS") {
    sendResponse({ domains: STATIC_TRACKER_DOMAINS });
    return true;
  }
});

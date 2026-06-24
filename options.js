// ============================================================
// Privacy Shield - options.js
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {

  // ── NAV ────────────────────────────────────────────────────
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      item.classList.add("active");
      const pageId = "page-" + item.getAttribute("data-page");
      document.getElementById(pageId).classList.add("active");
      if (item.getAttribute("data-page") === "analytics") loadAnalytics();
    });
  });

  // ── WHITELIST ───────────────────────────────────────────────
  const wlInput  = document.getElementById("wlInput");
  const wlAddBtn = document.getElementById("wlAddBtn");
  const wlList   = document.getElementById("wlList");

  await renderWhitelist();

  wlAddBtn.addEventListener("click", async () => {
    const domain = cleanDomain(wlInput.value);
    if (!domain) return;
    const stored = await chrome.storage.local.get("whitelist");
    const list = stored.whitelist || [];
    if (list.find(e => e.domain === domain)) { showToast("Domain already in whitelist."); return; }
    list.push({ domain, added: new Date().toLocaleDateString() });
    await chrome.storage.local.set({ whitelist: list });
    await syncWhitelistRules(list);
    wlInput.value = "";
    await renderWhitelist();
    showToast("Added to whitelist.");
  });

  async function renderWhitelist() {
    const stored = await chrome.storage.local.get("whitelist");
    const list = stored.whitelist || [];
    wlList.innerHTML = "";
    if (list.length === 0) { wlList.innerHTML = '<div class="empty-state">No domains whitelisted yet.</div>'; return; }
    list.forEach((entry, idx) => {
      const div = document.createElement("div");
      div.className = "domain-entry";
      div.innerHTML = `
        <div>
          <div class="domain-name">${entry.domain}</div>
          <div class="added-date">Added ${entry.added || "recently"}</div>
        </div>
        <button class="btn-sm btn-sm-danger" data-idx="${idx}">Remove</button>
      `;
      div.querySelector("button").addEventListener("click", async () => {
        list.splice(idx, 1);
        await chrome.storage.local.set({ whitelist: list });
        await syncWhitelistRules(list);
        await renderWhitelist();
        showToast("Removed from whitelist.");
      });
      wlList.appendChild(div);
    });
  }

  async function syncWhitelistRules(whitelistArr) {
    // Whitelist rules use priority 4 (highest) with action: allow
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const wlRuleIds = existing.filter(r => r.priority === 4).map(r => r.id);
    const toAdd = whitelistArr.map((entry, i) => ({
      id: 5000 + i,
      priority: 4,
      action: { type: "allow" },
      condition: {
        requestDomains: [entry.domain],
        resourceTypes: ["main_frame","sub_frame","script","image","xmlhttprequest","stylesheet","font","media","websocket"]
      }
    }));
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: wlRuleIds, addRules: toAdd });
  }

  // ── BLACKLIST ───────────────────────────────────────────────
  const blInput  = document.getElementById("blInput");
  const blAddBtn = document.getElementById("blAddBtn");
  const blList   = document.getElementById("blList");

  await renderBlacklist();

  blAddBtn.addEventListener("click", async () => {
    const domain = cleanDomain(blInput.value);
    if (!domain) return;
    const stored = await chrome.storage.local.get("blacklist");
    const list = stored.blacklist || [];
    if (list.find(e => e.domain === domain)) { showToast("Domain already in blacklist."); return; }
    list.push({ domain, added: new Date().toLocaleDateString() });
    await chrome.storage.local.set({ blacklist: list });
    await syncBlacklistRules(list);
    blInput.value = "";
    await renderBlacklist();
    showToast("Added to blacklist.");
  });

  async function renderBlacklist() {
    const stored = await chrome.storage.local.get("blacklist");
    const list = stored.blacklist || [];
    blList.innerHTML = "";
    if (list.length === 0) { blList.innerHTML = '<div class="empty-state">No custom domains added yet.</div>'; return; }
    list.forEach((entry, idx) => {
      const div = document.createElement("div");
      div.className = "domain-entry";
      div.innerHTML = `
        <div>
          <div class="domain-name">${entry.domain}</div>
          <div class="added-date">Added ${entry.added || "recently"}</div>
        </div>
        <button class="btn-sm btn-sm-danger" data-idx="${idx}">Remove</button>
      `;
      div.querySelector("button").addEventListener("click", async () => {
        list.splice(idx, 1);
        await chrome.storage.local.set({ blacklist: list });
        await syncBlacklistRules(list);
        await renderBlacklist();
        showToast("Removed from blacklist.");
      });
      blList.appendChild(div);
    });
  }

  async function syncBlacklistRules(blacklistArr) {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const blRuleIds = existing.filter(r => r.priority === 5).map(r => r.id);
    const toAdd = blacklistArr.map((entry, i) => ({
      id: 6000 + i,
      priority: 5,
      action: { type: "block" },
      condition: {
        urlFilter: `||${entry.domain}^`,
        resourceTypes: ["main_frame","sub_frame","script","image","xmlhttprequest","stylesheet","font","media","websocket"]
      }
    }));
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: blRuleIds, addRules: toAdd });
  }

  // ── ANALYTICS ──────────────────────────────────────────────
  async function loadAnalytics() {
    const stored = await chrome.storage.local.get("stats");
    const stats = stored.stats || { totalBlocked: 0, todayBlocked: 0, uniqueTrackers: {} };
    document.getElementById("statTotal").textContent = stats.totalBlocked || 0;
    document.getElementById("statToday").textContent = stats.todayBlocked || 0;
    const uniqueEntries = Object.entries(stats.uniqueTrackers || {});
    document.getElementById("statUnique").textContent = uniqueEntries.length;

    const wrap = document.getElementById("trackerTableWrap");
    if (uniqueEntries.length === 0) {
      wrap.innerHTML = '<div class="empty-state">No tracking data available yet. Browse some websites to see results.</div>';
      return;
    }
    uniqueEntries.sort((a, b) => b[1] - a[1]);
    const top20 = uniqueEntries.slice(0, 20);
    let html = `<table class="tracker-table">
      <thead><tr><th>#</th><th>Domain</th><th>Blocked</th></tr></thead><tbody>`;
    top20.forEach(([domain, count], i) => {
      html += `<tr><td style="color:#475569;">${i + 1}</td><td>${domain}</td><td class="tracker-count">${count}</td></tr>`;
    });
    html += `</tbody></table>`;
    wrap.innerHTML = html;
  }

  // ── IMPORT / EXPORT ────────────────────────────────────────
  document.getElementById("exportStats").addEventListener("click", async () => {
    const stored = await chrome.storage.local.get("stats");
    downloadJSON(stored.stats || {}, "privacyshield-stats.json");
  });

  document.getElementById("exportWhitelist").addEventListener("click", async () => {
    const stored = await chrome.storage.local.get("whitelist");
    downloadJSON(stored.whitelist || [], "privacyshield-whitelist.json");
  });

  document.getElementById("exportBlacklist").addEventListener("click", async () => {
    const stored = await chrome.storage.local.get("blacklist");
    downloadJSON(stored.blacklist || [], "privacyshield-blacklist.json");
  });

  document.getElementById("importFileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        // Determine if whitelist or blacklist by checking filename
        if (file.name.includes("whitelist")) {
          await chrome.storage.local.set({ whitelist: data });
          await syncWhitelistRules(data);
          await renderWhitelist();
          showToast("Whitelist imported successfully.");
        } else if (file.name.includes("blacklist")) {
          await chrome.storage.local.set({ blacklist: data });
          await syncBlacklistRules(data);
          await renderBlacklist();
          showToast("Blacklist imported successfully.");
        } else {
          showToast("Unknown file type. Name file with 'whitelist' or 'blacklist'.");
        }
      } else if (data.totalBlocked !== undefined) {
        await chrome.storage.local.set({ stats: data });
        showToast("Statistics imported successfully.");
      } else {
        showToast("Unrecognized JSON format.");
      }
    } catch {
      showToast("Invalid JSON file.");
    }
    e.target.value = "";
  });

  document.getElementById("clearAllBtn").addEventListener("click", async () => {
    if (!confirm("This will permanently clear all Privacy Shield data. Are you sure?")) return;
    await chrome.runtime.sendMessage({ type: "CLEAR_STATS" });
    await chrome.storage.local.remove(["whitelist", "blacklist"]);
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    if (existing.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map(r => r.id) });
    }
    await renderWhitelist();
    await renderBlacklist();
    showToast("All data cleared.");
  });

  // ── ABOUT - static domain tags ─────────────────────────────
  const domainsResponse = await chrome.runtime.sendMessage({ type: "GET_STATIC_DOMAINS" });
  const tagsContainer = document.getElementById("staticDomainTags");
  if (domainsResponse && domainsResponse.domains) {
    domainsResponse.domains.forEach(d => {
      const span = document.createElement("span");
      span.className = "tracker-tag";
      span.textContent = d;
      tagsContainer.appendChild(span);
    });
  }

  // ── HELPERS ────────────────────────────────────────────────
  function cleanDomain(raw) {
    return raw.trim().toLowerCase()
      .replace(/^(?:https?:\/\/)?(?:www\.)?/i, "")
      .split("/")[0];
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported: ${filename}`);
  }

  function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2800);
  }
});

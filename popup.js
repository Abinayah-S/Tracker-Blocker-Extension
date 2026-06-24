document.addEventListener("DOMContentLoaded", async () => {
  const counterEl    = document.getElementById("blockCounter");
  const counterRing  = document.getElementById("counterRing");
  const statusBar    = document.getElementById("statusBar");
  const toggleSwitch = document.getElementById("toggleSwitch");
  const domainInput  = document.getElementById("domainInput");
  const allowBtn     = document.getElementById("allowBtn");
  const blockBtn     = document.getElementById("blockBtn");
  const rulesList    = document.getElementById("rulesList");
  const footerStats  = document.getElementById("footerStats");
  const footerToday  = document.getElementById("footerToday");
  const optionsBtn   = document.getElementById("optionsBtn");

  // Show blocked count for this page (badge text)
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    try {
      const badgeText = await chrome.action.getBadgeText({ tabId: activeTab.id });
      counterEl.textContent = (badgeText && badgeText !== "OFF") ? badgeText : "0";
    } catch {
      counterEl.textContent = "0";
    }
  }

  const stored = await chrome.storage.local.get(["enabled", "stats"]);
  const isEnabled = stored.enabled !== false;
  toggleSwitch.checked = isEnabled;
  updateUI(isEnabled);
  updateFooter(stored.stats);

  await renderRules();

  toggleSwitch.addEventListener("change", async () => {
    const newVal = toggleSwitch.checked;
    updateUI(newVal);
    await chrome.runtime.sendMessage({ type: "TOGGLE_EXTENSION", enabled: newVal });
  });

  allowBtn.addEventListener("click", () => addRule("allow"));
  blockBtn.addEventListener("click", () => addRule("block"));

  optionsBtn.addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open(chrome.runtime.getURL("options.html"));
  });

  // Refresh stats every 2 seconds while popup is open
  setInterval(async () => {
    const s = await chrome.storage.local.get(["stats"]);
    updateFooter(s.stats);
    // Also update the circle with the badge (today's page count stays from badge)
    if (activeTab) {
      try {
        const badgeText = await chrome.action.getBadgeText({ tabId: activeTab.id });
        if (badgeText && badgeText !== "OFF") counterEl.textContent = badgeText;
      } catch {}
    }
  }, 2000);

  function updateFooter(stats) {
    const total = stats?.totalBlocked || 0;
    const today = stats?.todayBlocked || 0;
    footerStats.textContent = `Total: ${total}`;
    footerToday.textContent = `Today: ${today}`;
  }

  function updateUI(enabled) {
    if (enabled) {
      counterRing.classList.remove("disabled");
      statusBar.textContent = "Privacy Shield is active";
      statusBar.style.color = "#34d399";
    } else {
      counterRing.classList.add("disabled");
      counterEl.textContent = "0";
      statusBar.textContent = "Protection is turned OFF";
      statusBar.style.color = "#94a3b8";
    }
  }

  async function renderRules() {
    if (!rulesList) return;
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    rulesList.innerHTML = "";

    if (rules.length === 0) {
      rulesList.innerHTML = '<div style="font-size:11px; color:#64748b; padding:5px;">No custom rules</div>';
      return;
    }

    rules.forEach((rule) => {
      const typeStr = rule.action.type === "allow" ? "ALLOW" : "BLOCK";
      const color   = rule.action.type === "allow" ? "#34d399" : "#f87171";
      let displayFilter = "";
      if (rule.condition.urlFilter) {
        displayFilter = rule.condition.urlFilter.replace(/^\|\|/, "").replace(/\^$/, "");
      } else if (rule.condition.requestDomains) {
        displayFilter = rule.condition.requestDomains[0] || "";
      }

      const item = document.createElement("div");
      item.style = "display:flex; justify-content:space-between; align-items:center; background:#1e293b; padding:5px; margin-top:5px; border-radius:4px; font-size:11px;";
      item.innerHTML = `
        <div><strong style="color:${color}">${typeStr}</strong> ${displayFilter}</div>
        <button class="btn-remove" data-id="${rule.id}" data-domain="${displayFilter}" data-type="${rule.action.type}" style="background:none; border:none; color:#94a3b8; cursor:pointer;">✕</button>
      `;
      rulesList.appendChild(item);
    });

    rulesList.querySelectorAll(".btn-remove").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id   = parseInt(e.currentTarget.getAttribute("data-id"));
        const domain = e.currentTarget.getAttribute("data-domain");
        const type   = e.currentTarget.getAttribute("data-type");

        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [id] });

        const key = type === "allow" ? "whitelist" : "blacklist";
        const storageData = await chrome.storage.local.get(key);
        const currentList = storageData[key] || [];
        await chrome.storage.local.set({ [key]: currentList.filter(item => item.domain !== domain) });

        await renderRules();
      });
    });
  }

  async function addRule(actionType) {
    const raw = domainInput.value.trim().toLowerCase();
    if (!raw) return;
    const domain = raw.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split("/")[0];
    if (!domain) return;

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const dup = existing.find(r =>
      (r.condition.urlFilter === `||${domain}^`) ||
      (r.condition.requestDomains && r.condition.requestDomains.includes(domain))
    );
    if (dup) {
      domainInput.style.borderColor = "#f59e0b";
      setTimeout(() => { domainInput.style.borderColor = "#334155"; }, 1500);
      return;
    }

    const newId = existing.length > 0 ? Math.max(...existing.map(r => r.id)) + 1 : 2000;

    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        id: newId,
        priority: actionType === "allow" ? 3 : 2,
        action: { type: actionType },
        condition: {
          urlFilter: `||${domain}^`,
          resourceTypes: ["main_frame", "sub_frame", "script", "image", "xmlhttprequest"]
        }
      }]
    });

    const key = actionType === "allow" ? "whitelist" : "blacklist";
    const storageData = await chrome.storage.local.get(key);
    const currentList = storageData[key] || [];
    currentList.push({ domain, added: new Date().toLocaleDateString() });
    await chrome.storage.local.set({ [key]: currentList });

    domainInput.value = "";
    await renderRules();
  }
});

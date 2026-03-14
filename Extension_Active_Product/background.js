chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ running: false });
});

// ── Lấy tab trang web (windowTypes normal, không phải popup extension) ──
async function getPageTab() {
  // Lấy tất cả cửa sổ normal đang mở, lấy cái được focus gần nhất
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"], populate: true });
  if (!windows.length) return null;
  // Ưu tiên cửa sổ focused
  const focused = windows.find(w => w.focused) || windows[windows.length - 1];
  const active = focused.tabs?.find(t => t.active);
  return active || null;
}

// ── Chuyển sang tab kế tiếp trong cửa sổ chứa tab đó ───
async function switchToNextTab(fromTabId) {
  // Lấy thông tin tab hiện tại để biết windowId
  let windowId;
  try {
    const tab = await chrome.tabs.get(fromTabId);
    windowId = tab.windowId;
  } catch {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    windowId = win?.id;
  }
  if (!windowId) return null;

  const tabs = await chrome.tabs.query({ windowId });
  if (tabs.length < 2) return null;
  const cur = tabs.find(t => t.id === fromTabId) || tabs.find(t => t.active);
  const nextIndex = (tabs.indexOf(cur) + 1) % tabs.length;
  const nextTab = tabs[nextIndex];
  await chrome.tabs.update(nextTab.id, { active: true });
  return nextTab.id;
}

// ── Gửi startAutomate đến tab, retry nếu tab chưa load ─
async function triggerTab(tabId, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "startAutomate" });
      return; // thành công
    } catch {
      // Content script chưa sẵn sàng — chờ rồi thử lại
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.warn("Không thể gửi startAutomate đến tab", tabId);
}

// ── Mở tất cả link trong bảng ───────────────────────────
async function openAllLinks() {
  const tab = await getPageTab();
  if (!tab) return { opened: 0, error: "Không tìm thấy tab" };

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const tableLinks = Array.from(
          document.querySelectorAll("table a[href], .table a[href], [class*='table'] a[href]")
        );
        const links = tableLinks.length > 0 ? tableLinks
          : Array.from(document.querySelectorAll("a[href]")).filter(a => {
              const r = a.getBoundingClientRect();
              return r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0;
            });
        const origin = window.location.origin, path = window.location.pathname;
        const resolved = links.map(a => {
          const h = a.getAttribute("href"); if (!h) return null;
          if (h.startsWith("http")) return h;
          if (h.startsWith("#")) return origin + path + h;
          if (h.startsWith("/")) return origin + h;
          return null;
        }).filter(Boolean);
        return [...new Set(resolved)];
      }
    });
  } catch (e) { return { opened: 0, error: e.message }; }

  const urls = results?.[0]?.result || [];
  if (!urls.length) return { opened: 0, error: "Không tìm thấy link nào" };
  for (const url of urls) await chrome.tabs.create({ url, active: false });
  return { opened: urls.length };
}

// ── Message listener ─────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Tab vừa xong automation → chuyển sang tab kế và trigger tiếp
  if (msg.action === "tabAutoDone") {
    chrome.storage.local.get("running", async ({ running }) => {
      if (!running) return;
      const fromTabId = sender.tab?.id;
      const nextTabId = await switchToNextTab(fromTabId);
      if (nextTabId) {
        // Chờ tab load xong rồi mới trigger
        setTimeout(() => triggerTab(nextTabId), 2000);
      }
    });
    return;
  }

  if (msg.action === "openLinks") {
    openAllLinks().then(sendResponse);
    return true;
  }

  if (msg.action === "start") {
    chrome.storage.local.set({ running: true });
    sendResponse({ ok: true });
    // Trigger tab đang active ngay lập tức
    setTimeout(async () => {
      const tab = await getPageTab();
      if (tab) triggerTab(tab.id);
    }, 200);
    return true;
  }

  if (msg.action === "stop") {
    chrome.storage.local.set({ running: false });
    sendResponse({ ok: true });
  }

  if (msg.action === "getState") {
    chrome.storage.local.get(["running"], sendResponse);
    return true;
  }
});

// ── Phím tắt Ctrl+Shift+O mở link ───────────────────────
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "open-all-links") openAllLinks();
});
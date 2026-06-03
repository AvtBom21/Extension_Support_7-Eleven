chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ running: false });
});

// ── Lấy tab trang web (windowTypes normal, không phải popup extension) ──
async function getPageTab() {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"], populate: true });
  if (!windows.length) return null;
  const focused = windows.find(w => w.focused) || windows[windows.length - 1];
  const active = focused.tabs?.find(t => t.active);
  return active || null;
}

// ── Chuyển sang tab kế tiếp trong cửa sổ chứa tab đó ───
async function switchToNextTab(fromTabId) {
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

// ✅ Thay sleep cứng bằng probe thực: ping content script đến khi respond
// Nhanh hơn nhiều so với chờ fixed timeout khi tab đã sẵn sàng
async function triggerTab(tabId, maxWaitMs = 15000) {
  const t0 = Date.now();
  const interval = 500; // probe mỗi 500ms

  while (Date.now() - t0 < maxWaitMs) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "startAutomate" });
      return; // ✅ Thành công ngay khi content script sẵn sàng
    } catch {
      // Content script chưa ready — chờ rồi thử lại
      await new Promise(r => setTimeout(r, interval));
    }
  }
  console.warn("Không thể gửi startAutomate đến tab", tabId, "sau", maxWaitMs, "ms");
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
        // ✅ Không sleep cứng — triggerTab tự probe đến khi tab sẵn sàng
        // Chỉ delay nhỏ 300ms để tab kịp focus trước khi probe
        setTimeout(() => triggerTab(nextTabId), 300);
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
// ── Toast ────────────────────────────────────────────────
function toast(msg, type = "info") {
  let t = document.getElementById("__tm__");
  if (!t) {
    t = document.createElement("div");
    t.id = "__tm__";
    const s = document.createElement("style");
    s.textContent = `@keyframes tmIn{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}`;
    document.head.appendChild(s);
    document.body.appendChild(t);
  }
  const c = {
    success: ["#1a2e1a","#4ade80"],
    info:    ["#1a1a2e","#a78bfa"],
    warn:    ["#2e2a1a","#fbbf24"],
    error:   ["#2e1a1a","#f87171"],
  }[type] || ["#1a1a2e","#a78bfa"];
  Object.assign(t.style, {
    position:"fixed", bottom:"24px", right:"24px", zIndex:"2147483647",
    background:c[0], color:c[1], border:`1px solid ${c[1]}44`,
    borderRadius:"12px", padding:"12px 18px",
    fontFamily:"'Segoe UI',sans-serif", fontSize:"13px", fontWeight:"600",
    boxShadow:"0 8px 24px rgba(0,0,0,.5)", animation:"tmIn .2s ease",
    maxWidth:"320px", lineHeight:"1.6",
  });
  t.textContent = msg;
  clearTimeout(t._t);
  t._t = setTimeout(() => t?.remove(), 7000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function findBtn(text) {
  return [...document.querySelectorAll("button")].find(b =>
    b.offsetParent !== null && b.textContent.trim().includes(text)
  );
}

// Poll mỗi 400ms cho đến khi nút xuất hiện VÀ không bị disabled
function waitBtnEnabled(text, timeout = 30000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function poll() {
      const b = findBtn(text);
      if (b && !b.disabled && !b.classList.contains("disabled") && !b.hasAttribute("disabled")) {
        resolve(b); return;
      }
      if (Date.now() - t0 > timeout) { resolve(null); return; }
      setTimeout(poll, 400);
    })();
  });
}

// Bật toggle về YES
async function enableToggle(fieldLabel) {
  const field = document.querySelector(`[data-selector="field-${fieldLabel}"]`);
  if (!field) { toast(`⚠️ Không tìm thấy: ${fieldLabel}`, "warn"); return; }

  // Nếu đang là Yes rồi thì thôi
  const viewSpan = field.querySelector("span[data-selector]");
  if (viewSpan && viewSpan.textContent.trim() === "Yes") return;

  // Click vào span để vào edit mode
  if (viewSpan) { viewSpan.click(); await sleep(500); }

  // Thử từng loại toggle
  const tries = [
    field.querySelector(".vue-js-switch"),
    field.querySelector("[class*='toggle']"),
    field.querySelector("[class*='switch']"),
    field.querySelector("input[type='checkbox']"),
    [...field.querySelectorAll("input[type='radio']")]
      .find(r => r.value === "true" || r.value === "1" || r.value === "Yes"),
    [...field.querySelectorAll("label, div, span")]
      .find(el => !el.children.length && el.textContent.trim() === "Yes"),
  ].filter(Boolean);

  for (const el of tries) {
    const isOn = (el.type === "checkbox" || el.type === "radio") ? el.checked : false;
    if (!isOn) { el.click(); await sleep(400); break; }
  }
}

// ── MAIN AUTOMATION ──────────────────────────────────────
let __tmRunning = false;

async function runAutomation() {
  if (__tmRunning) return;
  __tmRunning = true;

  try {
    toast("🤖 Bắt đầu tự động duyệt...", "info");
    await sleep(600);

    // BƯỚC 1: Nhấn Edit
    const editBtn = findBtn("Edit");
    if (!editBtn) {
      toast("❌ Không tìm thấy nút Edit!", "error");
      await sleep(1500);
      chrome.runtime.sendMessage({ action: "tabAutoDone" });
      return;
    }
    toast("📝 Nhấn Edit...", "info");
    editBtn.click();
    await sleep(1500); // chờ form mở

    // BƯỚC 2: Bật MD Approve + Final Approve
    toast("🔘 Bật MD Approve...", "info");
    await enableToggle("MD Approve");
    await sleep(400);

    toast("🔘 Bật Final Approve...", "info");
    await enableToggle("Final Approve");
    await sleep(600);

    // BƯỚC 3: Lặp Save qua từng step cho đến khi hết
    let step = 1;
    while (true) {
      toast(`⏳ Chờ nút Save step ${step} enable...`, "warn");

      const saveBtn = await waitBtnEnabled("Save and move to next step", 30000);

      if (!saveBtn) {
        toast("⚠️ Timeout 30s — chuyển tab tiếp...", "warn");
        await sleep(1000);
        break;
      }

      toast(`💾 Nhấn Save step ${step}...`, "info");
      saveBtn.click();
      step++;

      // Chờ trang xử lý (nút sẽ disable rồi biến mất, sau đó step mới load)
      await sleep(2500);

      // Kiểm tra còn nút Save không sau khi load
      const nextSave = findBtn("Save and move to next step");
      if (!nextSave) {
        toast(`✅ Hoàn tất! Đã lưu ${step - 1} steps. Chuyển tab...`, "success");
        await sleep(1200);
        break;
      }
      // Còn → tiếp tục vòng lặp
    }

    chrome.runtime.sendMessage({ action: "tabAutoDone" });

  } catch (err) {
    toast(`❌ Lỗi: ${err.message}`, "error");
    await sleep(2000);
    chrome.runtime.sendMessage({ action: "tabAutoDone" });
  } finally {
    __tmRunning = false;
  }
}

// ── Lắng nghe message từ background ─────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "startAutomate") runAutomation();
});
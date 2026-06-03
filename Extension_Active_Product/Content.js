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

// Poll 150ms — resolve NGAY khi button sẵn sàng
function waitBtnEnabled(text, timeout = 30000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function poll() {
      const b = findBtn(text);
      if (b && !b.disabled && !b.classList.contains("disabled") && !b.hasAttribute("disabled")) {
        resolve(b); return;
      }
      if (Date.now() - t0 > timeout) { resolve(null); return; }
      setTimeout(poll, 150);
    })();
  });
}

// Chờ button BIẾN MẤT — xác nhận page đang chuyển thực sự
function waitForButtonGone(text, timeout = 8000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function poll() {
      if (!findBtn(text)) { resolve(true); return; }
      if (Date.now() - t0 > timeout) { resolve(false); return; }
      setTimeout(poll, 150);
    })();
  });
}

// Chờ element xuất hiện trong DOM
function waitForElement(selector, timeout = 8000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function poll() {
      const el = document.querySelector(selector);
      if (el) { resolve(el); return; }
      if (Date.now() - t0 > timeout) { resolve(null); return; }
      setTimeout(poll, 150);
    })();
  });
}

// Lấy số step đang active (1–6)
function getCurrentStep() {
  const active = document.querySelector(".tab-bar li.active");
  if (!active) return 0;
  const m = active.textContent.trim().match(/^(\d+)\./);
  return m ? parseInt(m[1]) : 0;
}

// Chờ step DOM ổn định: giá trị giữ nguyên 2 lần poll liên tiếp
function waitForStableStep(timeout = 8000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let last = -1;
    (function poll() {
      const cur = getCurrentStep();
      if (cur > 0 && cur === last) { resolve(cur); return; }
      last = cur;
      if (Date.now() - t0 > timeout) { resolve(cur || 0); return; }
      setTimeout(poll, 150);
    })();
  });
}

// ✅ Đọc giá trị hiện tại của field (Yes/No/text)
function getFieldValue(field) {
  // Trường hợp 1: span view-mode
  const viewSpan = field.querySelector("span[data-selector]");
  if (viewSpan) return viewSpan.textContent.trim();

  // Trường hợp 2: checkbox/radio
  const checkbox = field.querySelector("input[type='checkbox']");
  if (checkbox) return checkbox.checked ? "Yes" : "No";

  const radio = [...field.querySelectorAll("input[type='radio']")].find(r => r.checked);
  if (radio) return radio.value;

  // Trường hợp 3: vue toggle — kiểm tra class active
  const toggle = field.querySelector(".vue-js-switch");
  if (toggle) return toggle.classList.contains("toggled") ? "Yes" : "No";

  return "";
}

// ✅ Click toggle element bên trong field
function clickToggleInField(field) {
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
    if (!isOn) { el.click(); return true; }
  }
  return false;
}

// ✅ FIX CHÍNH: enableToggle có verify + retry
// Sau mỗi lần click, chờ và kiểm tra giá trị thực sự đã thành "Yes" chưa
// Nếu chưa → thử lại tối đa maxRetries lần
async function enableToggle(fieldLabel, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Chờ field xuất hiện (đảm bảo form edit đã render)
    const field = await waitForElement(`[data-selector="field-${fieldLabel}"]`, 8000);
    if (!field) {
      toast(`⚠️ Không tìm thấy field: ${fieldLabel}`, "warn");
      return false;
    }

    // Kiểm tra giá trị hiện tại
    const currentVal = getFieldValue(field);
    if (currentVal === "Yes") {
      return true; // ✅ Đã đúng — không cần làm gì
    }

    // Nếu đang ở view mode, click để mở edit mode trước
    const viewSpan = field.querySelector("span[data-selector]");
    if (viewSpan) {
      viewSpan.click();
      await sleep(300); // Chờ form mở ra
    }

    // Click toggle
    clickToggleInField(field);

    // ✅ VERIFY: Chờ tối đa 1.5s để giá trị đổi thành "Yes"
    const verified = await new Promise(resolve => {
      const t0 = Date.now();
      (function check() {
        const f = document.querySelector(`[data-selector="field-${fieldLabel}"]`);
        if (!f) { resolve(false); return; }
        if (getFieldValue(f) === "Yes") { resolve(true); return; }
        if (Date.now() - t0 > 1500) { resolve(false); return; }
        setTimeout(check, 150);
      })();
    });

    if (verified) {
      return true; // ✅ Đã verify thành công
    }

    // Chưa đổi → retry
    toast(`🔄 Retry ${attempt}/${maxRetries}: ${fieldLabel}...`, "warn");
    await sleep(300);
  }

  toast(`❌ Không bật được: ${fieldLabel} sau ${maxRetries} lần thử`, "error");
  return false;
}

// ── MAIN AUTOMATION ──────────────────────────────────────
let __tmRunning = false;

async function runAutomation() {
  if (__tmRunning) return;
  __tmRunning = true;

  try {
    toast("🤖 Bắt đầu tự động duyệt...", "info");

    // BƯỚC 1: Nhấn Edit
    const editBtn = await waitBtnEnabled("Edit", 10000);
    if (!editBtn) {
      toast("❌ Không tìm thấy nút Edit!", "error");
      chrome.runtime.sendMessage({ action: "tabAutoDone" });
      return;
    }
    toast("📝 Nhấn Edit...", "info");
    editBtn.click();

    // ✅ FIX: Chờ form edit render xong — đợi Save button xuất hiện
    // (khi Save button hiện = form đã load đầy đủ, toggle mới click được)
    toast("⏳ Chờ form load...", "info");
    const formReady = await waitBtnEnabled("Save and move to next step", 10000);
    if (!formReady) {
      toast("❌ Form không load được!", "error");
      chrome.runtime.sendMessage({ action: "tabAutoDone" });
      return;
    }

    // BƯỚC 2: Bật MD Approve + Final Approve với verify + retry
    toast("🔘 Bật MD Approve...", "info");
    const mdOk = await enableToggle("MD Approve");
    if (!mdOk) toast("⚠️ MD Approve có thể chưa bật!", "warn");

    toast("🔘 Bật Final Approve...", "info");
    const faOk = await enableToggle("Final Approve");
    if (!faOk) toast("⚠️ Final Approve có thể chưa bật!", "warn");

    // BƯỚC 3: Lặp Save qua từng step
    let step = 1;
    while (true) {
      toast(`⏳ Chờ Save step ${step}...`, "warn");

      const saveBtn = await waitBtnEnabled("Save and move to next step", 30000);
      if (!saveBtn) {
        toast("⚠️ Timeout chờ Save — chuyển tab...", "warn");
        break;
      }

      const curStep = await waitForStableStep(3000);

      if (curStep === 5) {
        toast("💾 Step 5 — Save...", "info");
        saveBtn.click();
        await waitForButtonGone("Save and move to next step", 5000);
        toast("⚡ Xong step 5 — chuyển tab!", "success");
        break;
      }

      toast(`💾 Save step ${step} (step ${curStep})...`, "info");
      saveBtn.click();
      step++;

      const gone = await waitForButtonGone("Save and move to next step", 8000);
      if (!gone) {
        toast(`⚠️ Step ${step - 1} chưa chuyển, thử lại...`, "warn");
        continue;
      }

      if (!findBtn("Save and move to next step") && step > 5) {
        toast(`✅ Hoàn tất! Chuyển tab...`, "success");
        break;
      }
    }

    chrome.runtime.sendMessage({ action: "tabAutoDone" });

  } catch (err) {
    toast(`❌ Lỗi: ${err.message}`, "error");
    chrome.runtime.sendMessage({ action: "tabAutoDone" });
  } finally {
    __tmRunning = false;
  }
}

// ── Lắng nghe từ background ──────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "startAutomate") runAutomation();
});
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

// Poll mỗi 300ms cho đến khi nút xuất hiện VÀ enabled
function waitBtnEnabled(text, timeout = 30000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function poll() {
      const b = findBtn(text);
      if (b && !b.disabled && !b.classList.contains("disabled") && !b.hasAttribute("disabled")) {
        resolve(b); return;
      }
      if (Date.now() - t0 > timeout) { resolve(null); return; }
      setTimeout(poll, 300);
    })();
  });
}

// Bật toggle YES
async function enableToggle(fieldLabel) {
  const field = document.querySelector(`[data-selector="field-${fieldLabel}"]`);
  if (!field) { toast(`⚠️ Không tìm thấy: ${fieldLabel}`, "warn"); return; }

  const viewSpan = field.querySelector("span[data-selector]");
  if (viewSpan && viewSpan.textContent.trim() === "Yes") return;

  if (viewSpan) { viewSpan.click(); await sleep(500); }

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
    if (!isOn) { el.click(); await sleep(300); break; }
  }
}

// Lấy số step đang active (1–6)
function getCurrentStep() {
  const active = document.querySelector(".tab-bar li.active");
  if (!active) return 0;
  const m = active.textContent.trim().match(/^(\d+)\./);
  return m ? parseInt(m[1]) : 0;
}

// ── MAIN AUTOMATION ──────────────────────────────────────
let __tmRunning = false;

async function runAutomation() {
  if (__tmRunning) return;
  __tmRunning = true;

  try {
    toast("🤖 Bắt đầu tự động duyệt...", "info");
    await sleep(500);

    // BƯỚC 1: Nhấn Edit
    const editBtn = findBtn("Edit");
    if (!editBtn) {
      toast("❌ Không tìm thấy nút Edit!", "error");
      await sleep(1000);
      chrome.runtime.sendMessage({ action: "tabAutoDone" });
      return;
    }
    toast("📝 Nhấn Edit...", "info");
    editBtn.click();
    await sleep(1000);

    // BƯỚC 2: Bật MD Approve + Final Approve
    toast("🔘 Bật MD & Final Approve...", "info");
    await enableToggle("MD Approve");
    await sleep(300);
    await enableToggle("Final Approve");
    await sleep(400);

    // BƯỚC 3: Lặp Save qua từng step
    let step = 1;
    while (true) {
      toast(`⏳ Chờ Save step ${step}...`, "warn");

      const saveBtn = await waitBtnEnabled("Save and move to next step", 30000);
      if (!saveBtn) {
        toast("⚠️ Timeout — chuyển tab tiếp...", "warn");
        await sleep(300);
        break;
      }

      const curStep = getCurrentStep();

      if (curStep === 5) {
        // Step 5 (Set up Online): chờ thêm 1s rồi nhấn → chuyển tab ngay
        toast("⏱️ Step 5 — chờ 1s rồi Save...", "warn");
        await sleep(1000);
        saveBtn.click();
        toast("⚡ Xong step 5 — chuyển tab ngay!", "success");
        await sleep(200);
        break;
      }

      // Step khác: nhấn ngay khi enable, rồi chờ trang load step tiếp
      toast(`💾 Save step ${step}...`, "info");
      saveBtn.click();
      step++;

      await sleep(2500);

      const nextSave = findBtn("Save and move to next step");
      if (!nextSave) {
        toast(`✅ Hoàn tất ${step - 1} steps. Chuyển tab...`, "success");
        await sleep(300);
        break;
      }
    }

    chrome.runtime.sendMessage({ action: "tabAutoDone" });

  } catch (err) {
    toast(`❌ Lỗi: ${err.message}`, "error");
    await sleep(1000);
    chrome.runtime.sendMessage({ action: "tabAutoDone" });
  } finally {
    __tmRunning = false;
  }
}

// ── Lắng nghe từ background ──────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "startAutomate") runAutomation();
});
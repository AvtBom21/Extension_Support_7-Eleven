const btn = document.getElementById("mainBtn");
const dot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const openLinksBtn = document.getElementById("openLinksBtn");

let isRunning = false;

chrome.runtime.sendMessage({ action: "getState" }, (data) => {
  if (data) { isRunning = data.running || false; updateUI(); }
});

openLinksBtn.addEventListener("click", () => {
  openLinksBtn.textContent = "⏳ Đang mở...";
  openLinksBtn.disabled = true;
  chrome.runtime.sendMessage({ action: "openLinks" }, (res) => {
    openLinksBtn.textContent = res?.error ? `❌ ${res.error}` : `✅ Đã mở ${res?.opened || 0} tab!`;
    setTimeout(() => {
      openLinksBtn.textContent = "🔗 Mở tất cả link hiện tại";
      openLinksBtn.disabled = false;
    }, 2500);
  });
});

btn.addEventListener("click", () => {
  if (!isRunning) {
    isRunning = true;
    // KHÔNG đóng popup ngay — gửi message xong rồi mới đóng
    chrome.runtime.sendMessage({ action: "start" }, () => {
      updateUI();
      setTimeout(() => window.close(), 300);
    });
  } else {
    isRunning = false;
    chrome.runtime.sendMessage({ action: "stop" }, () => {
      updateUI();
      setTimeout(() => window.close(), 200);
    });
  }
});

function updateUI() {
  if (isRunning) {
    dot.classList.add("active");
    statusText.textContent = "Đang tự động duyệt...";
    btn.textContent = "⏹ Dừng lại";
    btn.className = "btn btn-stop";
  } else {
    dot.classList.remove("active");
    statusText.textContent = "Sẵn sàng";
    btn.textContent = "▶ Bắt đầu tự động duyệt";
    btn.className = "btn btn-start";
  }
}
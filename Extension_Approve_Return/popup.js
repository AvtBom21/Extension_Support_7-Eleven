const STORAGE_KEY = 'rs_code_list';

// Load saved codes on open
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) document.getElementById('codeInput').value = saved;
});

// Save on input
document.getElementById('codeInput').addEventListener('input', () => {
  localStorage.setItem(STORAGE_KEY, document.getElementById('codeInput').value);
});

// Clear button
document.getElementById('btnClear').addEventListener('click', () => {
  document.getElementById('codeInput').value = '';
  localStorage.removeItem(STORAGE_KEY);
  document.getElementById('resultBox').classList.remove('show');
});

// Run button
document.getElementById('btnRun').addEventListener('click', async () => {
  const raw = document.getElementById('codeInput').value;
  
  // Parse codes: trim whitespace, tabs, quotes, empty lines
  const codes = raw
    .split('\n')
    .map(l => l.replace(/[\t"'\s]/g, '').toUpperCase())
    .filter(l => l.length > 0);

  if (codes.length === 0) {
    alert('Vui lòng nhập ít nhất 1 mã RS!');
    return;
  }

  const btn = document.getElementById('btnRun');
  btn.disabled = true;
  btn.textContent = '⏳ Đang xử lý...';

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Inject script into page
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: autoTickCheckboxes,
    args: [codes]
  });

  btn.disabled = false;
  btn.innerHTML = '⚡ Chạy Auto Tick';

  if (!results || !results[0]) {
    alert('Không thể chạy trên trang này. Hãy đảm bảo đang mở đúng trang danh sách.');
    return;
  }

  const { ticked, skipped, missing } = results[0].result;

  // Show results
  document.getElementById('statTotal').textContent = codes.length;
  document.getElementById('statOk').textContent = ticked;
  document.getElementById('statSkip').textContent = skipped.length;
  document.getElementById('statMiss').textContent = missing.length;

  renderCodeList(
    document.getElementById('skippedList'),
    'Đã tick rồi (bỏ qua):',
    skipped
  );
  renderCodeList(
    document.getElementById('missingList'),
    'Không tìm thấy:',
    missing
  );

  document.getElementById('resultBox').classList.add('show');
});

function renderCodeList(container, label, codes) {
  container.innerHTML = '';

  if (codes.length === 0) {
    container.style.display = 'none';
    return;
  }

  const title = document.createElement('strong');
  title.textContent = `${label} `;
  container.appendChild(title);

  for (const code of codes) {
    const item = document.createElement('span');
    item.textContent = code;
    container.appendChild(item);
  }

  container.style.display = 'block';
}

// This function runs INSIDE the page context
function autoTickCheckboxes(codes) {
  let ticked = 0;
  const skipped = [];
  const missing = [];

  for (const code of codes) {
    // Find the link whose text matches the RS code
    // Links have href like #/return_to_supplier/RS1120012D
    const link = document.querySelector(`a[href="#/return_to_supplier/${code}"]`);

    if (!link) {
      missing.push(code);
      continue;
    }

    // Go up to the <tr> row
    const row = link.closest('tr');
    if (!row) {
      missing.push(code);
      continue;
    }

    // Find the toggle button in the last cell
    const toggleBtn = row.querySelector('.tgl-btn');
    
    if (!toggleBtn) {
      missing.push(code);
      continue;
    }

    // Check if already checked
    if (toggleBtn.classList.contains('checked')) {
      skipped.push(code);
      continue;
    }

    // Also try clicking the hidden checkbox
    const checkbox = row.querySelector('input[type="checkbox"]');

    // Click the toggle button
    toggleBtn.click();

    // Also trigger change on hidden input if present
    if (checkbox && !checkbox.checked) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }

    ticked++;
  }

  return { ticked, skipped, missing };
}

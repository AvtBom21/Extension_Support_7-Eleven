// Quy tắc ánh xạ khu vực (đã bổ sung đầy đủ)
const regionMapping = {
    // HCM regions
    'HCM_T5': 'T6',
    'HCM_T4': 'T6',
    'HCM_T6': 'T6',
    'HCM_T7': 'T7',
    'HCM_T8': 'T8',
    'HCM_T9': 'T9',
    'HCM_Draft': 'T9',

    // HN regions
    'HN_T5': 'T6',
    'HN_T6': 'T6',
    'HN_T7': 'T7',
    'HN_T8': 'T8',
    'HN_T9': 'T9',

    // BD regions
    'BD_T5': 'T6',
    'BD_T7': 'T7',

    // Other regions
    'LA': 'T7',
    'INTL': 'intel',

    // Direct mapping
    'T6': 'T6',
    'T7': 'T7',
    'T8': 'T8',
    'T9': 'T9'
};

// Lấy các phần tử
const upcInput = document.getElementById('upc');
const priceT6 = document.getElementById('priceT6');
const priceT7 = document.getElementById('priceT7');
const priceT8 = document.getElementById('priceT8');
const priceT9 = document.getElementById('priceT9');
const priceIntel = document.getElementById('priceIntel');
const calculateBtn = document.getElementById('calculateBtn');
const autoFillBtn = document.getElementById('autoFillBtn');
const resetBtn = document.getElementById('resetBtn');
const resultsDiv = document.getElementById('results');
const resultsList = document.getElementById('resultsList');
const statusDiv = document.getElementById('status');

// Load dữ liệu đã lưu
loadSavedData();

// Tự động lưu khi nhập liệu
[upcInput, priceT6, priceT7, priceT8, priceT9, priceIntel].forEach(input => {
    input.addEventListener('input', saveData);
});

// Tự động điền vào trang
autoFillBtn.addEventListener('click', async () => {
    const prices = {
        T6: priceT6.value,
        T7: priceT7.value,
        T8: priceT8.value,
        T9: priceT9.value,
        intel: priceIntel.value
    };

    const upcCode = upcInput.value.trim();

    // Kiểm tra có giá nào được nhập không
    const hasPrice = Object.values(prices).some(p => p && parseFloat(p) > 0);
    if (!hasPrice) {
        showStatus('Vui lòng nhập ít nhất một giá!', 'error');
        return;
    }

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: fillPrices,
            args: [prices, regionMapping, upcCode]
        });

        showStatus('✅ Đã điền giá thành công!', 'success');
        showToast('Đã điền giá vào trang!');
    } catch (error) {
        console.error('Error:', error);
        showStatus('❌ Lỗi: ' + error.message, 'error');
    }
});

// Hàm điền giá vào trang (chạy trong context của trang web)
function fillPrices(prices, regionMapping, upcFilter) {
    let filledCount = 0;
    let currentRegion = null;

    console.log('Bắt đầu điền giá...', prices);
    console.log('UPC filter:', upcFilter);

    // Tìm tất cả các hàng trong bảng
    const rows = document.querySelectorAll('#product-uom-mapping tbody tr');

    rows.forEach((row, index) => {
        // Kiểm tra xem có phải là header nhóm không
        if (row.classList.contains('table-group-header')) {
            const headerText = row.textContent.trim();
            console.log('Tìm thấy nhóm:', headerText);
            currentRegion = headerText;
            return;
        }

        // Nếu không có region hiện tại, bỏ qua
        if (!currentRegion) return;

        // Nếu có UPC filter, kiểm tra UPC trong row
        if (upcFilter) {
            const rowText = row.textContent;
            const upcMatch = rowText.match(/UPC:\s*(\d+)/);

            if (!upcMatch) {
                console.log('Không tìm thấy UPC trong row');
                return;
            }

            const rowUPC = upcMatch[1].trim();
            console.log('Row UPC:', rowUPC, 'Filter:', upcFilter);

            // Nếu UPC không khớp, bỏ qua row này
            if (rowUPC !== upcFilter) {
                console.log('UPC không khớp, bỏ qua row');
                return;
            }

            console.log('✓ UPC khớp!');
        }

        // Lấy giá từ mapping
        const baseRegion = regionMapping[currentRegion];
        if (!baseRegion) {
            console.log('Không tìm thấy mapping cho:', currentRegion);
            return;
        }

        const price = prices[baseRegion];
        if (!price || parseFloat(price) <= 0) {
            console.log('Không có giá cho:', baseRegion);
            return;
        }

        // Tìm input trong row này
        const inputs = row.querySelectorAll('input[type="text"]');

        inputs.forEach(input => {
            const dataSelector = input.getAttribute('data-selector');

            // Chỉ điền vào input có chứa "retail_selling_price_with_tax"
            if (dataSelector && dataSelector.includes('retail_selling_price_with_tax')) {
                console.log(`Điền giá ${price} vào ${currentRegion} (${baseRegion})`);

                input.value = price;

                // Trigger các sự kiện để website nhận biết thay đổi
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('blur', { bubbles: true }));

                // Thử trigger React events nếu website dùng React
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                ).set;
                nativeInputValueSetter.call(input, price);

                const ev = new Event('input', { bubbles: true });
                input.dispatchEvent(ev);

                filledCount++;
            }
        });
    });

    console.log(`Đã điền ${filledCount} ô giá`);

    // Hiển thị thông báo
    const notification = document.createElement('div');
    notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #4CAF50;
    color: white;
    padding: 16px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 99999;
    animation: slideIn 0.3s ease-out;
  `;

    if (filledCount === 0) {
        notification.style.background = '#ff9800';
        notification.textContent = upcFilter
            ? `⚠️ Không tìm thấy UPC: ${upcFilter}`
            : '⚠️ Không tìm thấy ô giá nào để điền';
    } else {
        notification.textContent = `✅ Đã điền ${filledCount} ô giá${upcFilter ? ' cho UPC: ' + upcFilter : ''}`;
    }

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Tính toán và hiển thị kết quả
calculateBtn.addEventListener('click', () => {
    const prices = {
        T6: priceT6.value,
        T7: priceT7.value,
        T8: priceT8.value,
        T9: priceT9.value,
        intel: priceIntel.value
    };

    const hasPrice = Object.values(prices).some(p => p && parseFloat(p) > 0);
    if (!hasPrice) {
        showToast('Vui lòng nhập ít nhất một giá!');
        return;
    }

    const results = {};
    Object.entries(regionMapping).forEach(([region, baseRegion]) => {
        const price = prices[baseRegion];
        if (price && parseFloat(price) > 0) {
            results[region] = {
                price: parseFloat(price),
                source: baseRegion
            };
        }
    });

    displayResults(results);
});

// Reset form
resetBtn.addEventListener('click', () => {
    upcInput.value = '';
    priceT6.value = '';
    priceT7.value = '';
    priceT8.value = '';
    priceT9.value = '';
    priceIntel.value = '';
    resultsDiv.classList.add('hidden');
    statusDiv.innerHTML = '';
    clearSavedData();
    showToast('Đã reset!');
});

// Hiển thị kết quả
function displayResults(results) {
    resultsList.innerHTML = '';

    Object.entries(results).forEach(([region, data]) => {
        const item = document.createElement('div');
        item.className = 'result-item';
        item.innerHTML = `
      <div>
        <div class="result-region">${region}</div>
        <div class="result-source">Từ giá ${data.source}</div>
      </div>
      <div style="text-align: right;">
        <div class="result-price">${formatPrice(data.price)}</div>
        <button class="copy-btn" data-price="${data.price}">📋 Copy</button>
      </div>
    `;
        resultsList.appendChild(item);
    });

    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const price = e.target.dataset.price;
            copyToClipboard(price);
            showToast('Đã copy giá!');
        });
    });

    resultsDiv.classList.remove('hidden');
}

function formatPrice(price) {
    return parseFloat(price).toLocaleString('vi-VN');
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(err => {
        console.error('Failed to copy:', err);
    });
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 2000);
}

function showStatus(message, type) {
    statusDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
    setTimeout(() => statusDiv.innerHTML = '', 5000);
}

function saveData() {
    const data = {
        upc: upcInput.value,
        T6: priceT6.value,
        T7: priceT7.value,
        T8: priceT8.value,
        T9: priceT9.value,
        intel: priceIntel.value
    };
    chrome.storage.local.set({ priceData: data });
}

function loadSavedData() {
    chrome.storage.local.get(['priceData'], (result) => {
        if (result.priceData) {
            const data = result.priceData;
            upcInput.value = data.upc || '';
            priceT6.value = data.T6 || '';
            priceT7.value = data.T7 || '';
            priceT8.value = data.T8 || '';
            priceT9.value = data.T9 || '';
            priceIntel.value = data.intel || '';
        }
    });
}

function clearSavedData() {
    chrome.storage.local.remove(['priceData']);
}
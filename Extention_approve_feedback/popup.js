// Hàm hiển thị thông báo
function showStatus(message, isSuccess) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = isSuccess ? 'success' : 'error';
  status.style.display = 'block';
  
  setTimeout(() => {
    status.style.display = 'none';
  }, 3000);
}

// Hàm tick tất cả checkbox
async function checkAllBoxes() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => {
        // Tìm tất cả checkbox trong scrollable
        const scrollable = document.querySelector('.scrollable');
        if (!scrollable) {
          return { success: false, message: 'Không tìm thấy phần scrollable' };
        }
        
        const checkboxes = scrollable.querySelectorAll('input[data-selector="input-check-approve-check"]');
        
        if (checkboxes.length === 0) {
          return { success: false, message: 'Không tìm thấy checkbox nào' };
        }
        
        let checked = 0;
        checkboxes.forEach(checkbox => {
          if (!checkbox.checked) {
            checkbox.click(); // Dùng click() để trigger events
            checked++;
          }
        });
        
        return { 
          success: true, 
          message: `Đã tick ${checked}/${checkboxes.length} checkbox`,
          total: checkboxes.length,
          checked: checked
        };
      }
    });
    
    const result = results[0].result;
    showStatus(result.message, result.success);
    
  } catch (error) {
    showStatus('Lỗi: ' + error.message, false);
  }
}

// Hàm bỏ tick tất cả checkbox
async function uncheckAllBoxes() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => {
        // Tìm tất cả checkbox trong scrollable
        const scrollable = document.querySelector('.scrollable');
        if (!scrollable) {
          return { success: false, message: 'Không tìm thấy phần scrollable' };
        }
        
        const checkboxes = scrollable.querySelectorAll('input[data-selector="input-check-approve-check"]');
        
        if (checkboxes.length === 0) {
          return { success: false, message: 'Không tìm thấy checkbox nào' };
        }
        
        let unchecked = 0;
        checkboxes.forEach(checkbox => {
          if (checkbox.checked) {
            checkbox.click(); // Dùng click() để trigger events
            unchecked++;
          }
        });
        
        return { 
          success: true, 
          message: `Đã bỏ tick ${unchecked}/${checkboxes.length} checkbox`,
          total: checkboxes.length,
          unchecked: unchecked
        };
      }
    });
    
    const result = results[0].result;
    showStatus(result.message, result.success);
    
  } catch (error) {
    showStatus('Lỗi: ' + error.message, false);
  }
}

// Gắn sự kiện cho các nút
document.getElementById('checkAll').addEventListener('click', checkAllBoxes);
document.getElementById('uncheckAll').addEventListener('click', uncheckAllBoxes);
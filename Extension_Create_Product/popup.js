'use strict';

const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwybCisNFLN4Tlps600mZr1dk-HONt9bOzt4R95jLIzu04xN0CcQQ0jYk_ts7_S8bdhTQ/exec';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const loadingBar     = document.getElementById('loadingBar');
const totalBadge     = document.getElementById('totalBadge');
const ddTrigger      = document.getElementById('ddTrigger');
const ddLabel        = document.getElementById('ddLabel');
const ddMenu         = document.getElementById('ddMenu');
const ddSearch       = document.getElementById('ddSearch');
const ddList         = document.getElementById('ddList');
const ddCount        = document.getElementById('ddCount');
const detailEl       = document.getElementById('detail');
const detailTabNav   = document.getElementById('detailTabNav');
const btnCopyJson    = document.getElementById('btnCopyJson');
const btnCopySummary = document.getElementById('btnCopySummary');
const sDot           = document.getElementById('sDot');
const sText          = document.getElementById('sText');

// ── State ─────────────────────────────────────────────────────────────────────
let allRows      = [];
let filteredRows = [];
let selectedRow  = null;
let isOpen       = false;
let detailTab    = 1;
let uomBarcodeOverrides = {}; // map of sub-key → new value for Tab 2 barcode fields
let productIdOverride  = null; // manual Product ID entry for Tab 1 (overrides spreadsheet value)

// ── Status helpers ────────────────────────────────────────────────────────────
function setStatus(msg, state = 'idle') {
  sText.textContent = msg;
  sDot.className = 'status-dot';
  if (state === 'busy') sDot.classList.add('busy');
  else if (state === 'ok') sDot.classList.add('ok');
  else if (state === 'err') sDot.classList.add('err');
}

function setLoading(on) {
  loadingBar.classList.toggle('active', on);
}

// ── Escape HTML ───────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Normalize for search ──────────────────────────────────────────────────────
function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// ── Linkify URLs in a field value ─────────────────────────────────────────────
function linkify(str) {
  return esc(str).replace(/(https?:\/\/[^\s;,<&]+)/g,
    url => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
}

// ── Get best display name for a row ──────────────────────────────────────────
function getDisplayName(row) {
  return row['PIC input Product Name\n(Dưới 40 kí tự)']
    || row['PIC input Product Name (Dưới 40 kí tự)']
    || row['PIC input Product Name']
    || row['Product Name']
    || '';
}

// ── Get PIC input product name ────────────────────────────────────────────────
function getPicName(row) {
  return row['PIC input Product Name\n(Dưới 40 kí tự)']
    || row['PIC input Product Name (Dưới 40 kí tự)']
    || row['PIC input Product Name']
    || '';
}

// ── Summary text ──────────────────────────────────────────────────────────────
function rowToSummary(row) {
  return [
    ['Product Name',           row['Product Name']],
    ['PIC input Product Name', getPicName(row)],
    ['New Product ID',         row['New Product ID']],
    ['Sub Category',           row['Sub Category']],
    ['Brand Name',             row['Brand Name']],
    ['Supplier Name HQ',       row['Supplier Name HQ']],
    ['Country of Origin',      row['Country of Origin']],
    ['Fulfillment Method',     row['Fulfillment Method']],
    ['Inventory Type',         row['Inventory Type']],
    ['Sorting Type',           row['Sorting Type']],
    ['Purchase Price (-VAT)',  row['Purchase Price (-VAT)']],
    ['Base - RSP',             row['Base - RSP']],
    ['MOQ',                    row['Minimum Order Quantity']],
    ['Max OQ',                 row['Maximum Order Quantity']],
    ['First Order Date',       row['First Order Date Estimated (yyyy-mm-dd)']],
    ['Shelf Life',             row['Shelf Life']],
    ['Logistics Group',        row['Logistics Group']],
    ['UOM Information',        row['UOM Information']],
    ['Image',                  row['Image']],
  ].map(([k, v]) => `${k}: ${v || ''}`).join('\n');
}

// ── Tab field mapping ─────────────────────────────────────────────────────────
// Tab 2, 3, 4 claim specific columns; everything else falls to Tab 1
const TAB2_FIELDS = new Set([
  'UOM Information',
]);
const TAB3_FIELDS = new Set([
  'Refill UOM', 'Store Order UOM', 'Lot Size',
  'Logistics Group', 'Core Item', 'Order-able', 'Return-able', 'Refill-able',
  'Supplier Name HQ', 'Fulfillment Method', 'Inventory Type', 'Sorting Type',
  'Original Purchase Price (-VAT)', 'Purchase Price (-VAT)',
  'First Order Date Estimated (yyyy-mm-dd)',
  'Minimum Order Quantity', 'Maximum Order Quantity',
]);
const TAB4_FIELDS = new Set([
  'Base - RSP', 'Uom 1 - RSP', 'Uom 2 - RSP', 'Uom 3 - RSP', 'Uom 4 - RSP',
]);
function getTabForKey(key) {
  if (TAB2_FIELDS.has(key)) return 2;
  if (TAB3_FIELDS.has(key)) return 3;
  if (TAB4_FIELDS.has(key)) return 4;
  return 1;
}

// ── Field transformation ──────────────────────────────────────────────────────
// Fields that contain "Miền Nam: X\nMiền Bắc: Y" or just one region (long text)
const REGION_FIELDS = new Set(['Logistics Group', 'CDC Shipping Limitation', 'Shipping Limitation']);

// Fields with "Miền Nam: Yes/No, Miền Bắc: Yes/No" inline comma-separated
const BOOL_REGION_FIELDS = new Set(['Core Item', 'Order-able', 'Return-able', 'Refill-able', 'Write-off-able', 'Price-Tag-Issue']);

// Fields that contain "KEY: VALUE\nKEY: VALUE" tier lists
const TIER_FIELDS   = new Set(['Base - RSP', 'Uom 1 - RSP', 'Uom 2 - RSP', 'Uom 3 - RSP', 'Uom 4 - RSP']);

// Fields containing "KEY: VALUE" structured text (UOM info already has sub-structure)
const KV_FIELDS     = new Set(['UOM Information']);

/**
 * Returns an array of { key, value, type } objects for display.
 * type: 'normal' | 'region' | 'tier' | 'kv'
 */
function expandField(key, rawVal) {
  const val = String(rawVal ?? '').trim();
  if (!val) return [];

  // ── Boolean region fields (Miền Nam: Yes/No, Miền Bắc: Yes/No) ──────────────
  if (BOOL_REGION_FIELDS.has(key)) {
    const results = [];
    // Match both comma-separated "Miền Nam: X, Miền Bắc: Y"
    // and newline-separated "Miền Nam: X\nMiền Bắc: Y"
    const rx = /Miền\s+(Nam|Bắc)\s*:\s*([^,\n]+)/gi;
    let m;
    while ((m = rx.exec(val)) !== null) {
      const region = m[1].trim();
      const bval   = m[2].trim();
      results.push({ key: `${key} · Miền ${region}`, value: bval, type: 'bool' });
    }
    // Fallback: plain value with no region prefix (e.g. just "Yes")
    if (!results.length) results.push({ key, value: val, type: 'normal' });
    return results;
  }

  // ── Logistics / region fields ─────────────────────────────────────────────
  if (REGION_FIELDS.has(key)) {
    const results = [];
    // Match "Miền Nam: ..." and "Miền Bắc: ..."
    const regionRx = /Miền\s+(Nam|Bắc)\s*:\s*([\s\S]*?)(?=Miền\s+(?:Nam|Bắc)\s*:|$)/gi;
    let m;
    while ((m = regionRx.exec(val)) !== null) {
      const region = m[1].trim();           // "Nam" or "Bắc"
      const group  = m[2].trim().replace(/,\s*$/, ''); // strip trailing comma (comma-separated data)
      if (group) results.push({ key: `${key} · Miền ${region}`, value: group, type: 'region' });
    }
    // Fallback: no "Miền X:" prefix found → show as-is
    if (!results.length) results.push({ key, value: val, type: 'normal' });
    return results;
  }

  // ── Price tier fields ─────────────────────────────────────────────────────
  if (TIER_FIELDS.has(key)) {
    const lines = val.split(/\n|;/).map(l => l.trim()).filter(Boolean);
    // Try to parse "LABEL: NUMBER" lines
    const parsed = lines.map(line => {
      const sep = line.indexOf(':');
      if (sep === -1) return null;
      const k2 = line.slice(0, sep).trim();
      const v2 = line.slice(sep + 1).trim();
      return k2 && v2 ? { key: `${key} · ${k2}`, value: v2, type: 'tier' } : null;
    }).filter(Boolean);

    if (parsed.length >= 2) return parsed;
    // Only one or no parseable line → show raw
    return [{ key, value: val, type: 'normal' }];
  }

  // ── Key-Value structured fields (UOM Information) ─────────────────────────
  if (KV_FIELDS.has(key)) {
    const lines = val.split(/\n/).map(l => l.trim()).filter(Boolean);
    const parsed = lines.map(line => {
      const sep = line.indexOf(':');
      if (sep === -1) return null;
      const k2 = line.slice(0, sep).trim();
      const v2 = line.slice(sep + 1).trim();
      return k2 && v2 ? { key: `${key} · ${k2}`, value: v2, type: 'kv' } : null;
    }).filter(Boolean);

    if (parsed.length >= 2) return parsed;
    return [{ key, value: val, type: 'normal' }];
  }

  return [{ key, value: val, type: 'normal' }];
}

// ── Render detail panel ───────────────────────────────────────────────────────
function renderDetail(row) {
  if (!row) {
    detailTabNav.classList.remove('visible');
    detailEl.innerHTML = `
      <div class="detail-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          <path d="M9 9h6M9 13h4"/>
        </svg>
        <p>Chọn một sản phẩm từ dropdown để xem chi tiết</p>
      </div>`;
    return;
  }

  // Group raw entries by tab number
  const tabEntries = { 1: [], 2: [], 3: [], 4: [] };
  for (const [k, v] of Object.entries(row)) {
    if (String(v ?? '').trim() === '') continue;
    tabEntries[getTabForKey(k)].push([k, v]);
  }

  // Update tab button states + counts
  detailTabNav.classList.add('visible');
  detailTabNav.querySelectorAll('.dtab').forEach(btn => {
    const t = +btn.dataset.tab;
    btn.classList.toggle('active', t === detailTab);
    const cnt = btn.querySelector('.dtab-cnt');
    const n = tabEntries[t].length;
    cnt.textContent = n || '';
    cnt.classList.toggle('has-data', n > 0);
  });

  // Render only the active tab's fields
  const activeEntries = tabEntries[detailTab];
  if (!activeEntries.length) {
    detailEl.innerHTML = '<div class="detail-empty"><p>Không có dữ liệu cho tab này.</p></div>';
    return;
  }

  const displayItems = activeEntries.flatMap(([k, v]) => expandField(k, v));

  // ── Tab 2: ensure all Barcode fields present (Base Barcode always; UOM n from data) ──
  if (detailTab === 2) {
    // Always ensure Base Barcode is present
    if (!displayItems.some(d => d.key === 'UOM Information · Base Barcode')) {
      const insertAt = displayItems.findIndex(d => d.key.startsWith('UOM Information · '));
      const bcItem = { key: 'UOM Information · Base Barcode', value: '', type: 'kv' };
      if (insertAt === -1) displayItems.unshift(bcItem);
      else displayItems.splice(insertAt + 1, 0, bcItem);
    }
  }

  // ── Tab 1: ensure editable Product ID field is always present at top ─────────
  if (detailTab === 1) {
    if (!displayItems.some(d => d.key === 'Product ID')) {
      displayItems.unshift({ key: 'Product ID', value: '', type: 'normal' });
    }
  }

  detailEl.innerHTML = displayItems.map(({ key, value, type }) => {
    const isSub = type !== 'normal';

    // Editable barcode inputs for Tab 2 — any field whose sub-key contains "Barcode"
    if (detailTab === 2 && key.startsWith('UOM Information · ')) {
      const subKey = key.slice('UOM Information · '.length);
      if (subKey.toLowerCase().includes('barcode')) {
        const curVal = subKey in uomBarcodeOverrides ? uomBarcodeOverrides[subKey] : value;
        const btnId  = 'btnSaveBarcode_' + subKey.replace(/\s+/g, '_');
        return `<div class="field" data-sub="1" data-type="kv">
          <div class="field-k">${esc(key)} <span class="editable-hint">✏</span></div>
          <div class="field-v" style="display:flex;gap:6px;align-items:center;padding-right:8px">
            <input class="barcode-edit bc-input" data-bckey="${esc(subKey)}" type="text" value="${esc(curVal)}" placeholder="Nhập barcode…" style="flex:1;min-width:0" />
            <button class="btn btn-save-bc" id="${btnId}" data-bckey="${esc(subKey)}" style="white-space:nowrap;padding:3px 8px;font-size:11px;flex-shrink:0">
              <svg viewBox="0 0 20 20" fill="currentColor" style="width:11px;height:11px;flex-shrink:0"><path d="M16.7 5.3a1 1 0 0 0-1.4 0L8 12.58 4.7 9.3a1 1 0 0 0-1.4 1.4l4 4a1 1 0 0 0 1.4 0l8-8a1 1 0 0 0 0-1.4z"/></svg> Lưu
            </button>
          </div>
        </div>`;
      }
    }

    // Editable Product ID input + Save button for Tab 1
    if (detailTab === 1 && key === 'Product ID') {
      const curVal = productIdOverride !== null ? productIdOverride : value;
      return `<div class="field">
        <div class="field-k">${esc(key)} <span class="editable-hint">✏</span></div>
        <div class="field-v" style="display:flex;gap:6px;align-items:center">
          <input class="barcode-edit" id="productIdInput" type="text" value="${esc(curVal)}" placeholder="Nhập Product ID mới…" style="flex:1;min-width:0" />
          <button id="btnSaveProductId" class="btn" style="white-space:nowrap;padding:3px 10px;font-size:11px;flex-shrink:0">
            <svg viewBox="0 0 20 20" fill="currentColor" style="width:11px;height:11px;vertical-align:middle;margin-right:3px"><path d="M16.7 5.3a1 1 0 0 0-1.4 0L8 12.58 4.7 9.3a1 1 0 0 0-1.4 1.4l4 4a1 1 0 0 0 1.4 0l8-8a1 1 0 0 0 0-1.4z"/></svg>
            Lưu
          </button>
        </div>
      </div>`;
    }

    const valHtml = type === 'bool'
      ? (() => {
          const v = value.trim().toLowerCase();
          const isYes = v === 'yes';
          const isNo  = v === 'no';
          return isYes ? `<span class="bool-pill bool-yes">Yes</span>`
               : isNo  ? `<span class="bool-pill bool-no">No</span>`
               : esc(value);
        })()
      : linkify(value);
    return `<div class="field"${isSub ? ` data-sub="1" data-type="${type}"` : ''}>
      <div class="field-k">${esc(key)}</div>
      <div class="field-v">${valHtml}</div>
    </div>`;
  }).join('');
}

// ── Capture manual barcode / product ID edits ────────────────────────────────
detailEl.addEventListener('input', e => {
  if (e.target.classList.contains('bc-input')) {
    const bcKey = e.target.dataset.bckey;
    if (bcKey) uomBarcodeOverrides[bcKey] = e.target.value;
  }
  if (e.target.id === 'productIdInput') {
    productIdOverride = e.target.value ?? null;
  }
});

// ── Save button delegation ────────────────────────────────────────────────────
detailEl.addEventListener('click', e => {
  if (e.target.closest('#btnSaveProductId')) saveProductIdToSheet();
  const bcBtn = e.target.closest('.btn-save-bc');
  if (bcBtn) saveOneBarcodeToSheet(bcBtn.dataset.bckey);
});

async function saveProductIdToSheet() {
  if (!selectedRow) { setStatus('Chưa chọn sản phẩm.', 'err'); return; }

  const newProductId = String(selectedRow['New Product ID'] || '').trim();
  if (!newProductId) { setStatus('Sản phẩm này không có New Product ID.', 'err'); return; }

  const productId = (productIdOverride ?? String(selectedRow['Product ID'] || '')).trim();
  if (!productId) { setStatus('Vui lòng nhập Product ID trước khi lưu.', 'err'); return; }

  const btn = document.getElementById('btnSaveProductId');
  setBtnSaving(btn, 'saving', 'Đang lưu…');
  setStatus('Đang lưu Product ID vào sheet…', 'busy');
  setLoading(true);

  try {
    const url1 = new URL(WEB_APP_URL);
    url1.searchParams.set('action', 'saveProductId');
    url1.searchParams.set('newProductId', newProductId);
    url1.searchParams.set('productId', productId);
    const res = await fetch(url1.toString());
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Unknown error');

    selectedRow['Product ID'] = productId;
    productIdOverride = null;
    setBtnSaving(btn, 'done', 'Đã lưu!');
    setStatus(`Đã lưu Product ID "${productId}" vào sheet.`, 'ok');

    // Force-refresh cache then restore current selection
    await reloadAndRestore();
  } catch (err) {
    setBtnSaving(btn, 'idle', 'Lưu');
    setStatus(`Lỗi lưu: ${err.message}`, 'err');
  } finally {
    setLoading(false);
  }
}

// ── Save a single barcode field to sheet ─────────────────────────────────────
async function saveOneBarcodeToSheet(bcKey) {
  if (!selectedRow || !bcKey) return;

  const newProductId = String(selectedRow['New Product ID'] || '').trim();
  if (!newProductId) { setStatus('Sản phẩm này không có New Product ID.', 'err'); return; }

  const newVal = bcKey in uomBarcodeOverrides ? uomBarcodeOverrides[bcKey] : null;
  if (newVal === null) { setStatus('Chưa thay đổi giá trị barcode.', 'err'); return; }

  // Reconstruct full UOM string — only replace this one key's line
  const rawUom = String(selectedRow['UOM Information'] || '');
  const updatedLines = rawUom.split('\n').map(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return line;
    if (line.slice(0, colonIdx).trim() === bcKey)
      return newVal.trim() ? bcKey + ': ' + newVal.trim() : line;
    return line;
  });
  const updatedUomInfo = updatedLines.join('\n');

  const btnId = 'btnSaveBarcode_' + bcKey.replace(/\s+/g, '_');
  const btn   = document.getElementById(btnId);
  setBtnSaving(btn, 'saving', 'Đang lưu…');
  setStatus('Đang lưu ' + bcKey + '…', 'busy');
  setLoading(true);

  try {
    const url = new URL(WEB_APP_URL);
    url.searchParams.set('action', 'updateUomInfo');
    url.searchParams.set('newProductId', newProductId);
    url.searchParams.set('uomInfo', updatedUomInfo);
    const res  = await fetch(url.toString());
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Unknown error');

    selectedRow['UOM Information'] = updatedUomInfo;
    delete uomBarcodeOverrides[bcKey];
    setBtnSaving(btn, 'done', 'Đã lưu!');
    setStatus('Đã lưu ' + bcKey + ' vào sheet.', 'ok');
    await reloadAndRestore();
  } catch (err) {
    setBtnSaving(btn, 'idle', 'Lưu');
    setStatus('Lỗi: ' + err.message, 'err');
  } finally {
    setLoading(false);
  }
}

// ── Detail tab switching ──────────────────────────────────────────────────────
detailTabNav.addEventListener('click', e => {
  const btn = e.target.closest('.dtab');
  if (!btn || !selectedRow) return;
  detailTab = +btn.dataset.tab;
  renderDetail(selectedRow);
});

// ── Render dropdown list ──────────────────────────────────────────────────────
function renderDropdownList(rows) {
  const doneCount = rows.filter(r => String(r['Product ID'] || '').trim()).length;
  ddCount.textContent = rows.length
    ? `${rows.length} kết quả` + (doneCount ? ` · ✓ ${doneCount}` : '')
    : '';

  if (!rows.length) {
    ddList.innerHTML = '<div class="dd-empty">Không tìm thấy sản phẩm.</div>';
    return;
  }

  ddList.innerHTML = rows.map((row, idx) => {
    const name   = esc(getDisplayName(row));
    const id     = esc(row['New Product ID'] || '');
    const brand  = esc(row['Brand Name'] || '');
    const cat    = esc(row['Sub Category'] || '');
    const pid    = String(row['Product ID'] || '').trim();
    const hasPid = !!pid;
    const parts  = [id, brand, cat].filter(Boolean);
    const meta   = parts.map((p, i) =>
      `<span>${p}</span>${i < parts.length - 1 ? '<span class="sep">·</span>' : ''}`
    ).join('');
    const pidBadge = hasPid
      ? `<span class="pid-badge" title="Product ID: ${esc(pid)}">✓ ${esc(pid)}</span>`
      : '';
    return `<div class="dd-item${hasPid ? ' dd-has-pid' : ''}" data-idx="${idx}">
      <div class="dd-item-name">${name}${pidBadge}</div>
      ${meta ? `<div class="dd-item-meta">${meta}</div>` : ''}
    </div>`;
  }).join('');

  ddList.querySelectorAll('.dd-item').forEach(el => {
    el.addEventListener('click', () => selectRow(filteredRows[+el.dataset.idx], el));
  });
}

// ── Select a product ──────────────────────────────────────────────────────────
function selectRow(row, itemEl, { preserveTab = false } = {}) {
  selectedRow = row;
  if (!preserveTab) {
    detailTab = 1; // reset to Tab 1 only on manual selection
    uomBarcodeOverrides = {};
    productIdOverride  = null;
  }
  ddList.querySelectorAll('.dd-item').forEach(x => x.classList.remove('dd-active'));
  itemEl?.classList.add('dd-active');

  const name = getDisplayName(row);
  ddLabel.textContent = name;
  ddLabel.classList.remove('ph');

  renderDetail(row);
  closeDropdown();
  setStatus(`Đã chọn: ${name}`, 'ok');
  enableFillButtons(true);
  if (!preserveTab) fillResult.classList.remove('visible');
  saveSelectedProduct(name);
  // Persist selected tab
  chrome.storage.local.set({ [CACHE_TAB]: detailTab });
}

// ── Filter dropdown ───────────────────────────────────────────────────────────
function filterDropdown(query) {
  filteredRows = query.trim()
    ? allRows.filter(row => {
        const q = norm(query);
        return norm(getDisplayName(row)).includes(q)
          || norm(row['New Product ID']).includes(q)
          || norm(row['Brand Name']).includes(q)
          || norm(row['Sub Category']).includes(q);
      })
    : allRows;

  renderDropdownList(filteredRows);

  // re-highlight selected if still visible
  if (selectedRow) {
    const i = filteredRows.indexOf(selectedRow);
    if (i >= 0) ddList.querySelectorAll('.dd-item')[i]?.classList.add('dd-active');
  }
}

// ── Open / close dropdown ─────────────────────────────────────────────────────
function openDropdown() {
  if (!allRows.length) return;
  isOpen = true;
  ddTrigger.classList.add('dd-open');
  ddMenu.classList.add('visible');
  ddSearch.value = '';
  filteredRows = allRows;
  renderDropdownList(filteredRows);
  if (selectedRow) {
    const i = filteredRows.indexOf(selectedRow);
    if (i >= 0) ddList.querySelectorAll('.dd-item')[i]?.classList.add('dd-active');
  }
  setTimeout(() => ddSearch.focus(), 40);
}

function closeDropdown() {
  isOpen = false;
  ddTrigger.classList.remove('dd-open');
  ddMenu.classList.remove('visible');
}

// ── Dropdown interaction ──────────────────────────────────────────────────────
ddTrigger.addEventListener('click', () => {
  if (ddTrigger.classList.contains('dd-disabled')) return;
  isOpen ? closeDropdown() : openDropdown();
});

ddSearch.addEventListener('input', () => filterDropdown(ddSearch.value));

document.addEventListener('mousedown', e => {
  if (isOpen && !document.getElementById('ddWrap').contains(e.target)) closeDropdown();
});

ddSearch.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeDropdown(); return; }
  const items = [...ddList.querySelectorAll('.dd-item')];
  let idx = items.findIndex(x => x.classList.contains('dd-active'));

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    idx = Math.min(idx + 1, items.length - 1);
    items.forEach(x => x.classList.remove('dd-active'));
    items[idx]?.classList.add('dd-active');
    items[idx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    idx = Math.max(idx - 1, 0);
    items.forEach(x => x.classList.remove('dd-active'));
    items[idx]?.classList.add('dd-active');
    items[idx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && idx >= 0) {
    items[idx].click();
  }
});

// ── Copy helpers ──────────────────────────────────────────────────────────────
async function flashSuccess(btn) {
  btn.classList.add('success');
  await new Promise(r => setTimeout(r, 1300));
  btn.classList.remove('success');
}

// Set a button into saving/done/idle state with spinner or checkmark
function setBtnSaving(btn, state, label) {
  if (!btn) return;
  btn.classList.remove('saving', 'success');
  if (state === 'saving') {
    btn.classList.add('saving');
    btn.innerHTML = `<svg class="spin" viewBox="0 0 20 20" fill="currentColor" style="width:11px;height:11px"><path d="M10 3a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5V3z"/></svg> ${label || 'Đang lưu…'}`;
  } else if (state === 'done') {
    btn.classList.add('success');
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" style="width:11px;height:11px"><path d="M16.7 5.3a1 1 0 0 0-1.4 0L8 12.58 4.7 9.3a1 1 0 0 0-1.4 1.4l4 4a1 1 0 0 0 1.4 0l8-8a1 1 0 0 0 0-1.4z"/></svg> ${label || 'Đã lưu!'}`;
    setTimeout(() => {
      btn.classList.remove('success');
      btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" style="width:11px;height:11px"><path d="M16.7 5.3a1 1 0 0 0-1.4 0L8 12.58 4.7 9.3a1 1 0 0 0-1.4 1.4l4 4a1 1 0 0 0 1.4 0l8-8a1 1 0 0 0 0-1.4z"/></svg> ${label || 'Lưu'}`;
    }, 2000);
  } else {
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" style="width:11px;height:11px"><path d="M16.7 5.3a1 1 0 0 0-1.4 0L8 12.58 4.7 9.3a1 1 0 0 0-1.4 1.4l4 4a1 1 0 0 0 1.4 0l8-8a1 1 0 0 0 0-1.4z"/></svg> ${label || 'Lưu'}`;
  }
}

btnCopyJson.addEventListener('click', async () => {
  if (!selectedRow) { setStatus('Chưa chọn sản phẩm.', 'err'); return; }
  await navigator.clipboard.writeText(JSON.stringify(selectedRow, null, 2));
  setStatus('Đã copy JSON.', 'ok');
  flashSuccess(btnCopyJson);
});

btnCopySummary.addEventListener('click', async () => {
  if (!selectedRow) { setStatus('Chưa chọn sản phẩm.', 'err'); return; }
  await navigator.clipboard.writeText(rowToSummary(selectedRow));
  setStatus('Đã copy summary.', 'ok');
  flashSuccess(btnCopySummary);
});

const btnFill1   = document.getElementById('btnFill1');
const btnFill2   = document.getElementById('btnFill2');
const btnFill3   = document.getElementById('btnFill3');
const btnFill4   = document.getElementById('btnFill4');
const fillResult = document.getElementById('fillResult');

// Enable fill buttons when a product is selected
function enableFillButtons(on) {
  [btnFill1, btnFill2, btnFill3, btnFill4].forEach(b => b.disabled = !on);
}

// Convert decimal limitation value to integer percentage string: "0.5" → "50", "30" → "30"
function toPercent(raw) {
  if (!raw && raw !== 0) return '';
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return '';
  // Values ≤ 1 are decimal fractions (0.5 = 50%), values > 1 are already percent
  return String(Math.round(n <= 1 ? n * 100 : n));
}

// Parse "24 MONTH" → shelf life items. Returns { items, isNA } so caller can skip limitations.
function parseShelfLife(raw) {
  if (!raw) return { items: [], isNA: false };
  const m = String(raw).trim().match(/^(\d+)\s*(\S+)/);
  if (!m) return { items: [], isNA: false };

  const num  = m[1];
  const uRaw = m[2].toUpperCase();

  // "0 HOUR", "0 N/A", any "0 NA*" or "N/A" unit → select NA, skip number + limitations
  const isNA = uRaw.startsWith('N') || (num === '0' && uRaw.startsWith('HOUR'));
  const unit = isNA          ? 'NA'
             : uRaw.startsWith('MONTH') ? 'Month'
             : uRaw.startsWith('DAY')   ? 'Day'
             : uRaw.startsWith('HOUR')  ? 'Hour'
             : 'NA';

  const items = [
    { label: 'Expiration Shelf Life unit',
      dsKey: 'input-select-expiration_shelf_life_unit', type: 'select-native', value: unit },
    // Only fill Total Shelf Life number when not NA
    ...(!isNA ? [{ label: 'Total Shelf Life',
      dsKey: 'input-text-input-number-total_shelf_life', type: 'input', value: num }] : []),
  ];

  return { items, isNA };
}

// ── Region value helpers ──────────────────────────────────────────────────────
// Reuse expandField() so that fill and display use IDENTICAL parsing logic.

/**
 * Extract the value for a given region from any row field.
 * fieldKey : exact column name (e.g. 'Logistics Group', 'Core Item')
 * rawVal   : the raw cell value from the spreadsheet
 * regionName: 'Nam' | 'Bắc'
 *
 * Returns the matched region value, or the full raw string if no region prefix.
 */
function extractFieldForRegion(fieldKey, rawVal, regionName) {
  if (!rawVal) return '';
  const items = expandField(fieldKey, rawVal);
  const normRegion = norm(regionName); // 'nam' or 'bac'
  // Look for an item whose key contains the region name
  const found = items.find(it => norm(it.key).includes(normRegion));
  if (!found) {
    // No region split in data (single-region product) → first/only value
    return items[0]?.value ?? String(rawVal).trim();
  }
  return found.value;
}

// Convenience wrappers used in buildPatternFields
function getRegionLogistics(rawVal, regionName) {
  return extractFieldForRegion('Logistics Group', rawVal, regionName);
}
function getRegionBool(fieldKey, rawVal, regionName) {
  return extractFieldForRegion(fieldKey, rawVal, regionName);
}

// Parse UOM Information key:value lines
function parseUomInfo(raw) {
  const out = {};
  if (!raw) return out;
  String(raw).split(/\n/).forEach(line => {
    const sep = line.indexOf(':');
    if (sep === -1) return;
    const k = line.slice(0, sep).trim();
    // For "Product Image: url1; url2" the value might have colons in URLs — join back
    const v = line.slice(sep + 1).trim();
    if (k && v) out[k] = v;
  });

  // Base Dimension: "120 x 10 x 2" → Height, Width, Length (in that field order on form)
  const dim = out['Base Dimension'] || '';
  const dimParts = dim.split(/\s*[xX×]\s*/).map(s => s.trim()).filter(Boolean);
  if (dimParts.length >= 3) {
    out._h = dimParts[0];  // Height
    out._w = dimParts[1];  // Width
    out._l = dimParts[2];  // Length
  }

  // BaseWeight: "80 g" → value="80", unit="g"
  // Unit is always a short word: g, kg, l, ml, pad
  const wt = (out['BaseWeight'] || '').trim();
  const wm = wt.match(/^([\d.]+)\s*([a-zA-Z]+)/);
  if (wm) {
    out._wtVal  = wm[1];             // "80"
    out._wtUnit = wm[2].toLowerCase(); // "g"
  }

  return out;
}

// Allow "0" and 0 — only exclude undefined/null/empty-string/empty-array
function hasValue(d) {
  if (d.type === 'pattern-tab-click') return true; // always include tab-switch steps
  if (d.type === 'retail-price-table') return typeof d.value === 'object' && d.value !== null && Object.keys(d.value).length > 0;
  if (d.value === undefined || d.value === null) return false;
  if (Array.isArray(d.value)) return d.value.length > 0;
  return String(d.value).trim() !== '';
}

// Build fill items using exact data-selector values from the form HTML
function prepareFillData(tabNum) {
  const row = selectedRow;
  if (!row) return [];

  if (tabNum === 1) {
    return [
      // data-selector="input-text-short_name"
      { label: 'Product Short Name VN',
        dsKey: 'input-text-short_name', type: 'input',
        value: getPicName(row) },

      // data-selector="input-text-detail_name"
      { label: 'Product Full Name VN',
        dsKey: 'input-text-detail_name', type: 'input',
        value: row['Product Name'] },

      // hidden checkbox: data-selector="input-check-promotion_only"
      { label: 'Promotion Only',
        dsKey: 'input-check-promotion_only', type: 'toggle',
        value: row['Promotion Only'] },

      // native select: data-selector="input-select-retail_business_type"
      { label: 'Retail Business Type',
        dsKey: 'input-select-retail_business_type', type: 'select-native',
        value: row['Retail Business Type'] },

      // React Select: data-selector="select-entity-dropdown-sub_category_name"
      { label: 'Product Sub-Category',
        dsKey: 'select-entity-dropdown-sub_category_name', type: 'react-select',
        value: row['Sub Category'] },

      // native select: data-selector="input-select-preservation_temperature"
      { label: 'Preservation Temperature',
        dsKey: 'input-select-preservation_temperature', type: 'select-native',
        value: row['Preservation temperature'] || row['Preservation Temperature'] },

      // radio group: data-selector="input-text-writeoffable"
      { label: 'Write-off-able',
        dsKey: 'input-text-writeoffable', type: 'radio-ds',
        value: row['Write-off-able'] },

      // radio group: data-selector="input-text-price_tag_issue_flag"
      { label: 'Price Tag Issue',
        dsKey: 'input-text-price_tag_issue_flag', type: 'radio-ds',
        value: row['Price-Tag-Issue'] },

      // data-selector="input-text-product_specification"
      { label: 'Product Specification',
        dsKey: 'input-text-product_specification', type: 'input',
        value: row['Product Specification'] },

      // React Select: data-selector="select-entity-dropdown-country_name"
      { label: 'Country of Origin',
        dsKey: 'select-entity-dropdown-country_name', type: 'react-select',
        value: row['Country of Origin'] },

      // radio group: data-selector="input-text-barcode_type"
      { label: 'Barcode Issuer',
        dsKey: 'input-text-barcode_type', type: 'radio-ds',
        value: row['Barcode Issuer'] },

      // React Select: data-selector="select-entity-dropdown-brand_name"
      { label: 'Brand Name',
        dsKey: 'select-entity-dropdown-brand_name', type: 'react-select',
        value: row['Brand Name'] },

      // data-selector="input-text-input-number-minimum_display_quantity"
      { label: 'Minimum Display Qty',
        dsKey: 'input-text-input-number-minimum_display_quantity', type: 'input',
        value: row['Minimum Display'] },

      // Shelf life: unit select + (conditionally) total number
      ...(() => {
        const { items, isNA } = parseShelfLife(row['Shelf Life']);
        const limitItems = isNA ? [] : [
          { label: 'Shipping Limitation',
            dsKey: 'input-text-input-number-shipping_limitation', type: 'input',
            value: toPercent(row['Shipping Limitation']) },
          { label: 'CDC Shipping Limitation',
            dsKey: 'input-text-input-number-cdc_shipping_limitation', type: 'input',
            value: toPercent(row['CDC Shipping Limitation']) },
          { label: 'Sale Limitation',
            dsKey: 'input-text-input-number-sales_limitation', type: 'input',
            value: toPercent(row['Sale Limitation']) },
        ];
        return [...items, ...limitItems];
      })(),

      // React Select: data-selector="select-entity-dropdown-input_vat_description"
      // Map short codes to full dropdown labels to avoid type-speed issues
      { label: 'VAT Input Code',
        dsKey: 'select-entity-dropdown-input_vat_description', type: 'react-select',
        value: (() => {
          const raw = String(row['Inbound VAT'] || '').trim();
          const map = {
            '8':            'HCM - VAT đầu vào nội địa SXKD – HHDV 8%',
            '10':           'VAT đầu vào nội địa SXKD – HHDV 10%',
            '5':            'VAT đầu vào nội địa SXKD – HHDV 5%',
            '0':            'VAT đầu vào nội địa SXKD– HHDV  0%',
            'tax-free':     'Không chịu thuế GTGT đầu vào',
            'direct-billing': 'Hóa đơn trực tiếp',
          };
          return map[raw.toLowerCase()] || map[raw] || raw;
        })() },

      // React Select: data-selector="select-entity-dropdown-output_vat_description"
      { label: 'VAT Output Code',
        dsKey: 'select-entity-dropdown-output_vat_description', type: 'react-select',
        value: row['VAT Output'] },

    ].filter(hasValue);
  }

  if (tabNum === 2) {
    const uom = parseUomInfo(row['UOM Information'] || '');
    return [
      // "Base UOM: Cái" → Base UOM Description VN (native <select>)
      // Options use Vietnamese names: Cái, Hộp, Gói, etc.
      { label: 'Base UOM Description VN',
        dsKey: 'input-select-product_uoms.0uom', type: 'select-native',
        value: uom['Base UOM'] },

      // "Base Barcode: 2850213280014" → UPC Base Unit (text input inside field wrapper)
      // Uses manually-entered override if set (barcode is sometimes system-generated)
      { label: 'UPC Base Unit',
        dsKey: 'field-UPC Base Unit', type: 'input-in-field',
        value: 'Base Barcode' in uomBarcodeOverrides ? uomBarcodeOverrides['Base Barcode'] : uom['Base Barcode'] },

      // "Base Dimension: 120 x 10 x 2" → Height / Width / Length (mm)
      { label: 'Height (mm)',
        dsKey: 'input-text-input-number-product_uoms.0height', type: 'input',
        value: uom._h },

      { label: 'Width (mm)',
        dsKey: 'input-text-input-number-product_uoms.0width', type: 'input',
        value: uom._w },

      { label: 'Length (mm)',
        dsKey: 'input-text-input-number-product_uoms.0length', type: 'input',
        value: uom._l },

      // "BaseWeight: 80 g" → Product Content number field (e.g. 80) + unit dropdown (e.g. g)
      { label: 'Product Content value',
        dsKey: 'input-text-input-number-product_uoms.0product_net_quantity_of_content', type: 'input',
        value: uom._wtVal },

      { label: 'Product Content unit',
        dsKey: 'input-select-product_uoms.0product_content_unit', type: 'select-native',
        value: uom._wtUnit },

    ].filter(hasValue);
  }

  if (tabNum === 3) {
    // ── Detect which regions this product covers ────────────────────────────
    // Strategy: read from the actual data fields (same logic that renders the
    // detail panel) instead of relying on the 'Zone' field, which may be empty
    // or use unexpected casing/values.
    //
    // We check REGION_FIELDS and BOOL_REGION_FIELDS: if expandField returns an
    // item whose key contains "Miền Nam" or "Miền Bắc", that region exists.
    // Fallback: if NO region prefix found in any field → treat as single-region
    // and use Zone to decide which one (defaulting to Nam if truly unknown).

    function detectRegions() {
      // Fields to probe (in priority order)
      const probeFields = [
        ['Logistics Group', row['Logistics Group']],
        ['Core Item',       row['Core Item']],
        ['Order-able',      row['Order-able']],
        ['Return-able',     row['Return-able']],
        ['Refill-able',     row['Refill-able']],
      ];

      let foundSouth = false;
      let foundNorth = false;
      let hasAnyRegionPrefix = false;

      for (const [key, rawVal] of probeFields) {
        if (!rawVal) continue;
        const items = expandField(key, rawVal);
        for (const it of items) {
          const k = norm(it.key);
          if (k.includes('nam'))  { foundSouth = true; hasAnyRegionPrefix = true; }
          if (k.includes('bac'))  { foundNorth = true; hasAnyRegionPrefix = true; }
        }
        if (foundSouth && foundNorth) break; // no need to check more
      }

      if (hasAnyRegionPrefix) {
        return { hasSouth: foundSouth, hasNorth: foundNorth };
      }

      // No region prefix in data → single-region product.
      // Use Zone field as tiebreaker; default to South if Zone is ambiguous.
      const zone = norm(String(row['Zone'] || ''));
      const isSouth = !zone.includes('north') && !zone.includes('bac');
      return { hasSouth: isSouth, hasNorth: !isSouth };
    }

    const { hasSouth, hasNorth } = detectRegions();
    const hasBoth = hasSouth && hasNorth;

    // Patterns to tick: Miền Nam first (per requirement), then Miền Bắc
    const patterns = [];
    if (hasSouth) patterns.push('Miền Nam');
    if (hasNorth) patterns.push('Miền Bắc');

    // Build the per-region supplier fields at a given pattern array index.
    // Uses expandField-based helpers so values EXACTLY match what's shown in popup display.
    function buildPatternFields(regionName, idx) {
      const logGroup   = getRegionLogistics(row['Logistics Group'], regionName);
      const coreItem   = getRegionBool('Core Item',    row['Core Item'],    regionName);
      const orderable  = getRegionBool('Order-able',   row['Order-able'],   regionName);
      const returnable = getRegionBool('Return-able',  row['Return-able'],  regionName);
      const refillable = getRegionBool('Refill-able',  row['Refill-able'],  regionName);
      const tag = `(Miền ${regionName})`;

      // NOTE: The form uses data-selector format "infos.{N}field" (no dot between index and field).
      // e.g. "select-entity-dropdown-pattern_mapping_infos.0logistics_name" (NOT .0.logistics_name)
      // Actual data-selector format (from live HTML):
      //   logistics:  pattern_mapping_infos.{N}logistics_name        (no dot after N)
      //   sub-fields: pattern_mapping_infos.{N}.supplier_mapping_info.0field (dot after N)
      return [
        { label: `Logistics Group ${tag}`,
          dsKey: `select-entity-dropdown-pattern_mapping_infos.${idx}logistics_name`, type: 'react-select',
          value: logGroup,
          // Form makes a backend API call after Logistics Group is selected to load
          // Core Item / Supplier / MOQ etc. — allow up to 6 s for that to complete.
          waitForDs: `input-text-pattern_mapping_infos.${idx}.supplier_mapping_info.0core_item`,
          waitAfterMs: 6000 },

        { label: `Core Item ${tag}`,
          dsKey: `input-text-pattern_mapping_infos.${idx}.supplier_mapping_info.0core_item`, type: 'radio-ds',
          value: coreItem },

        { label: `Order-able ${tag}`,
          dsKey: `input-text-pattern_mapping_infos.${idx}.supplier_mapping_info.0store_orderable`, type: 'radio-ds',
          value: orderable },

        { label: `Return-able ${tag}`,
          dsKey: `input-text-pattern_mapping_infos.${idx}.supplier_mapping_info.0returnable`, type: 'radio-ds',
          value: returnable },

        { label: `Refill-able ${tag}`,
          dsKey: `input-text-pattern_mapping_infos.${idx}.supplier_mapping_info.0refillable`, type: 'radio-ds',
          value: refillable },

        { label: `Supplier ${tag}`,
          dsKey: `select-entity-dropdown-pattern_mapping_infos.${idx}.supplier_mapping_info.0supplier_name`,
          type: 'react-select', value: row['Supplier Name HQ'] },

        { label: `Fulfillment Method ${tag}`,
          dsKey: `input-text-pattern_mapping_infos.${idx}.supplier_mapping_info.0fulfillment_method`,
          type: 'radio-ds', value: row['Fulfillment Method'] },

        { label: `Inventory Type ${tag}`,
          dsKey: `input-text-pattern_mapping_infos.${idx}.supplier_mapping_info.0inventory_type`,
          type: 'radio-ds', value: row['Inventory Type'] },

        { label: `Sorting Type ${tag}`,
          dsKey: `input-text-pattern_mapping_infos.${idx}.supplier_mapping_info.0sorting_type`,
          type: 'radio-ds', value: row['Sorting Type'] },

        { label: `Original Purchase Price (-VAT) ${tag}`,
          dsKey: `input-text-input-number-pattern_mapping_infos.${idx}.supplier_mapping_info.0original_purchase_price_without_tax`,
          type: 'input', value: row['Original Purchase Price (-VAT)'] || row['Purchase Price (-VAT)'] },

        { label: `Purchase Price (-VAT) ${tag}`,
          dsKey: `input-text-input-number-pattern_mapping_infos.${idx}.supplier_mapping_info.0purchase_price_without_tax`,
          type: 'input', value: row['Purchase Price (-VAT)'] },

        { label: `First Order Date ${tag}`,
          dsKey: `focus-target-pattern_mapping_infos.${idx}.supplier_mapping_info.0first_order_date`,
          type: 'date-id', value: row['First Order Date Estimated (yyyy-mm-dd)'] },

        { label: `MOQ ${tag}`,
          dsKey: `input-text-input-number-pattern_mapping_infos.${idx}.supplier_mapping_info.0minimum_order_quantity`,
          type: 'input', value: row['Minimum Order Quantity'] },

        { label: `Max OQ ${tag}`,
          dsKey: `input-text-input-number-pattern_mapping_infos.${idx}.supplier_mapping_info.0maximum_order_quantity`,
          type: 'input', value: row['Maximum Order Quantity'] },
      ].filter(hasValue);
    }

    // ── Assemble the full fill list ──────────────────────────────────────────
    const items = [
      { label: 'Refill UOM',
        dsKey: 'select-entity-dropdown-refill_uom_name_vn', type: 'react-select',
        value: row['Refill UOM'] },

      { label: 'Store Order UOM',
        dsKey: 'select-entity-dropdown-store_uom_name_vn', type: 'react-select',
        value: row['Store Order UOM'] },

      { label: 'Lot Size',
        dsKey: 'input-text-input-number-lot_size', type: 'input',
        value: row['Lot Size'] },

      // Tick all applicable pattern checkboxes (Miền Nam first).
      // type:'pattern-multi' accepts an array of values and ticks each checkbox.
      { label: 'Select Pattern',
        dsKey: 'select-checkbox-dropdown-select-pattern', type: 'pattern-multi',
        value: patterns,
        waitForDs: 'select-entity-dropdown-pattern_mapping_infos.0logistics_name',
        waitAfterMs: 2000 },
    ];

    // ── Miền Nam fields (always index 0 — selected first) ───────────────────
    // Note: waitForDs on Select Pattern already ensures Miền Nam tab is active
    // (it polls until 0.logistics_name becomes VISIBLE), so no extra confirm step needed.
    if (hasSouth) {
      items.push(...buildPatternFields('Nam', 0));
    }

    // ── If both regions: click the Miền Bắc tab, then fill its fields ───────
    if (hasBoth) {
      items.push({
        label:      'Switch to Pattern: Miền Bắc tab',
        type:       'pattern-tab-click',
        value:      'Miền Bắc',
        dsKey:      'pattern-tab-mien-bac',
        // Wait for the Miền Bắc logistics group selector to become VISIBLE (tab must be active)
        waitForDs:  'select-entity-dropdown-pattern_mapping_infos.1logistics_name',
        waitAfterMs: 5000,
      });
      items.push(...buildPatternFields('Bắc', 1));
    } else if (hasNorth && !hasSouth) {
      // Only north region → fills as index 0
      items.push(...buildPatternFields('Bắc', 0));
    }

    return items.filter(hasValue);
  }

  if (tabNum === 4) {
    // Spreadsheet stores prices in structured columns like 'Base - RSP' with value:
    //   "HCM_T5: 98000\nHCM_T6: 98000\n..."
    // expandField() parses this into { key: 'Base - RSP · HCM_T5', value: '98000', type: 'tier' }
    // UPC order on the form matches column order: Base → Uom 1 → Uom 2 → ...
    const uomPriceCols = ['Base - RSP', 'Uom 1 - RSP', 'Uom 2 - RSP', 'Uom 3 - RSP', 'Uom 4 - RSP'];
    const tiers = {};

    uomPriceCols.forEach((colName, upcIdx) => {
      const rawVal = row[colName];
      if (!rawVal) return;
      const items = expandField(colName, rawVal);
      for (const it of items) {
        if (it.type !== 'tier') continue;
        // key = "Base - RSP · HCM_T5"  →  tierName = "HCM_T5"
        const sep = it.key.indexOf(' \u00b7 ');
        const tierName = sep !== -1 ? it.key.slice(sep + 3).trim() : null;
        if (!tierName) continue;
        const price = String(it.value).replace(/,/g, '').trim();
        if (!price) continue;
        if (!tiers[tierName]) tiers[tierName] = [];
        tiers[tierName][upcIdx] = price;
      }
    });

    if (!Object.keys(tiers).length) return [];

    return [{
      label: 'Retail Prices (all tiers)',
      type:  'retail-price-table',
      dsKey: 'datatable-product-uom-mapping',
      value: tiers,  // { 'HCM_T5': ['98000', uom1Price], 'INTL': ['95000'], ... }
    }];
  }

  return [];
}

// Injected into target page — uses data-selector attributes for precise targeting
// IMPORTANT: this function must be completely self-contained (no outer-scope references)
// because Chrome scripting.executeScript serialises it and runs it in the page context.
async function __injectedFill(fillItems) {
  // ─────────────────────────────────────────────────────────────────────────────
  // NOTE: This entire function runs INSIDE the target page via scripting.executeScript.
  // It must be completely self-contained — no references to outer popup scope.
  // ─────────────────────────────────────────────────────────────────────────────

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Grab OS focus so click/keyboard events register correctly
  window.focus();
  await sleep(80);

  /* ── Set value on a React-controlled input or select ──────────────────────── */
  // React overrides the native setter; we must call it via the prototype descriptor
  // then fire both 'input' and 'change' so React's synthetic event system picks it up.
  function setNativeValue(el, value) {
    const proto  = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ── Find element by data-selector ───────────────────────────────────────── */
  function findByDs(key) {
    // CSS.escape handles dots / brackets in the key (e.g. "product_uoms.0uom")
    return document.querySelector(`[data-selector="${CSS.escape(key)}"]`)
        || document.querySelector(`[data-selector="${key}"]`);
  }

  /* ── Normalise text for fuzzy comparison ─────────────────────────────────── */
  // Strips Vietnamese diacritics, lowercases, collapses whitespace.
  function norm(s) {
    return String(s ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /* ── Strip surrounding JSON-style quotes from option values ──────────────── */
  // This form encodes <option value='"EA"'> — the actual value attr is "EA" (with quotes).
  // React Select options in this format need the outer quotes stripped before comparison.
  function unquote(s) {
    const t = String(s ?? '').trim();
    return (t.startsWith('"') && t.endsWith('"') && t.length > 1) ? t.slice(1, -1) : t;
  }

  /* ── Fire the full mouse-event chain required by React dropdowns ─────────── */
  // A bare click() skips the mousedown handler that React uses to commit an option.
  async function clickOption(el) {
    el.scrollIntoView({ block: 'nearest' });
    const a = { bubbles: true, cancelable: true };
    el.dispatchEvent(new PointerEvent('pointerover',  a));
    el.dispatchEvent(new MouseEvent ('mouseover',     a));
    el.dispatchEvent(new PointerEvent('pointerenter', a));
    el.dispatchEvent(new MouseEvent ('mouseenter',    a));
    el.dispatchEvent(new PointerEvent('pointerdown',  a));
    el.dispatchEvent(new MouseEvent ('mousedown',     a));
    el.dispatchEvent(new PointerEvent('pointerup',    a));
    el.dispatchEvent(new MouseEvent ('mouseup',       a));
    el.dispatchEvent(new MouseEvent ('click',         a));

    // ── Wait until the option menu is GONE from the DOM / hidden ─────────────
    const maxWait = 3000;
    const start   = Date.now();
    while (Date.now() - start < maxWait) {
      await sleep(10);
      const anyVisible = [
        ...document.querySelectorAll('[class*="-option"], [class*="__option"], [role="option"]'),
      ].some(o => o.offsetParent !== null);
      if (!anyVisible) break;
    }

    // ── Commit the selection so it survives a tab-switch ─────────────────────
    // The search input still has focus after the list closes. If the page loses
    // OS focus (tab-switch, popup reopens) BEFORE we blur, the component's onBlur
    // handler can treat the state as "aborted" and revert the value.
    // Firing Tab then blur hand-off focus cleanly and triggers the form's
    // onCommit / onChange path inside React.
    const focused = document.activeElement;
    if (focused && focused.tagName === 'INPUT') {
      focused.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab', keyCode: 9 }));
      focused.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, cancelable: true, key: 'Tab', keyCode: 9 }));
      focused.blur();
    }
  }

  /* ── Simulate real character-by-character typing ─────────────────────────── */
  // setNativeValue for the whole string at once does NOT trigger the dropdown's
  // internal filter — only individual key events do.
  async function typeIntoInput(input, text) {
    input.focus();
    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    // Select-all then clear
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', ctrlKey: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, key: 'a', ctrlKey: true }));
    setNativeValue(input, '');

    let built = '';
    for (const ch of text) {
      built += ch;
      input.dispatchEvent(new KeyboardEvent('keydown',  { bubbles: true, key: ch }));
      input.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: ch }));
      // Incrementally update the real value so every onChange sees the growing string
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
      if (setter) setter.call(input, built); else input.value = built;
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
      await sleep(5); // 5ms per char — triggers debounced filter
    }
    // One final input event to prod any debounced listeners
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ── Fill a react-select / custom entity dropdown ────────────────────────── */
  // Fully polling-based — no fixed waits except tiny yields.
  // Each step waits for real DOM conditions before proceeding.
  async function fillReactSelect(dsKey, rawValue) {
    const target = findByDs(dsKey);
    if (!target) return false;
    rawValue = String(rawValue).trim();
    const normVal = norm(rawValue);

    // Helper: collect visible option elements
    function getVisibleOpts() {
      return [
        ...document.querySelectorAll('[class*="-option"]'),
        ...document.querySelectorAll('[class*="__option"]'),
        ...document.querySelectorAll('[id*="-option-"]'),
        ...document.querySelectorAll('[role="option"]'),
        ...document.querySelectorAll('li[class*="option"], li[class*="item"]'),
      ].filter((el, idx, arr) =>
        arr.indexOf(el) === idx
        && el.offsetParent !== null
        && !norm(el.className).includes('no-option')
        && !norm(el.className).includes('no-result')
        && !norm(el.className).includes('placeholder')
      );
    }

    // Helper: read what the control currently displays as its selected value
    function getControlValue(t) {
      const ctrl = t.querySelector('[class*="-singleValue"], [class*="__single-value"], [class*="SingleValue"]')
                || t.querySelector('[class*="-value-container"] [class*="value"]')
                || t.querySelector('[class*="selector-selection-item"]');
      return norm(ctrl ? ctrl.textContent : '');
    }

    // ── 0. Poll until all option lists are gone (prev dropdown fully closed) ──
    {
      const prev = document.activeElement;
      if (prev && prev !== document.body) {
        prev.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape', keyCode: 27 }));
        prev.blur();
      }
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      for (let w = 0; w < 30; w++) {
        if (!getVisibleOpts().length) break;
        await sleep(10);
      }
    }

    // ── 1. Click trigger to open the menu ─────────────────────────────────────
    const trigger =
      target.querySelector('[class*="-control"], [class*="__control"], [class*="Select-control"]') ||
      target.querySelector('[class*="selector"], [class*="selection"], [class*="trigger"]') ||
      target;
    trigger.click();

    // ── 2. Find search input SCOPED to THIS dropdown's container ─────────────
    // NEVER use document.activeElement — it can point to the previous dropdown's
    // input that's still in DOM (e.g. Refill UOM's input while we're filling
    // Store Order UOM), causing us to type into the wrong field entirely.
    // We scope the lookup strictly to target's own subtree and wait for the
    // menu to be OPEN (getVisibleOpts > 0) before accepting the input.
    let searchInput = null;
    for (let i = 0; i < 40; i++) {
      // Wait for THIS dropdown's menu to open first
      const opts = getVisibleOpts();
      if (opts.length > 0) {
        // Now find input strictly inside target's own container
        const scopeEl = target.closest('[class*="-container"], [class*="__container"]') || target;
        const inp = scopeEl.querySelector('input[type="text"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type])');
        if (inp) { searchInput = inp; break; }
      }
      await sleep(30);
    }
    if (!searchInput) {
      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      return false;
    }

    // ── 3. Focus the input (menu already open from step 2 poll) ──────────────
    searchInput.focus();
    searchInput.click();

    // ── 4. Type the search value ──────────────────────────────────────────────
    await typeIntoInput(searchInput, rawValue);

    // ── 5. Poll until options matching our search term appear ─────────────────
    // This is the key guard: only proceed when the dropdown has FILTERED to our value.
    // Handles slow server-side search (entity dropdowns that fetch from API).
    let matchedOpts = null;
    for (let w = 0; w < 60; w++) {  // up to ~3 s for slow API lookups
      const all = getVisibleOpts();
      const matched = all.filter(o => norm(o.textContent).includes(normVal));
      if (matched.length > 0) { matchedOpts = matched; break; }
      // If a loading spinner is visible, keep waiting
      await sleep(30);
    }

    // ── 6. Click best match ───────────────────────────────────────────────────
    let clicked = false;
    if (matchedOpts && matchedOpts.length > 0) {
      const pick =
        matchedOpts.find(o => norm(o.textContent) === normVal)    ||
        matchedOpts.find(o => norm(o.textContent).startsWith(normVal)) ||
        matchedOpts[0];
      if (pick) {
        await clickOption(pick);
        clicked = true;
        // clickOption polled menu-gone + fired Tab/blur — value is committed
      }
    }

    // ── 8. Close on failure ───────────────────────────────────────────────────
    if (!clicked) {
      try {
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape', keyCode: 27 }));
        searchInput.blur();
        await sleep(10);
      } catch (_) {}
    }

    return clicked;
  }

  /* ── MAIN FILL LOOP ──────────────────────────────────────────────────────── */
  const filled = [];
  const failed = [];

  for (const item of fillItems) {
    const { label, dsKey, type } = item;
    // pattern-multi passes an array; retail-price-table passes an object; others use a trimmed string
    const value = (type === 'pattern-multi' && Array.isArray(item.value))
      ? item.value
      : (type === 'retail-price-table')
      ? item.value
      : String(item.value ?? '').trim();
    let ok = false;

    try {

      /* ── Plain text / number input ─────────────────────────────────────── */
      if (type === 'input') {
        let el = findByDs(dsKey);
        // dsKey may point to a wrapper div — find the actual input inside it
        if (el && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
          el = el.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea') || el;
        }
        if (el) {
          el.focus();
          el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
          setNativeValue(el, String(value));
          el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
          el.blur();
          ok = true;
        }

      /* ── Input inside a field wrapper identified by data-selector ──────── */
      // e.g. type:'input-in-field', dsKey:'field-UPC Base Unit'
      // Looks for [data-selector="field-UPC Base Unit"] then finds the <input> inside.
      // Falls back to partial label-text matching (handles "2.3.1 - UPC Base Unit" labels).
      } else if (type === 'input-in-field') {
        let el = null;
        // Try direct data-selector first
        const wrapper = findByDs(dsKey);
        if (wrapper) el = wrapper.querySelector('input:not([type="hidden"]), textarea');
        // Fallback: partial match on data-selector string
        if (!el) {
          const fieldName = norm(dsKey.replace(/^field-/, ''));
          const allWrappers = [...document.querySelectorAll('[data-selector^="field-"]')];
          const matched = allWrappers.find(w =>
            norm(w.getAttribute('data-selector') || '').includes(fieldName)
          );
          if (matched) el = matched.querySelector('input:not([type="hidden"]), textarea');
        }
        // Last fallback: search label text (handles "2.3.1 - UPC Base Unit" prefixes)
        if (!el) {
          const fieldName = norm(dsKey.replace(/^field-/, ''));
          const allLabels = [...document.querySelectorAll('label')];
          const lbl = allLabels.find(l => norm(l.textContent).includes(fieldName));
          const fieldEl = lbl?.closest('.form-group, [class*="field"], [class*="row"]');
          el = fieldEl?.querySelector('input:not([type="hidden"]), textarea');
        }
        if (el) {
          el.focus();
          setNativeValue(el, String(value));
          el.blur();
          ok = true;
        }

      /* ── Native <select> ───────────────────────────────────────────────── */
      // IMPORTANT: This form encodes option values as JSON-quoted strings like "EA".
      // We strip outer quotes before comparing so "EA" matches the data value EA.
      } else if (type === 'select-native') {
        let el = findByDs(dsKey);
        // The data-selector may point to a wrapper div — dig inside for the actual <select>
        if (el && el.tagName !== 'SELECT') {
          el = el.querySelector('select') || el;
        }
        if (el && el.tagName === 'SELECT') {
          const normVal = norm(value);
          const opt =
            // Match unquoted value attr (handles '"EA"' → 'EA')
            [...el.options].find(o => norm(unquote(o.value)) === normVal) ||
            // Match display text (exact, then starts-with, then contains)
            [...el.options].find(o => norm(o.text) === normVal) ||
            [...el.options].find(o => norm(o.text).startsWith(normVal)) ||
            [...el.options].find(o => norm(o.text).includes(normVal));
          if (opt) {
            setNativeValue(el, opt.value);
            ok = true;
          }
        }

      /* ── React-select / entity dropdown ────────────────────────────────── */
      } else if (type === 'react-select') {
        ok = await fillReactSelect(dsKey, String(value));

      /* ── Radio group ────────────────────────────────────────────────────── */
      // Handles three structures:
      //   A) <input type="radio" value="Yes"> directly inside the group
      //   B) <label>Yes<input type="radio"></label>  — match by label text
      //   C) Custom React radio: <span/div with data-value or text>
      } else if (type === 'radio-ds') {
        const group = findByDs(dsKey);
        if (group) {
          const normVal = norm(value);
          let found = null;

          // A) native radio by value attr
          found = [...group.querySelectorAll('input[type="radio"]')]
            .find(r => norm(r.value) === normVal || norm(r.value).startsWith(normVal));

          // B) label text match → click its radio input (handles "Yes" / "No" labels)
          if (!found) {
            const lbl = [...group.querySelectorAll('label')].find(l => {
              const t = norm(l.textContent);
              return t === normVal || t.includes(normVal);
            });
            if (lbl) {
              found = lbl.querySelector('input[type="radio"]')
                   || (lbl.htmlFor && document.getElementById(lbl.htmlFor))
                   || lbl; // click the label itself if no input
            }
          }

          // C) custom element with data-value or textContent
          if (!found) {
            found = [
              ...group.querySelectorAll('[role="radio"], [class*="radio"], button, span, div'),
            ].find(r => {
              const t = norm(r.getAttribute('data-value') || r.textContent);
              return t === normVal || t.startsWith(normVal);
            });
          }

          if (found) { found.click(); ok = true; }
        }

      /* ── Toggle / checkbox (Promotion Only etc.) ────────────────────────── */
      } else if (type === 'toggle') {
        const el = findByDs(dsKey);
        if (el) {
          const cb = el.querySelector('input[type="checkbox"]') || el;
          const shouldCheck = /^(yes|true|1)$/i.test(String(value).trim());
          const isChecked   = cb.checked || cb.getAttribute('aria-checked') === 'true';
          if (shouldCheck !== isChecked) cb.click();
          ok = true;
        }

      /* ── Custom pattern checkbox-dropdown (single value) ──────────────── */
      // Opens the dropdown, then clicks the matching checkbox item.
      } else if (type === 'pattern') {
        const container = findByDs(dsKey);
        if (container) {
          container.click();
          await sleep(100);
          const normVal = norm(value);
          const opts = [
            ...document.querySelectorAll('[role="option"]'),
            ...document.querySelectorAll('[class*="option"]:not([class*="no-option"])'),
            ...document.querySelectorAll('li'),
            ...document.querySelectorAll('label'),
          ].filter(el => el.offsetParent !== null);
          const opt = opts.find(o => {
            const t = norm(o.textContent);
            return t === normVal || t.includes(normVal);
          });
          if (opt) {
            await clickOption(opt);
            ok = true;
          } else {
            container.click(); // close without selecting
            await sleep(30);
          }
        }

      /* ── Multi-select pattern checkbox-dropdown ────────────────────────── */
      // Ticks each checkbox in order (Miền Nam first, then Miền Bắc if both).
      // Key rules:
      //   • Scope option search to the VISIBLE popup menu (not whole page)
      //   • Use raw checkbox.click() — NOT clickOption() (which waits for menu to close)
      //   • Verify dropdown is still open before each tick; reopen if it closed
      //   • Close by clicking outside after all ticks done
      } else if (type === 'pattern-multi') {
        // Try multiple selector strategies — the exact data-selector name varies
        const container =
          findByDs(dsKey) ||
          document.querySelector('[data-selector*="select-pattern"]') ||
          document.querySelector('[data-selector*="checkbox-dropdown"]') ||
          (() => {
            // Last resort: find a trigger near a label whose text contains "pattern"
            const labels = [...document.querySelectorAll('label, span, div')];
            const lbl = labels.find(l => norm(l.textContent) === 'select pattern' || norm(l.textContent).includes('select pattern'));
            return lbl?.closest('[data-selector]') || lbl?.parentElement?.querySelector('[data-selector]') || null;
          })();
        if (container) {
          const vals = Array.isArray(value) ? value : [value];

          // ── Helper: find the visible popup/menu element ─────────────────────
          function findPopupMenu() {
            // Primary: this form uses <div role="list" class="dropdown"> (no "hidden" class when open)
            const roleList = container.querySelector('[role="list"]:not(.hidden)')
                          || container.parentElement?.querySelector('[role="list"]:not(.hidden)');
            if (roleList) return roleList;

            // Secondary: div.dropdown without hidden class
            const ddDiv = container.querySelector('div.dropdown:not(.hidden):not(.dropdown-trigger):not(.dropdown-icon)')
                       || container.parentElement?.querySelector('div.dropdown:not(.hidden):not(.dropdown-trigger):not(.dropdown-icon)');
            if (ddDiv && ddDiv.offsetParent !== null) return ddDiv;

            // Fallback: common popup selectors scoped to or near the container
            const popupSelectors = [
              '[class*="dropdown-menu"]',
              '[class*="dropdownMenu"]',
              '[class*="popup"]',
              '[class*="listbox"]',
              '[role="listbox"]',
              '[role="menu"]',
            ];
            for (const sel of popupSelectors) {
              const el = container.querySelector(sel) ||
                         container.parentElement?.querySelector(sel) ||
                         container.closest('[class*="wrap"], [class*="select"]')?.querySelector(sel);
              if (el && el.offsetParent !== null) return el;
            }
            // Last resort: any visible list with ≥1 item
            for (const sel of ['ul', 'div[class*="list"]']) {
              const lists = document.querySelectorAll(sel);
              for (const list of lists) {
                if (list.offsetParent === null) continue;
                if (list.querySelectorAll('li, label, [role="option"]').length > 0) return list;
              }
            }
            return null;
          }

          // ── Helper: open dropdown and wait for popup to appear ──────────────
          async function openDropdown() {
            // Click the trigger button, not the outer container div
            const triggerBtn = container.querySelector('button.dropdown-trigger')
                            || container.querySelector('button')
                            || container;
            triggerBtn.click();
            for (let w = 0; w < 20; w++) {
              await sleep(80);
              const menu = findPopupMenu();
              if (menu) return menu;
            }
            return null;
          }

          // ── Helper: find a checkbox option by text inside a menu ────────────
          function findCheckboxOpt(menu, normText) {
            const items = [
              ...menu.querySelectorAll('li'),
              ...menu.querySelectorAll('label'),
              ...menu.querySelectorAll('[role="option"]'),
              ...menu.querySelectorAll('[class*="item"]'),
              ...menu.querySelectorAll('[class*="option"]'),
            ].filter(el => el.offsetParent !== null);

            return items.find(el => {
              const t = norm(el.textContent);
              return t === normText || t.includes(normText);
            }) || null;
          }

          let anyOk = false;
          let menu = await openDropdown();

          if (!menu) {
            // Could not open dropdown — skip all values, mark as skipped
            failed.push(label + ' (không mở được dropdown, bỏ qua)');
            continue;
          }
          if (menu) {
            for (const val of vals) {
              const normVal = norm(val);

              // If dropdown closed after previous tick, reopen
              if (!menu || menu.offsetParent === null) {
                menu = await openDropdown();
                if (!menu) {
                  failed.push(label + ' (dropdown đóng giữa chừng)');
                  break;
                }
              }

              const opt = findCheckboxOpt(menu, normVal);
              if (!opt) continue;

              // Prefer clicking the inner checkbox (keeps dropdown open)
              const cb = opt.querySelector('input[type="checkbox"]') ||
                         opt.closest('li, label, [role="option"]')?.querySelector('input[type="checkbox"]');

              if (cb) {
                // Only click if NOT already checked — clicking a checked box would DESELECT it
                if (!cb.checked) {
                  cb.click();
                  await sleep(120); // wait for React to process the tick
                } else {
                  await sleep(20); // already correct, minimal pause
                }
              } else {
                // No checkbox found — check if the item appears selected before clicking
                const alreadySelected = opt.getAttribute('aria-selected') === 'true'
                  || norm(opt.className).includes('selected')
                  || norm(opt.className).includes('active');
                if (!alreadySelected) {
                  const ev = { bubbles: true, cancelable: true };
                  opt.dispatchEvent(new PointerEvent('pointerdown', ev));
                  opt.dispatchEvent(new MouseEvent('mousedown', ev));
                  opt.dispatchEvent(new PointerEvent('pointerup', ev));
                  opt.dispatchEvent(new MouseEvent('mouseup', ev));
                  opt.dispatchEvent(new MouseEvent('click', ev));
                  await sleep(300);
                } else {
                  await sleep(50);
                }
              }
              anyOk = true;
            }

            // ── Close the dropdown after all ticks ────────────────────────────
            if (anyOk) {
              // Click somewhere outside the container to close
              const rect   = container.getBoundingClientRect();
              const clickX = Math.max(0, rect.left - 20);
              const clickY = rect.top + rect.height / 2;
              document.elementFromPoint(clickX, clickY)?.dispatchEvent(
                new MouseEvent('mousedown', { bubbles: true, clientX: clickX, clientY: clickY })
              );
              await sleep(60);

              // Fallback: Escape if still open
              if (findPopupMenu()?.offsetParent !== null) {
                document.dispatchEvent(new KeyboardEvent('keydown',
                  { bubbles: true, key: 'Escape', keyCode: 27 }));
                await sleep(80);
              }
              ok = true;
            }
          }
        }

      /* ── Click a pattern tab by text (e.g. "Pattern: Miền Bắc") ────────── */
      // After filling Miền Nam, click the Miền Bắc tab to expose its fields.
      // Tab labels in the form are "Pattern: Miền Nam" / "Pattern: Miền Bắc".
      } else if (type === 'pattern-tab-click') {
        // value = 'Miền Nam' or 'Miền Bắc'; tab text = 'Pattern: Miền Nam' etc.
        const normVal = norm(value); // 'mien nam' or 'mien bac'

        // Poll up to 4 s for the tab to appear in DOM
        let tabEl = null;
        for (let w = 0; w < 40; w++) {
          const allClickable = [
            ...document.querySelectorAll('[role="tab"]'),
            ...document.querySelectorAll('[class*="tab"]'),
            ...document.querySelectorAll('button'),
            ...document.querySelectorAll('div[class*="Tab"], span[class*="Tab"]'),
          ];
          const candidates = allClickable.filter(el => {
            if (el.offsetParent === null) return false;
            const t = norm(el.textContent);
            // Match "Pattern: Miền Bắc" or just "Miền Bắc" — both are valid
            return t.includes(normVal) && t.length < 120;
          });
          if (candidates.length > 0) {
            // Prefer the one whose text starts with 'pattern' (most specific)
            tabEl = candidates.find(el => norm(el.textContent).startsWith('pattern'))
                 || candidates[0];
            break;
          }
          await sleep(100);
        }

        if (tabEl) {
          tabEl.scrollIntoView({ block: 'nearest' });
          tabEl.click();
          await sleep(100);
          // Poll until the tab becomes active.
          // These tabs use class "tab-section" (active) vs "tab-section-disabled" (inactive).
          // Also support aria-selected / active / selected for generic tabs.
          for (let w = 0; w < 30; w++) {
            await sleep(100);
            const active = tabEl.getAttribute('aria-selected') === 'true'
              || tabEl.classList.contains('active')
              || norm(tabEl.className).includes('active')
              || norm(tabEl.className).includes('selected')
              // tab-section (active) = has "tab-section" but NOT "tab-section-disabled"
              || (tabEl.classList.contains('tab-section') && !tabEl.classList.contains('tab-section-disabled'));
            if (active) break;
          }
          await sleep(150); // buffer for React to render tab content
          ok = true;
        }

      /* ── Date picker (id-based) ─────────────────────────────────────────── */
      // The form uses id="focus-target-..." to identify date inputs.
      // Click first to open the picker, then set the value + press Enter.
      } else if (type === 'date-id') {
        const wrapper = document.getElementById(dsKey) || findByDs(dsKey);
        if (wrapper) {
          wrapper.click();
          await sleep(50);
          const dateInput = (wrapper.tagName === 'INPUT')
            ? wrapper
            : wrapper.querySelector('input')
              || wrapper.closest('[class*="date"], [class*="picker"]')?.querySelector('input')
              || wrapper;
          dateInput.focus();
          setNativeValue(dateInput, String(value));
          dateInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 }));
          dateInput.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, key: 'Enter', keyCode: 13 }));
          dateInput.blur();
          ok = true;
        }

      /* ── Retail price table: fill Retail Price (+VAT) per tier and UPC ── */
      // value = { tierName: [price_upc1, price_upc2, ...] }
      // Traverses the datatable-product-uom-mapping table:
      //   • table-group-header rows mark the start of each tier section
      //   • subsequent data rows are UPCs in that tier (1st = Base, 2nd = Uom 1, etc.)
      } else if (type === 'retail-price-table') {
        const priceData = item.value; // the original object (not string-coerced)
        const table = findByDs(dsKey);
        if (table && priceData && typeof priceData === 'object') {
          const trs = [...table.querySelectorAll('tbody tr')];
          let currentTier = null;
          let upcIndexInTier = 0;
          let filledCount = 0;

          for (const tr of trs) {
            if (tr.classList.contains('table-group-header')) {
              currentTier = tr.querySelector('th')?.textContent?.trim() || null;
              upcIndexInTier = 0;
              continue;
            }
            if (!currentTier) continue;

            const tierPrices = priceData[currentTier];
            const price = tierPrices?.[upcIndexInTier];
            upcIndexInTier++;

            if (price == null || price === '') continue;

            // The price input is in the 3rd <td> (index 2) of the data row
            const cells = tr.querySelectorAll('td');
            if (cells.length < 3) continue;
            const priceCell = cells[2];
            const input =
              priceCell.querySelector('input[data-selector*="retail_selling_price_with_tax"]') ||
              priceCell.querySelector('input');

            if (input) {
              input.focus();
              input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
              setNativeValue(input, String(price));
              input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
              input.blur();
              filledCount++;
              await sleep(5); // small gap between fills
            }
          }
          ok = filledCount > 0;
        }
      }

    } catch (_) { ok = false; }

    if (ok) filled.push(label); else failed.push(label);

    // ── Inter-field delay ────────────────────────────────────────────────────
    // • Dropdown types (react-select, pattern, pattern-multi): value MUST be
    //   committed before continuing — enforced by DOM polling inside clickOption
    //   / fillReactSelect.  A small gap lets React flush state after menu closes.
    // • pattern-tab-click: brief wait already baked in (400 ms inside the handler)
    // • Fast fields (input, select-native, radio, toggle, date-id): React's
    //   synthetic events are processed synchronously — NO extra delay needed.
    const isDropdown = type === 'react-select' || type === 'pattern' || type === 'pattern-multi' || type === 'pattern-tab-click';
    if (item.waitForDs) {
      // Field triggers a re-render that adds new DOM nodes — poll until visible.
      // NOTE: we always do this regardless of ok — even if the field failed to fill
      // (e.g. checkbox not found), the form may still render its sub-fields and we
      // must wait for them before attempting the next items.
      const nextDs  = item.waitForDs;
      const maxWait = item.waitAfterMs ?? 2000;
      const start   = Date.now();
      while (Date.now() - start < maxWait) {
        const el = document.querySelector(`[data-selector="${CSS.escape(nextDs)}"]`)
                || document.querySelector(`[data-selector="${nextDs}"]`);
        // Require the element to be VISIBLE (not inside display:none)
        // This is critical for pattern tabs: Miền Bắc section is display:none until its tab is clicked
        if (el && el.offsetParent !== null) break;
        await sleep(80);
      }
      // Extra buffer after the first element appears so that ALL sibling fields
      // (Core Item, Supplier, MOQ etc.) also finish rendering.
      await sleep(200);
    } else if (item.waitAfterMs) {
      await sleep(item.waitAfterMs);
    } else if (type === 'react-select') {
      await sleep(80); // let React flush state before next field's step 0
    } else if (isDropdown) {
      // pattern types: internal timing handles it
    }
    // else: plain fields — no delay
  }

  return { filled, failed };
}

// Show fill result summary + persist to storage
function showFillResult(res, { save = true } = {}) {
  fillResult.classList.add('visible');
  const okLine = res.filled.length
    ? `<div class="fill-result-row ok">
        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M16.7 5.3a1 1 0 0 0-1.4 0L8 12.58 4.7 9.3a1 1 0 0 0-1.4 1.4l4 4a1 1 0 0 0 1.4 0l8-8a1 1 0 0 0 0-1.4z"/></svg>
        Đã điền ${res.filled.length} trường: ${res.filled.join(', ')}
       </div>` : '';
  const errLine = res.failed.length
    ? `<div class="fill-result-row err">
        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 1 0 0 16A8 8 0 0 0 10 2zm1 11H9v-2h2v2zm0-4H9V5h2v4z"/></svg>
        Không tìm thấy ${res.failed.length} trường: ${res.failed.join(', ')}
       </div>` : '';
  fillResult.innerHTML = okLine + errLine;
  if (save) {
    try { chrome.storage.local.set({ [CACHE_FILL]: { res, ts: Date.now() } }); } catch (_) {}
  }
}

// Restore last fill result (up to 10 min old) when popup reopens
async function restoreLastFillResult() {
  try {
    const stored = await new Promise((res, rej) =>
      chrome.storage.local.get(CACHE_FILL, r => chrome.runtime.lastError ? rej() : res(r))
    );
    const entry = stored[CACHE_FILL];
    if (!entry || Date.now() - entry.ts > 10 * 60 * 1000) return;
    showFillResult(entry.res, { save: false });
  } catch (_) {}
}

// Get the active form tab (the tab behind the popup in any normal browser window)
async function getFormTab() {
  // Query active tabs in normal windows — excludes popup/panel windows
  const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
  return tabs[0] || null;
}

// Inject fill script into active tab
async function runFill(tabNum) {
  if (!selectedRow) return;
  const fillItems = prepareFillData(tabNum);
  if (!fillItems.length) { setStatus('Không có dữ liệu để điền.', 'err'); return; }

  setStatus(`Đang điền Tab ${tabNum}…`, 'busy');

  try {
    const tab = await getFormTab();
    if (!tab) { setStatus('Không tìm thấy tab form.', 'err'); return; }

    // NOTE: We do NOT focus the browser window here — doing so would close this popup.
    // The injected script uses window.focus() inside the page to grab OS focus as needed.
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: __injectedFill,
      args: [fillItems]
    });
    const res = results?.[0]?.result ?? { filled: [], failed: [] };

    // ── Tab 2 extras: also fill Tab 4 prices + download product image ──────────
    if (tabNum === 2) {
      // Auto-fill Tab 4 retail prices at the same time
      const fillItems4 = prepareFillData(4);
      if (fillItems4.length) {
        const results4 = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: __injectedFill,
          args: [fillItems4]
        });
        const res4 = results4?.[0]?.result ?? { filled: [], failed: [] };
        res.filled.push(...res4.filled);
        res.failed.push(...res4.failed);
      }

      // Download product image so user can upload it to the form
      const imgUrl = (selectedRow['Image'] || '').trim();
      if (imgUrl) {
        const productName = getDisplayName(selectedRow) || 'product';
        chrome.downloads.download({
          url: imgUrl,
          filename: productName.replace(/[\\/:*?"<>|]/g, '_') + '.jpg',
        });
      }
    }

    showFillResult(res);
    const suffix = tabNum === 2 ? ' (+ Tab 4 + ảnh)' : '';
    const msg = `Tab ${tabNum}${suffix}: điền ${res.filled.length} trường, lỗi ${res.failed.length} trường.`;
    const st  = res.failed.length ? 'err' : 'ok';
    setStatus(msg, st);
    try { chrome.storage.local.set({ lastStatus: { msg, st, ts: Date.now() } }); } catch (_) {}
  } catch (err) {
    showFillResult({ filled: [], failed: [`Lỗi: ${err.message}`] });
    setStatus(`Lỗi: ${err.message}`, 'err');
  }
}

btnFill1.addEventListener('click', () => runFill(1));
btnFill2.addEventListener('click', () => runFill(2));
btnFill3.addEventListener('click', () => runFill(3));
btnFill4.addEventListener('click', () => runFill(4));

// ── Load all products on startup ──────────────────────────────────────────────
const btnReload = document.getElementById('btnReload');
const CACHE_KEY    = 'productRows_v1';
const CACHE_TAB    = 'selectedTab_v1';
const CACHE_FILL   = 'lastFillResult_v1';
const CACHE_SEL    = 'selectedProductName_v1';
const CACHE_TTL    = 60 * 60 * 1000; // 1 hour

// Persist selected product name
async function saveSelectedProduct(name) {
  try {
    await new Promise((res, rej) =>
      chrome.storage.local.set({ [CACHE_SEL]: name },
        () => chrome.runtime.lastError ? rej() : res())
    );
  } catch (_) {}
}

// Try to restore previously selected product after rows are loaded
async function restoreSelected() {
  try {
    const stored = await new Promise((res, rej) =>
      chrome.storage.local.get([CACHE_SEL, CACHE_TAB], r => chrome.runtime.lastError ? rej() : res(r))
    );
    const name = stored[CACHE_SEL];
    if (!name) return;
    const row = allRows.find(r => getDisplayName(r) === name);
    if (!row) return;
    // Restore the tab they were on, then re-select without resetting it
    const savedTab = stored[CACHE_TAB];
    if (savedTab) detailTab = savedTab;
    selectRow(row, null, { preserveTab: true });
    // Restore last fill result if any
    restoreLastFillResult();
  } catch (_) {}
}

function applyRows(rows) {
  allRows = rows.filter(row => {
    const name = getDisplayName(row).trim();
    return name && !name.startsWith('#REF');
  });
  filteredRows = allRows;
  totalBadge.textContent = `${allRows.length} sản phẩm`;
  totalBadge.className = 'badge badge-blue';
  ddTrigger.classList.remove('dd-disabled');
  ddLabel.innerHTML = '';
  ddLabel.textContent = 'Chọn sản phẩm…';
  ddLabel.classList.add('ph');
}

async function fetchFromServer() {
  const res  = await fetch(`${WEB_APP_URL}?keyword=&limit=500`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Unknown error');
  return data.rows || [];
}

async function loadAllProducts(forceRefresh = false) {
  // Try cache first
  if (!forceRefresh) {
    try {
      const cached = await new Promise((res, rej) =>
        chrome.storage.local.get(CACHE_KEY, r => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r))
      );
      const entry = cached[CACHE_KEY];
      if (entry && Date.now() - entry.ts < CACHE_TTL && entry.rows?.length) {
        applyRows(entry.rows);
        await restoreSelected();
        setStatus(`Đã tải ${allRows.length} sản phẩm từ cache.`, 'ok');
        setLoading(false);
        return;
      }
    } catch (_) { /* no cache, continue */ }
  }

  setLoading(true);
  btnReload.disabled = true;
  setStatus('Đang tải danh sách sản phẩm…', 'busy');
  try {
    const rows = await fetchFromServer();
    applyRows(rows);
    await restoreSelected();
    // Save to cache
    try {
      await new Promise((res, rej) =>
        chrome.storage.local.set({ [CACHE_KEY]: { rows, ts: Date.now() } },
          () => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res())
      );
    } catch (_) { /* cache write failed, ignore */ }
    setStatus(`Đã tải ${allRows.length} sản phẩm.`, 'ok');
  } catch (err) {
    totalBadge.textContent = 'Lỗi';
    totalBadge.className = 'badge badge-muted';
    ddLabel.innerHTML = '';
    ddLabel.textContent = 'Không thể tải dữ liệu';
    ddLabel.classList.add('ph');
    setStatus(`Lỗi: ${err.message}`, 'err');
  } finally {
    setLoading(false);
    btnReload.disabled = false;
  }
}

btnReload.addEventListener('click', () => loadAllProducts(true));

// ── Reload from server then restore selected product ─────────────────────────
async function reloadAndRestore() {
  const savedName = selectedRow ? getDisplayName(selectedRow) : null;
  const savedTab  = detailTab; // preserve current tab
  try {
    const rows = await fetchFromServer();
    applyRows(rows);
    // Re-select same product, preserving current tab view
    if (savedName) {
      const row = allRows.find(r => getDisplayName(r) === savedName);
      if (row) {
        detailTab = savedTab;
        selectRow(row, null, { preserveTab: true });
      }
    }
    // Update cache + persist selected name & tab so next popup open restores correctly
    chrome.storage.local.set({
      [CACHE_KEY]: { rows: allRows, ts: Date.now() },
      [CACHE_SEL]: savedName || '',
      [CACHE_TAB]: savedTab,
    });
  } catch (_) { /* silent — data already saved to sheet */ }
}

// Restore last status message if popup just reopened
(async () => {
  try {
    const stored = await new Promise((res, rej) =>
      chrome.storage.local.get('lastStatus', r => chrome.runtime.lastError ? rej() : res(r))
    );
    const entry = stored.lastStatus;
    if (entry && Date.now() - entry.ts < 10 * 60 * 1000) {
      setStatus(entry.msg + ' (khôi phục)', entry.st);
    }
  } catch (_) {}
})();

loadAllProducts(false);
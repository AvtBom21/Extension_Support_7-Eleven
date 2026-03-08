/**
 * popup.js — Bulk Final Approve / Reject
 *
 * Responsibilities:
 *  - Read form inputs and send START / STOP to the active tab's content script.
 *  - Receive LOG messages back from the content script and render them.
 *  - Persist log lines and running-state to chrome.storage.local so the log
 *    survives popup close/reopen during a run.
 */

'use strict';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const createdByEl = document.getElementById('createdBy');
const matchModeEl = document.getElementById('matchMode');
const statusFilterEl = document.getElementById('statusFilter');
const actionEl = document.getElementById('action');
const limitEl = document.getElementById('limit');
const delayEl = document.getElementById('delay');
const dryRunEl = document.getElementById('dryRun');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const statusBadge = document.getElementById('statusBadge');
const logEl = document.getElementById('log');
const clearLogBtn = document.getElementById('clearLog');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse "Created By" textarea into a trimmed, non-empty array. */
function parseCreatedBy(raw) {
  return raw
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Classify a log line for coloring in the log panel.
 * Returns one of: l-ok | l-warn | l-err | l-dry | l-summary | l-info
 */
function lineClass(msg) {
  if (msg === '[SEP]') return 'l-sep';
  if (msg.startsWith('[CARD]')) return 'l-card';
  if (msg.includes('[TIMEOUT]')) return 'l-warn';
  if (msg.includes('[WARNING]')) return 'l-warn';
  if (msg.includes('[STOPPED]')) return 'l-err';
  if (msg.includes('[DRY-RUN]')) return 'l-dry';
  if (msg.includes('[SUMMARY]')) return 'l-summary';
  if (msg.includes('[OK]')) return 'l-ok';
  if (msg.includes('[DONE]')) return 'l-ok';
  return 'l-info';
}

/** Append a log line to the visible log panel. */
function appendLog(msg) {
  const span = document.createElement('span');
  span.className = lineClass(msg);

  if (msg === '[SEP]') {
    span.textContent = '\u2500'.repeat(44) + '\n';
  } else if (msg.startsWith('[CARD]')) {
    span.textContent = '    ' + msg.replace('[CARD] ', '') + '\n';
  } else {
    span.textContent = msg + '\n';
  }

  logEl.appendChild(span);
  logEl.scrollTop = logEl.scrollHeight;
}

/** Persist a log line to chrome.storage.local. */
async function persistLog(msg) {
  const { bulkLogs = [] } = await chrome.storage.local.get('bulkLogs');
  bulkLogs.push(msg);
  // Keep at most 500 lines to avoid bloat
  const trimmed = bulkLogs.slice(-500);
  await chrome.storage.local.set({ bulkLogs: trimmed });
}

/** Load persisted logs into the panel. */
async function loadPersistedLogs() {
  const { bulkLogs = [] } = await chrome.storage.local.get('bulkLogs');
  bulkLogs.forEach(appendLog);
}

/** Update the status badge text + CSS class. */
function setBadge(text, cls) {
  statusBadge.textContent = text;
  statusBadge.className = '';               // clear all classes
  if (cls) statusBadge.classList.add(cls);
}

/** Reflect running state in the UI controls. */
function setRunning(isRunning, isDry = false) {
  btnStart.disabled = isRunning;
  btnStop.disabled = !isRunning;
  if (isRunning) {
    setBadge(isDry ? 'DRY-RUN' : 'RUNNING…', isDry ? 'dryrun' : 'running');
  } else {
    setBadge('IDLE', '');
  }
  chrome.storage.local.set({ bulkRunning: isRunning });
}

// ─── Form value persistence ───────────────────────────────────────────────

const FORM_STORAGE_KEY = 'bulkFormValues';

/** Save every form field into chrome.storage.local. */
function saveFormValues() {
  chrome.storage.local.set({
    [FORM_STORAGE_KEY]: {
      createdBy: createdByEl.value,
      matchMode: matchModeEl.value,
      statusFilter: statusFilterEl.value,
      action: actionEl.value,
      limit: limitEl.value,
      delay: delayEl.value,
      dryRun: dryRunEl.checked,
    }
  });
}

/** Restore form fields from chrome.storage.local (if saved). */
async function loadFormValues() {
  const { [FORM_STORAGE_KEY]: v } = await chrome.storage.local.get(FORM_STORAGE_KEY);
  if (!v) return;
  if (v.createdBy != null) createdByEl.value = v.createdBy;
  if (v.matchMode != null) matchModeEl.value = v.matchMode;
  if (v.statusFilter != null) statusFilterEl.value = v.statusFilter;
  if (v.action != null) actionEl.value = v.action;
  if (v.limit != null) limitEl.value = v.limit;
  if (v.delay != null) delayEl.value = v.delay;
  if (v.dryRun != null) dryRunEl.checked = v.dryRun;
}

// Auto-save on every change/input event.
[createdByEl, matchModeEl, statusFilterEl, actionEl, limitEl, delayEl].forEach(
  el => el.addEventListener('input', saveFormValues)
);
dryRunEl.addEventListener('change', saveFormValues);

// ─── Restore running state / logs / form values on popup open ────────────────────
(async () => {
  await loadFormValues();
  await loadPersistedLogs();
  const { bulkRunning = false } = await chrome.storage.local.get('bulkRunning');
  if (bulkRunning) setRunning(true);
})();

// ─── Listen for messages from content script ─────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'LOG') return;

  appendLog(msg.msg);
  persistLog(msg.msg);

  // Detect terminal log lines to reset UI state
  const text = msg.msg || '';
  if (
    text.includes('[SUMMARY]') ||
    text.includes('[STOPPED]') ||
    text.includes('[DONE]') ||
    text.includes('[WARNING] Already running')
  ) {
    // Mark as not running only on explicit terminal messages
    if (text.includes('[SUMMARY]') || text.includes('[STOPPED]')) {
      setRunning(false);
      setBadge('DONE', '');
    }
  }
});

// ─── Inject confirm patch helper ──────────────────────────────────────────────
/**
 * Always (re-)inject confirm_patch.js into the MAIN world of the tab.
 *
 * WHY: The static content_script declaration runs at document_start, but if
 * the page was already loaded before the extension was installed/enabled, that
 * window has passed. By injecting here programmatically we guarantee the
 * window.confirm patch is active regardless of when the user clicks Start.
 *
 * confirm_patch.js itself is idempotent (window.__bulkConfirmPatched guard),
 * so double-injection on normal page loads is a safe no-op.
 */
async function ensureConfirmPatch(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['confirm_patch.js'],
      world: 'MAIN',
    });
  } catch (err) {
    // Log but don't abort — the static injection may already be in place.
    appendLog(`[WARN] confirm_patch inject: ${err.message}`);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
btnStart.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    appendLog('[ERROR] No active tab found.');
    return;
  }

  const isDry = dryRunEl.checked;

  const config = {
    createdByList: parseCreatedBy(createdByEl.value),
    matchMode: matchModeEl.value,          // 'contains' | 'exact'
    statusFilter: statusFilterEl.value,       // 'waiting_to_approve' | 'all_pending' | 'any'
    action: actionEl.value,             // 'final_approve' | 'final_reject'
    limit: Math.max(0, parseInt(limitEl.value, 10) || 0),
    delay: Math.max(1, parseInt(delayEl.value, 10) || 1) * 1000, dryRun: isDry,
  };

  setRunning(true, isDry);

  // ── Step 1: Guarantee confirm_patch.js is active in MAIN world ──────────────
  // This handles the case where the page loaded before the extension was
  // installed (so document_start already fired without our script).
  await ensureConfirmPatch(tab.id);

  // ── Step 2: Send START to content script (inject it first if needed) ────────
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'START', config });
  } catch (err) {
    // Content script may not be injected yet — try scripting.executeScript
    appendLog('[INFO] Injecting content script…');
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      await chrome.tabs.sendMessage(tab.id, { type: 'START', config });
    } catch (err2) {
      appendLog(`[ERROR] Could not inject content script: ${err2.message}`);
      setRunning(false);
    }
  }
});

// ─── Stop ─────────────────────────────────────────────────────────────────────
btnStop.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  setBadge('STOPPING…', 'stopped');
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'STOP' });
  } catch (_) { /* tab may have navigated */ }
});

// ─── Clear log ────────────────────────────────────────────────────────────────
clearLogBtn.addEventListener('click', async () => {
  logEl.innerHTML = '';
  await chrome.storage.local.set({ bulkLogs: [] });
});
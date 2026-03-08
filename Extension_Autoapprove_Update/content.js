/**
 * content.js — Bulk Final Approve / Reject (content script, MV3)
 */

'use strict';

(function bulkApproveRejectInit() {
  if (window.__bulkApproveRejectInstalled) return;
  window.__bulkApproveRejectInstalled = true;

  let stopFlag = false;
  let running  = false;
  const dryRunHighlighted = new Set();

  // ─── Utility ────────────────────────────────────────────────────────────────

  function sendLog(msg) {
    try { chrome.runtime.sendMessage({ type: 'LOG', msg }); } catch (_) {}
    console.log('[BulkApprove]', msg);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function normalizeText(str) {
    return (str || '').trim().toLowerCase();
  }

  // ─── Status keyword maps ─────────────────────────────────────────────────────

  const STATUS_KEYWORDS = {
    waiting_to_approve : ['waiting to approve'],
    all_pending        : ['waiting to approve', 'pending', 'waiting'],
    any                : null,
  };

  // ─── Row / header helpers ────────────────────────────────────────────────────

  function getDataRows() {
    let rows = Array.from(document.querySelectorAll('[role="row"]'));
    if (rows.length === 0) rows = Array.from(document.querySelectorAll('tr'));
    return rows.filter(row =>
      row.querySelectorAll('td, [role="cell"], [role="gridcell"]').length > 0
    );
  }

  function getHeaderMap() {
    for (const row of document.querySelectorAll('[role="row"], tr')) {
      const hCells = row.querySelectorAll('th, [role="columnheader"]');
      if (!hCells.length) continue;
      const map = {};
      hCells.forEach((c, i) => { const t = normalizeText(c.innerText); if (t) map[t] = i; });
      return map;
    }
    return {};
  }

  function extractRowCard(row) {
    const headerMap = getHeaderMap();
    const cells = Array.from(row.querySelectorAll('td, [role="cell"], [role="gridcell"]'));
    function findCell(kws) {
      for (const kw of kws)
        for (const [h, i] of Object.entries(headerMap))
          if (h.includes(kw) && cells[i]) return (cells[i].innerText || '').trim();
      return '';
    }
    const id   = findCell(['product id','product code','item id','mã sản phẩm','mã sp','mã hàng','id']);
    const name = findCell(['product name','tên sản phẩm','tên sp','tên hàng','item name','name']);
    const tab  = findCell(['product tab','tab']);
    const date = findCell(['effective date','ngày hiệu lực','from date','to date','effective','date','ngày']);
    let label = id && name ? `${id} - ${name}` : name || id || '';
    if (tab)  label += (label ? ' : ' : '') + tab;
    if (date) label += (label ? ' - ' : '') + date;
    if (!label) label = (row.innerText || '').replace(/\n+/g, ' | ').substring(0, 150);
    return label;
  }

  // ─── Matching helpers ────────────────────────────────────────────────────────

  function rowMatchesCreatedBy(row, createdByList, mode) {
    if (!createdByList || createdByList.length === 0) return true;
    if (mode === 'exact') {
      const texts = Array.from(row.querySelectorAll('td, [role="cell"], [role="gridcell"]'))
                        .map(c => normalizeText(c.innerText));
      return createdByList.some(t => texts.includes(normalizeText(t)));
    }
    const rowText = normalizeText(row.innerText);
    return createdByList.some(t => rowText.includes(normalizeText(t)));
  }

  function rowMatchesStatus(row, statusFilter) {
    const kws = STATUS_KEYWORDS[statusFilter];
    if (!kws) return true;
    const rowText = normalizeText(row.innerText);
    return kws.some(k => rowText.includes(k));
  }

  // ─── Find action button ──────────────────────────────────────────────────────
  // NOTE: Removed the global WeakSet approach — it caused early stops when the
  // same DOM button was re-used after a failed/timeout action.
  // Now we check purely on real-time DOM state (disabled / aria-disabled).
  function findActionButton(row, exactText) {
    for (const btn of row.querySelectorAll('button, a, [role="button"]')) {
      if (btn.disabled) continue;
      if (btn.getAttribute('aria-disabled') === 'true') continue;
      if ((btn.innerText || '').trim() === exactText) return btn;
    }
    return null;
  }

  // ─── Wait for row to be FULLY processed ─────────────────────────────────────
  /**
   * Resolves when:
   *   1. The row is removed from the DOM, OR
   *   2. The action button disappears from the row (status changed).
   *
   * IMPORTANT: We do NOT resolve on "row text changed" because a loading spinner
   * briefly changes row text — that was the root cause of the premature-stop bug.
   */
  function waitForRowProcessed(row, actionText, timeoutMs) {
    return new Promise(resolve => {
      let done = false;
      const deadline = Date.now() + timeoutMs;

      function finish(reason) {
        if (done) return;
        done = true;
        if (observer) { try { observer.disconnect(); } catch (_) {} }
        clearInterval(poll);
        resolve(reason);
      }

      function check() {
        if (!document.body.contains(row))       { finish('row-removed'); return; }
        if (!findActionButton(row, actionText))  { finish('button-gone'); return; }
        if (Date.now() >= deadline)              { finish('timeout'); }
      }

      let observer = null;
      try {
        observer = new MutationObserver(check);
        observer.observe(document.body, {
          childList: true, subtree: true,
          attributes: true,
          attributeFilter: ['disabled', 'aria-disabled', 'class', 'style'],
        });
      } catch (_) {}

      const poll = setInterval(check, 300);
    });
  }

  // ─── Wait for page to stabilise after pagination ─────────────────────────────
  function waitForButtonsAppear(actionText, timeoutMs = 10_000) {
    return new Promise(resolve => {
      const deadline = Date.now() + timeoutMs;
      function check() {
        for (const b of document.querySelectorAll('button, a, [role="button"]')) {
          if ((b.innerText || '').trim() === actionText && !b.disabled) {
            resolve('found'); return;
          }
        }
        if (Date.now() >= deadline) { resolve('timeout'); return; }
        setTimeout(check, 300);
      }
      setTimeout(check, 400);
    });
  }

  // ─── Pagination ──────────────────────────────────────────────────────────────
  function clickNextPage() {
    for (const el of document.querySelectorAll('button, a, [role="button"], li > a, li > button')) {
      if (el.disabled) continue;
      if (el.getAttribute('aria-disabled') === 'true') continue;
      const li = el.closest('li');
      if (li && (li.classList.contains('disabled') || li.classList.contains('active-last'))) continue;

      const text  = (el.innerText || el.textContent || '').trim().toLowerCase();
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      const cls   = (el.className || '').toLowerCase();

      const isNext =
        text  === '>' || text === '»' || text === 'next' || text === 'tiếp' ||
        text  === 'next page' || text === 'trang sau' ||
        label.includes('next') || title.includes('next') ||
        cls.includes('next') || cls.includes('pagination-next') ||
        !!el.closest('[class*="next"]');

      if (isNext) { el.click(); return true; }
    }
    return false;
  }

  // ─── Confirm dialog auto-accept ──────────────────────────────────────────────

  function enableConfirmAutoAccept() {
    document.documentElement.dataset.bulkAutoConfirm = 'true';
    sendLog('[INFO] Confirm dialog auto-accept: ON');
  }

  function disableConfirmAutoAccept() {
    document.documentElement.dataset.bulkAutoConfirm = 'false';
  }

  // ─── Dry-run helpers ─────────────────────────────────────────────────────────

  function highlightDryRun(row) {
    row.dataset.bulkPrevOutline = row.style.outline || '';
    row.style.outline = '3px solid #f9e2af';
    dryRunHighlighted.add(row);
  }

  function clearDryRunHighlights() {
    for (const row of dryRunHighlighted) {
      try { row.style.outline = row.dataset.bulkPrevOutline || ''; delete row.dataset.bulkPrevOutline; } catch (_) {}
    }
    dryRunHighlighted.clear();
  }

  // ─── Main loop ───────────────────────────────────────────────────────────────

  async function run(config) {
    if (running) { sendLog('[WARNING] Already running. Send STOP first.'); return; }
    running  = true;
    stopFlag = false;

    const { createdByList, matchMode, statusFilter, action, limit, delay, dryRun } = config;

    // Map action value (from popup select) → exact button label on the page.
    // ALL four actions defined in popup.html must be listed here.
    const ACTION_BUTTON_TEXT = {
      final_approve   : 'Final Approve',
      final_reject    : 'Final Reject',
      apply_now       : 'Apply Now',
      unfinal_approve : 'UnFinal Approve',
    };
    const actionButtonText = ACTION_BUTTON_TEXT[action] || action;

    let processed           = 0;
    let timeouts            = 0;
    // consecutiveEmptyPasses: how many full row-scans found ZERO matching buttons
    let consecutiveEmpty    = 0;
    const MAX_EMPTY_BEFORE_NEXTPAGE = 2;   // retry current page N times before paginating
    const MAX_EMPTY_PAGES   = 3;           // stop if N pages in a row have no matches
    let emptyPageStreak     = 0;

    const MAX_LOOPS = limit > 0 ? limit * 4 : 100_000;
    let loopGuard   = 0;

    sendLog(
      `[START] action="${actionButtonText}" status="${statusFilter}" ` +
      `mode="${matchMode}" limit=${limit || '∞'} delay=${delay}ms` +
      (dryRun ? ' DRY-RUN' : '')
    );

    if (dryRun) clearDryRunHighlights();
    else        enableConfirmAutoAccept();

    outerLoop:
    while (loopGuard++ < MAX_LOOPS) {

      if (stopFlag) { sendLog('[STOPPED] Stop flag set.'); break; }
      if (limit > 0 && processed >= limit) { sendLog(`[DONE] Reached limit of ${limit}.`); break; }

      const rows = getDataRows();
      let foundMatch = false;

      for (const row of rows) {
        if (stopFlag) break outerLoop;
        if (limit > 0 && processed >= limit) break outerLoop;

        if (!rowMatchesCreatedBy(row, createdByList, matchMode)) continue;
        if (!rowMatchesStatus(row, statusFilter)) continue;

        const btn = findActionButton(row, actionButtonText);
        if (!btn) continue;

        // ── Found a match ─────────────────────────────────────────────────────
        foundMatch      = true;
        consecutiveEmpty = 0;
        emptyPageStreak  = 0;

        const card = extractRowCard(row);

        // ── DRY-RUN ──────────────────────────────────────────────────────────
        if (dryRun) {
          highlightDryRun(row);
          sendLog(`[DRY-RUN] #${processed + 1}`);
          sendLog(`[CARD] ${card}`);
          sendLog('[SEP]');
          processed++;
          continue; // keep scanning same DOM snapshot
        }

        // ── LIVE ─────────────────────────────────────────────────────────────
        sendLog(`[PROCESSING] #${processed + 1}`);
        sendLog(`[CARD] ${card}`);

        // Small settle delay before clicking.
        await sleep(80);

        btn.click();
        processed++;

        // Allow confirm dialog to appear (confirm_patch will auto-accept it).
        await sleep(200);

        // Wait until the button is gone from this row (true completion signal).
        const reason = await waitForRowProcessed(row, actionButtonText, 25_000);

        if (reason === 'timeout') {
          timeouts++;
          sendLog(`[TIMEOUT] Row #${processed}: UI did not settle in 25 s.`);
        } else {
          sendLog(`[OK] Row #${processed}: settled (${reason}).`);
        }
        sendLog('[SEP]');

        if (delay > 0) await sleep(delay);

        // Re-query DOM from scratch next iteration.
        break;
      }

      // ── No matching row found in this full scan ───────────────────────────────
      if (!foundMatch) {
        if (dryRun) break;

        consecutiveEmpty++;

        if (consecutiveEmpty < MAX_EMPTY_BEFORE_NEXTPAGE) {
          // Page might still be loading — wait and retry same page.
          await sleep(700);
          continue;
        }

        // Attempt pagination.
        sendLog('[INFO] No matches on current page — trying next page…');
        const clicked = clickNextPage();

        if (!clicked) {
          sendLog('[DONE] No more matching rows and no next page found.');
          break;
        }

        sendLog('[INFO] Next page clicked — waiting for page to load…');
        const appeared = await waitForButtonsAppear(actionButtonText, 10_000);

        if (appeared === 'timeout') {
          emptyPageStreak++;
          sendLog(`[WARN] Buttons not found after pagination (${emptyPageStreak}/${MAX_EMPTY_PAGES}).`);
          if (emptyPageStreak >= MAX_EMPTY_PAGES) {
            sendLog('[DONE] Too many consecutive empty pages — stopping.');
            break;
          }
        } else {
          emptyPageStreak = 0;
        }

        consecutiveEmpty = 0;
        await sleep(400);
      }
    }

    if (loopGuard >= MAX_LOOPS) sendLog('[WARNING] Safety loop-cap reached — stopping.');
    sendLog(`[SUMMARY] Processed: ${processed} | Timeouts: ${timeouts}`);
    if (!dryRun) disableConfirmAutoAccept();
    running = false;
  }

  // ─── Message listener ────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'START') {
      run(msg.config).catch(err => sendLog(`[ERROR] Uncaught: ${err.message}`));
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'STOP') {
      stopFlag = true;
      running  = false;
      clearDryRunHighlights();
      disableConfirmAutoAccept();
      sendResponse({ ok: true });
      return true;
    }
  });

  console.log('[BulkApprove] Content script installed.');
})();
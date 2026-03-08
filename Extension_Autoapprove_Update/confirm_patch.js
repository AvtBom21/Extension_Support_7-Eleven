/**
 * confirm_patch.js — runs in MAIN world (see manifest.json)
 *
 * Intercepts window.confirm at document_start using Object.defineProperty so
 * the page's own JS cannot overwrite our patch (common in SPAs).
 * Reads document.documentElement.dataset.bulkAutoConfirm written by content.js.
 *
 * Idempotent: safe to inject multiple times (re-injection is a no-op).
 */

(function () {
  'use strict';

  // ── Idempotency guard ──────────────────────────────────────────────────────
  // If we've already patched window.confirm on this page, do nothing.
  // This is essential because popup.js injects this script on every "Start"
  // click to guarantee the patch is active even if document_start already passed.
  if (window.__bulkConfirmPatched) return;
  window.__bulkConfirmPatched = true;

  // Capture the real native confirm before anything else runs.
  const _nativeConfirm = window.confirm.bind(window);

  function patchedConfirm(msg) {
    if (document.documentElement.dataset.bulkAutoConfirm === 'true') {
      console.log('[BulkApprove] auto-accepted confirm():', msg);
      return true;
    }
    return _nativeConfirm(msg);
  }

  // Use Object.defineProperty so the page cannot do window.confirm = ... later.
  try {
    Object.defineProperty(window, 'confirm', {
      get()  { return patchedConfirm; },
      set()  { /* silently block page overwrites */ },
      configurable: false,
    });
  } catch (_) {
    // Fallback if defineProperty fails (shouldn't happen in Chrome).
    window.confirm = patchedConfirm;
  }
})();
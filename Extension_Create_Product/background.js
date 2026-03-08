// background.js — minimal service worker
// The popup is now a standard toolbar popup (default_popup in manifest).
// No window management needed. We only keep this file so the service_worker
// field in manifest.json is satisfied and permissions stay registered.

// Optional: clear stale session data on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.clear();
});
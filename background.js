/**
 * Classroom++ — background service worker.
 *
 * Owns the one thing that decides whether the extension may run: host access.
 * - Access is optional. Nothing is declared at install time and nothing is
 *   injected until the user clicks "Enable on Google Classroom" in the popup
 *   or on the welcome page, so Chrome asks for the site only on that click.
 * - Right after the grant, the content script is registered dynamically and
 *   persists across browser restarts; if access is revoked in Chrome, the
 *   registration is removed again and no page is touched.
 * - On first install: initializes sync settings, opens onboarding.html.
 * - On update: re-registers for users who already granted access, refreshes
 *   open Classroom tabs, and opens changelog.html.
 */

/** The only site Classroom++ ever touches. Requested optionally, on a click. */
const CLASSROOM_ORIGIN = 'https://classroom.google.com/*';
const CONTENT_SCRIPT_ID = 'classroompp-content';

/** Yes/no answer to "may this extension run on Classroom?", never a guess. */
function hasClassroomAccess(callback = () => {}) {
  if (!chrome.permissions || !chrome.permissions.contains) return callback(false);
  chrome.permissions.contains({ origins: [CLASSROOM_ORIGIN] }, (granted) => {
    callback(Boolean(granted) && !chrome.runtime.lastError);
  });
}

function registerContentScripts(callback = () => {}) {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return callback();
  const script = {
    id: CONTENT_SCRIPT_ID,
    matches: [CLASSROOM_ORIGIN],
    js: ['src/content.js'],
    css: ['src/content.css'],
    runAt: 'document_idle',
    allFrames: false,
    persistAcrossSessions: true
  };
  chrome.scripting.registerContentScripts([script], () => {
    if (!chrome.runtime.lastError) return callback();
    // Already registered (a restart, or a re-grant): update it in place.
    chrome.scripting.updateContentScripts([script], () => {
      void chrome.runtime.lastError;
      callback();
    });
  });
}

function unregisterContentScripts(callback = () => {}) {
  if (!chrome.scripting || !chrome.scripting.unregisterContentScripts) return callback();
  chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] }, () => {
    // Nothing registered is the normal case, not an error worth reporting.
    void chrome.runtime.lastError;
    callback();
  });
}

/**
 * Keep the registration in step with the permission the user actually holds.
 * Without access nothing is registered, so Classroom is left untouched.
 */
function syncContentScriptRegistration(callback = () => {}) {
  hasClassroomAccess((granted) => {
    if (!granted) return unregisterContentScripts(callback);
    registerContentScripts(callback);
  });
}

/**
 * Reload every open Google Classroom tab so the content script is injected
 * immediately instead of waiting for the user to refresh.
 */
function reloadClassroomTabs() {
  if (!chrome.tabs || !chrome.tabs.query) return;
  chrome.tabs.query({ url: CLASSROOM_ORIGIN }, (tabs) => {
    // Swallow "no tab" races and missing host access instead of logging noise.
    if (chrome.runtime.lastError) return;
    for (const tab of tabs || []) {
      if (typeof tab.id !== 'number') continue;
      chrome.tabs.reload(tab.id, {}, () => void chrome.runtime.lastError);
    }
  });
}

/** The popup and the welcome page ask for access themselves, then say so. */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'classroom-access-changed') return false;
  syncContentScriptRegistration(() => {
    if (message.granted) reloadClassroomTabs();
    sendResponse({ ok: true });
  });
  return true;
});

// A restart keeps the grant, so the registration is restored on its own.
chrome.runtime.onStartup.addListener(() => syncContentScriptRegistration());

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      isReversed: false,
      visiblePosts: 5,
      scrollWindows: true,
      moveOverlay: true,
      reverseButton: true,
      bulkReview: true,
      firstRun: true
    });
    // No access yet: this just clears any stale registration.
    syncContentScriptRegistration();
    chrome.tabs.create({ url: 'onboarding.html' });
    return;
  }

  if (details.reason === 'update') {
    // People who granted access on an earlier version keep working without
    // clicking Enable again; everyone else enables it from the popup.
    hasClassroomAccess((granted) => {
      if (!granted) return;
      registerContentScripts(() => reloadClassroomTabs());
    });
    // Automatically open the changelog page on update
    chrome.tabs.create({ url: 'changelog.html' });
  }
});

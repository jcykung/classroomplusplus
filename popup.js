document.addEventListener('DOMContentLoaded', () => {
  const toggleScroll = document.getElementById('toggleScrollWindows');
  const toggleOverlay = document.getElementById('toggleMoveOverlay');
  const toggleReverse = document.getElementById('toggleReverseButton');
  const toggleBulkReview = document.getElementById('toggleBulkReview');
  const statusEl = document.getElementById('statusMessage');
  const tipBtn = document.getElementById('tipBtn');
  const welcomeLink = document.getElementById('welcomeLink');
  const versionLink = document.getElementById('versionLink');
  const enableCard = document.getElementById('enableCard');
  const enableBtn = document.getElementById('enableBtn');
  const settingsGroup = document.getElementById('settingsGroup');

  // Site access is optional: Chrome asks for classroom.google.com only when the
  // user clicks, never at install.
  const CLASSROOM_ORIGIN = 'https://classroom.google.com/*';
  const STATUS_DEFAULT = 'Settings sync automatically across all your devices.';

  const TOGGLES = [toggleScroll, toggleOverlay, toggleReverse, toggleBulkReview];

  function setStatus(text, color) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = color;
    clearTimeout(setStatus.timer);
    if (text === STATUS_DEFAULT) return;
    setStatus.timer = setTimeout(() => {
      statusEl.textContent = STATUS_DEFAULT;
      statusEl.style.color = '#718096';
    }, 3000);
  }

  /**
   * Without site access nothing is injected, so the switches stay locked and
   * the Enable button takes their place.
   */
  function setAccessState(granted) {
    if (enableCard) enableCard.hidden = granted;
    if (settingsGroup) settingsGroup.classList.toggle('is-locked', !granted);
    for (const toggle of TOGGLES) {
      if (toggle) toggle.disabled = !granted;
    }
  }

  function checkAccess() {
    if (!chrome.permissions || !chrome.permissions.contains) return setAccessState(false);
    chrome.permissions.contains({ origins: [CLASSROOM_ORIGIN] }, (granted) => {
      setAccessState(Boolean(granted) && !chrome.runtime.lastError);
    });
  }

  // Enable on Google Classroom
  if (enableBtn) {
    enableBtn.addEventListener('click', () => {
      enableBtn.disabled = true;
      // Must run straight from the click: Chrome only prompts for a gesture.
      chrome.permissions.request({ origins: [CLASSROOM_ORIGIN] }, (granted) => {
        enableBtn.disabled = false;
        if (chrome.runtime.lastError || !granted) {
          setStatus('Access was not granted, so Classroom++ stays off.', '#b91c1c');
          return;
        }
        setAccessState(true);
        // The background worker registers the content script and refreshes
        // Classroom tabs that are already open.
        chrome.runtime.sendMessage(
          { type: 'classroom-access-changed', granted: true },
          () => void chrome.runtime.lastError
        );
        setStatus('Enabled — open Google Classroom to see it.', '#16803c');
      });
    });
  }

  // Tip Me button (Ko-Fi)
  if (tipBtn) {
    tipBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://ko-fi.com/coolpuddytat' });
    });
  }

  // Welcome Screen
  if (welcomeLink) {
    welcomeLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'onboarding.html' });
    });
  }

  // Version link -> Changelog
  if (versionLink) {
    const manifestVersion = chrome.runtime.getManifest().version;
    versionLink.textContent = `v. ${manifestVersion}`;
    versionLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'changelog.html' });
    });
  }

  // Load saved settings from sync storage. A Classwork feature that was never
  // saved on its own keeps what the old single "Classwork Layout" switch said,
  // so an existing choice is never silently overwritten.
  chrome.storage.sync.get(
    ['scrollWindows', 'moveOverlay', 'reverseButton', 'bulkReview', 'classworkLayout', 'smartCentering'],
    (result) => {
      const legacyLayout =
        typeof result.classworkLayout === 'boolean'
          ? result.classworkLayout
          : result.smartCentering !== false;
      const saved = (key) => (typeof result[key] === 'boolean' ? result[key] : legacyLayout);

      if (toggleScroll) toggleScroll.checked = saved('scrollWindows');
      if (toggleOverlay) toggleOverlay.checked = saved('moveOverlay');
      if (toggleReverse) toggleReverse.checked = saved('reverseButton');
      if (toggleBulkReview) toggleBulkReview.checked = result.bulkReview !== false;
    }
  );

  // Settings are read once when the page loads, so every open Classroom tab has
  // to be refreshed for a change to apply. Bursts of toggles reload only once.
  let reloadTimer = 0;
  function reloadClassroomTabs() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = 0;
      if (!chrome.tabs || !chrome.tabs.query) return;
      chrome.tabs.query({ url: CLASSROOM_ORIGIN }, (tabs) => {
        // Without the optional host permission this query can fail; the
        // switches are locked in that case, so there is nothing to reload.
        if (chrome.runtime.lastError) return;
        for (const tab of tabs || []) {
          if (typeof tab.id === 'number') chrome.tabs.reload(tab.id);
        }
      });
    }, 150);
  }

  // Handle setting updates. Only the switches that exist are written — this
  // must never overwrite isReversed with a default.
  function saveSettings() {
    const settings = {};
    if (toggleScroll) settings.scrollWindows = toggleScroll.checked;
    if (toggleOverlay) settings.moveOverlay = toggleOverlay.checked;
    if (toggleReverse) settings.reverseButton = toggleReverse.checked;
    if (toggleBulkReview) settings.bulkReview = toggleBulkReview.checked;

    chrome.storage.sync.set(settings, () => {
      setStatus('Settings saved and synced!', '#16803c');
      reloadClassroomTabs();
    });
  }

  for (const toggle of TOGGLES) {
    if (toggle) toggle.addEventListener('change', saveSettings);
  }

  checkAccess();
});

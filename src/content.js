/**
 * Classroom++ — content script.
 *
 * On Google Classroom's Classwork page:
 * 1. Loads every post of every Topic up front (clicking Google's "View more"
 *    until the topic is complete), then limits the visible posts to 5.
 *    (User can click "View all" to expand to show all posts in the Topic).
 * 2. Each Topic section is scrollable through all posts. Expanding a post
 *    grows the scroll window by the same amount, so the whole post stays
 *    visible while it is being edited.
 * 3. By default (on entering/returning to Classwork), scrolls so that
 *    the latest published post (not drafts) is aligned to the middle
 *    of the scroll (the 3rd post of the 5 showing), allowing the user to
 *    see what came before and what needs to be edited and posted next.
 * 4. Entering a class's Classwork never forces a page reload: the view mounts
 *    fresh, so its posts come from Classroom, and returning to a class reuses
 *    the posts already on the page. The loading bar only appears when there is
 *    actually work to do.
 * 5. Every post in a topic carries a small overlay that fades in on hover: an
 *    up arrow, a dot that opens the topic picker, and a down arrow. Dragging a
 *    post is fiddly, so these move it one step (or into another topic) instead.
 */
(() => {
  'use strict';

  const CONFIG = {
    /** How many posts fit in a collapsed topic window. */
    visiblePosts: 5,
    /** Topics with this many posts or fewer are left untouched. */
    minPostsToWindow: 6,
    /** Set true for console logging while debugging selectors. */
    debug: false,
  };

  const CLASS = {
    window: 'cpp-scroll-window',
    expanded: 'cpp-expanded',
    ui: 'cpp-ui',
    controls: 'cpp-controls',
    toggle: 'cpp-toggle',
    toggleText: 'cpp-toggle-text',
    toggleIcon: 'cpp-toggle-icon',
    moveHost: 'cpp-move-host',
    moveActive: 'cpp-move-active',
    moveControls: 'cpp-move-controls',
    moveBtn: 'cpp-move-btn',
    moveUp: 'cpp-move-up',
    moveDown: 'cpp-move-down',
    moveTopic: 'cpp-move-topic',
    topicMenu: 'cpp-move-menu',
    topicMenuTitle: 'cpp-move-menu-title',
    topicOption: 'cpp-move-option',
    topicCurrent: 'cpp-move-current',
    topicMenuEmpty: 'cpp-move-menu-empty',
  };

  const VARS = {
    height: '--cpp-window-height',
  };

  const MAIN_SELECTOR = '[role="main"], main, #yDmH0d, body';

  /**
   * The main region of the view currently on screen.
   *
   * Classroom keeps previously visited classes' regions in the DOM, and they
   * come first in document order. Taking the first match therefore meant
   * enhancing a hidden copy of an older class while the class on screen stayed
   * untouched — which looked like the extension doing nothing until a reload.
   */
  function getMainElement() {
    const candidates = Array.from(document.querySelectorAll(MAIN_SELECTOR));
    for (const el of candidates) {
      if (el === document.body || el === document.documentElement) continue;
      if (el.getClientRects().length) return el;
    }
    return candidates[0] || document.body;
  }
  const ROLE_ITEM_SELECTOR = 'li[data-stream-item-id], [data-stream-item-id], [role="listitem"]';
  const SKIP_ANCESTOR_SELECTOR =
    'aside, nav, [role="navigation"], [role="complementary"], [role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [role="combobox"], .aqdrmf-rymPhb, [jscontroller="bZ0mod"], [data-is-select-menu="true"]';

  // Work item links: match assignment, material, question, post links in Google Classroom
  const WORK_LINK_RE = /(?:\/c\/|\/w\/|\/u\/\d+\/c\/|\/u\/\d+\/w\/)[^/]+\/(?:a|m|q|p)\/[^/]+/;

  // Selector for Google Classroom's native "View more" button
  const VIEW_MORE_SELECTOR = 'button[aria-label*="View more" i], [role="button"][aria-label*="View more" i]';

  const CHEVRON_SVG = `
    <svg class="${CLASS.toggleIcon}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
    </svg>
  `.trim();

  const SORT_ICON_SVG = `
    <svg class="cpp-sort-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3L5 6.99h3V14h2V6.99h3L9 3zm7 14.01V10h-2v7.01h-3L15 21l4-3.99h-3z"/>
    </svg>
  `.trim();

  const MOVE_ICON = {
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5 18 13h-3.7v4.5H9.7V13H6z"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.5 6 11h3.7V6.5h4.6V11H18z"/></svg>',
    dot: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/></svg>',
  };

  /** Used for the move controls until the course's own theme colour is read. */
  const DEFAULT_THEME_COLOR = '#0b57d0';
  /** How long a post takes to slide into its new place. */
  const MOVE_ANIM_MS = 220;
  // Keeps the dot on the post header's vertical midpoint, not low on the card.
  const MOVE_TOP = 2;

  /** Theme colour cache: the class banner is read once, not on every scan. */
  let themeColorCache = '';
  let themeColorCacheAt = 0;
  let themeColorCachePath = '';

  /** Pull a saturated colour out of a CSS colour or gradient, if there is one. */
  function colorFromStyle(value) {
    const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/.exec(
      value || ''
    );
    if (!match) return '';
    if (match[4] !== undefined && parseFloat(match[4]) < 0.5) return '';
    const rgb = [match[1], match[2], match[3]].map((n) => Math.round(parseFloat(n)));
    const max = Math.max(rgb[0], rgb[1], rgb[2]);
    const min = Math.min(rgb[0], rgb[1], rgb[2]);
    // Whites, blacks and greys are page chrome, not a course theme.
    if (max - min < 24 || min > 232 || max < 40) return '';
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  function themeColorFrom(el) {
    if (!el) return '';
    let style = null;
    try {
      style = getComputedStyle(el);
    } catch (_) {
      return '';
    }
    const direct = colorFromStyle(style.backgroundColor);
    if (direct) return direct;
    const image = style.backgroundImage || '';
    if (!image || image === 'none') return '';
    for (const value of image.match(/rgba?\([^)]*\)/g) || []) {
      const found = colorFromStyle(value);
      if (found) return found;
    }
    return '';
  }

  /**
   * The class's own theme colour, so the move controls look like part of the
   * course instead of generic white chrome.
   *
   * Classroom paints the class banner with the course theme (a flat colour for
   * colour themes, a gradient for image themes), so the banner is read first
   * and the first large coloured surface near the top is the fallback.
   */
  function courseThemeColor() {
    const path = location.pathname;
    const now = Date.now();
    if (themeColorCache && themeColorCachePath === path && now - themeColorCacheAt < 5000) {
      return themeColorCache;
    }
    const banner = document.querySelector(
      '[jsname="r4nke"], .d4Fe0d, .tLDEHd, [data-course-theme], header, [role="banner"]'
    );
    let color = themeColorFrom(banner);
    if (!color) {
      const scope = banner || document.body;
      const all = scope.querySelectorAll('*');
      for (let i = 0; i < all.length && i < 600; i++) {
        const el = all[i];
        if (el.closest(`.${CLASS.ui}`)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 40) continue;
        const found = themeColorFrom(el);
        if (found) {
          color = found;
          break;
        }
      }
    }
    themeColorCache = color || DEFAULT_THEME_COLOR;
    themeColorCacheAt = now;
    themeColorCachePath = path;
    return themeColorCache;
  }

  const SORT_STORAGE_KEY = 'cpp_reverse_order';
  let isReversed = (() => {
    try {
      return localStorage.getItem(SORT_STORAGE_KEY) === 'true';
    } catch (_) {
      return false;
    }
  })();

  function saveSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ isReversed });
    }
    try {
      localStorage.setItem(SORT_STORAGE_KEY, String(isReversed));
    } catch (_) {}
  }

  /** Bulk "mark as reviewed" checkboxes on the To review page (on by default). */
  let bulkReviewEnabled = true;
  /** 5-post scroll areas, full loading, centring and View all / View fewer. */
  let scrollWindowsEnabled = true;
  /** The up arrow / topic dot / down arrow overlay beside each post. */
  let moveOverlayEnabled = true;
  /** The Reverse order button next to Classroom's "Collapse all". */
  let reverseButtonEnabled = true;

  /**
   * The old single "Classwork Layout" switch. It is a fallback now: anyone who
   * turned it off keeps all three Classwork features off until they choose.
   */
  function readLegacyClassworkLayout(result) {
    if (!result) return true;
    if (typeof result.classworkLayout === 'boolean') return result.classworkLayout;
    return result.smartCentering !== false;
  }

  /** A feature switch, falling back to the old master switch if never set. */
  function readFeatureSwitch(result, key) {
    if (result && typeof result[key] === 'boolean') return result[key];
    return readLegacyClassworkLayout(result);
  }

  const SETTINGS_KEYS = [
    'isReversed',
    'bulkReview',
    'scrollWindows',
    'moveOverlay',
    'reverseButton',
    'classworkLayout',
    'smartCentering',
  ];

  function loadInitialSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(SETTINGS_KEYS, (result) => {
        if (result && typeof result.isReversed === 'boolean') {
          if (result.isReversed !== isReversed) {
            isReversed = result.isReversed;
            try {
              localStorage.setItem(SORT_STORAGE_KEY, String(isReversed));
            } catch (_) {}
            refreshSortButton();
            applySortOrderToAll();
          }
        }
        if (result && typeof result.bulkReview === 'boolean') {
          bulkReviewEnabled = result.bulkReview;
          updateReviewMode();
        }
        const windows = readFeatureSwitch(result, 'scrollWindows');
        const overlay = readFeatureSwitch(result, 'moveOverlay');
        const reverse = readFeatureSwitch(result, 'reverseButton');
        if (
          windows !== scrollWindowsEnabled ||
          overlay !== moveOverlayEnabled ||
          reverse !== reverseButtonEnabled
        ) {
          scrollWindowsEnabled = windows;
          moveOverlayEnabled = overlay;
          reverseButtonEnabled = reverse;
          scan();
        }
      });
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.isReversed) {
        const newVal = changes.isReversed.newValue === true;
        if (newVal !== isReversed) {
          isReversed = newVal;
          try {
            localStorage.setItem(SORT_STORAGE_KEY, String(isReversed));
          } catch (_) {}
          refreshSortButton();
          applySortOrderToAll();
        }
      }
      if (area === 'sync' && changes.bulkReview) {
        bulkReviewEnabled = changes.bulkReview.newValue !== false;
        updateReviewMode();
      }
      if (area === 'sync' && changes.scrollWindows) {
        scrollWindowsEnabled = changes.scrollWindows.newValue !== false;
        scan();
      }
      if (area === 'sync' && changes.moveOverlay) {
        moveOverlayEnabled = changes.moveOverlay.newValue !== false;
        scan();
      }
      if (area === 'sync' && changes.reverseButton) {
        reverseButtonEnabled = changes.reverseButton.newValue !== false;
        scan();
      }
      if (area === 'sync' && changes.classworkLayout) {
        const on = changes.classworkLayout.newValue !== false;
        scrollWindowsEnabled = on;
        moveOverlayEnabled = on;
        reverseButtonEnabled = on;
        scan();
      }
    });
  }

  const log = (...args) => {
    if (CONFIG.debug) console.log('[Classroom++]', ...args);
  };

  /** Track whether we're in the middle of expanding Google's hidden posts. */
  let isExpanding = false;
  /** Track whether we've injected our CSS to hide Google's View more. */
  let viewMoreCssInjected = false;

  // ── Loading overlay ──────────────────────────────────────────────────────

  let overlayEl = null;
  let overlayBar = null;
  let overlayLabel = null;
  let overlayHideTimer = null;

  /** How long to wait after the last setup activity before hiding the overlay. */
  const SETUP_QUIET_MS = 300;
  /** Hard cap per loading burst: the global overlay always hides after this long
   * unless batches are still arriving (see SETUP_ABSOLUTE_MAX_MS). */
  const SETUP_MAX_MS = 2500;
  /** Absolute cap for a single bulk load, however many batches it needs. */
  const SETUP_ABSOLUTE_MAX_MS = 60000;
  /** View more clicks can take a while on school networks; don't hang forever. */
  const EXPANSION_WAIT_TIMEOUT = 3500;

  let setupActive = false;
  let setupStartedAt = 0;
  let setupFinishTimer = 0;
  let setupHardTimer = 0;
  let pendingLayoutSettles = 0;

  function ensureOverlay() {
    if (overlayEl && overlayEl.isConnected) {
      // Re-use an overlay that is still fading out instead of creating a new one.
      clearTimeout(overlayHideTimer);
      overlayHideTimer = null;
      overlayEl.classList.remove('cpp-loading-done');
      overlayEl.classList.add('cpp-loading-visible');
      return;
    }

    overlayEl = document.createElement('div');
    overlayEl.className = 'cpp-loading-overlay';
    overlayEl.setAttribute('role', 'status');
    overlayEl.setAttribute('aria-live', 'polite');
    overlayEl.setAttribute('aria-label', 'Loading posts…');

    overlayLabel = document.createElement('div');
    overlayLabel.className = 'cpp-loading-label';
    overlayLabel.innerHTML = '<span class="cpp-loading-icon"></span><span class="cpp-loading-text">Loading posts…</span>';

    const track = document.createElement('div');
    track.className = 'cpp-loading-track';

    overlayBar = document.createElement('progress');
    overlayBar.className = 'cpp-loading-bar';
    overlayBar.setAttribute('aria-hidden', 'true');
    // Start indeterminate (no value attr) until we know total
    track.appendChild(overlayBar);

    overlayEl.appendChild(overlayLabel);
    overlayEl.appendChild(track);
    document.body.appendChild(overlayEl);

    // Trigger fade-in on next frame. The timeout is a fallback for cases where
    // requestAnimationFrame is throttled (background tab / headless render).
    const showOverlay = () => {
      if (overlayEl) overlayEl.classList.add('cpp-loading-visible');
    };
    requestAnimationFrame(() => requestAnimationFrame(showOverlay));
    setTimeout(showOverlay, 50);
  }

  /**
   * Start the global loading session. Only called when a topic actually has
   * posts left to fetch, so tabs/visits with everything already loaded show
   * no bar at all. The overlay always hides after SETUP_QUIET_MS of calm or
   * SETUP_MAX_MS per burst, whichever is first.
   */
  function beginSetup() {
    if (!setupActive) {
      setupActive = true;
      setupStartedAt = Date.now();
      ensureOverlay();
      // Absolute guarantee: the bar can never get stuck.
      clearTimeout(setupHardTimer);
      setupHardTimer = window.setTimeout(forceFinishSetup, SETUP_MAX_MS);
    }
    noteSetupActivity();
  }

  /** Push the overlay's dismissal back while initial setup work is happening. */
  function noteSetupActivity(extraMs = 0) {
    if (!setupActive) return;
    clearTimeout(setupFinishTimer);
    setupFinishTimer = window.setTimeout(finishSetupIfIdle, SETUP_QUIET_MS + extraMs);
  }

  function finishSetupIfIdle() {
    if (!setupActive) return;

    const timedOut = Date.now() - setupStartedAt > SETUP_MAX_MS;

    // Give the scan + scroll alignment a moment to settle.
    if (!timedOut && (isExpanding || scanTimer || pendingLayoutSettles > 0)) {
      noteSetupActivity();
      return;
    }

    forceFinishSetup();
  }

  function forceFinishSetup() {
    if (!setupActive) return;
    // Bulk-loading a big topic can take longer than the hard cap; keep the bar
    // alive while batches are still arriving (with an absolute overall limit).
    if (isExpanding && Date.now() - setupStartedAt < SETUP_ABSOLUTE_MAX_MS) {
      clearTimeout(setupHardTimer);
      setupHardTimer = window.setTimeout(forceFinishSetup, SETUP_MAX_MS);
      noteSetupActivity();
      return;
    }
    setupActive = false;
    clearTimeout(setupFinishTimer);
    setupFinishTimer = 0;
    clearTimeout(setupHardTimer);
    setupHardTimer = 0;
    hideOverlay();
  }

  function cancelSetup() {
    setupActive = false;
    pendingLayoutSettles = 0;
    clearTimeout(setupFinishTimer);
    setupFinishTimer = 0;
    clearTimeout(setupHardTimer);
    setupHardTimer = 0;
    if (overlayEl) hideOverlay();
  }

  /**
   * Track scroll-alignment retries so the overlay can't disappear while the
   * last layout adjustment is still pending.
   */
  function trackLayoutSettle() {
    if (!setupActive) return null;
    pendingLayoutSettles++;
    noteSetupActivity();

    let done = false;
    return () => {
      if (done) return;
      done = true;
      pendingLayoutSettles = Math.max(0, pendingLayoutSettles - 1);
      noteSetupActivity();
    };
  }

  /**
   * The overlay only says what it is doing. Classroom never tells us how many
   * posts a topic still holds behind "View more", so any number here is a
   * guess — the count was removed rather than kept inaccurate.
   */
  function updateOverlay() {
    if (!overlayEl) return;
    overlayBar.removeAttribute('value'); // stay indeterminate
    const text = overlayEl.querySelector('.cpp-loading-text');
    if (text) text.textContent = 'Loading posts…';
  }

  function hideOverlay() {
    if (!overlayEl) return;
    clearTimeout(overlayHideTimer);
    overlayEl.classList.add('cpp-loading-done');
    overlayEl.classList.remove('cpp-loading-visible');
    // Remove from DOM after fade-out transition (0.4s + 0.1s delay + buffer)
    overlayHideTimer = setTimeout(() => {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; overlayBar = null; overlayLabel = null; }
    }, 650);
  }

  // ── End loading overlay ──────────────────────────────────────────────────

  /** @type {Set<Element>} - Post-list containers currently enhanced. */
  const activeContainers = new Set();
  /** @type {WeakMap<Element, {expanded: boolean, centered: boolean, items: Element[], ui: Element|null, button: Element|null, itemCount: number}>} */
  const stateByContainer = new WeakMap();

  /**
   * Determine if an element represents a Draft post in Google Classroom.
   */
  function isDraftItem(item) {
    if (!item || !item.nodeType) return false;

    // 1. Direct check: element with aria-label="Draft Assignment" or similar
    if (item.querySelector('[aria-label*="Draft" i]')) {
      return true;
    }

    // 2. Check aria-label of the item itself
    const ariaLabel = (item.getAttribute('aria-label') || '').toLowerCase();
    if (/\b(?:draft|brouillon|borrador|entwurf|rascunho|bozza|drafts)\b/i.test(ariaLabel) || ariaLabel.includes('草稿')) {
      return true;
    }

    // 3. Check for draft badge or chip element with exact text "Draft"
    const candidates = item.querySelectorAll('div, span, p, [role="status"]');
    for (const el of candidates) {
      if (el.children.length === 0) {
        const text = el.textContent.trim().toLowerCase();
        if (
          text === 'draft' ||
          text === 'drafts' ||
          text === 'saved as draft' ||
          text.startsWith('draft -') ||
          text === 'brouillon' ||
          text === 'borrador' ||
          text === 'entwurf' ||
          text === 'rascunho' ||
          text === 'bozza' ||
          text === '草稿'
        ) {
          return true;
        }
      }
    }

    // 4. Check for specific draft class names or data attributes
    if (
      (item.matches && item.matches('[class*="draft" i], [data-draft="true"]')) ||
      item.querySelector('[class*="draft" i], [data-draft="true"]')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Find the index of the latest published post (not drafts).
   * In a topic list:
   * Earlier items -> Latest published post -> Upcoming drafts to be edited next.
   * If there are no published posts (all drafts), returns -1 so the topic
   * scrolls to the beginning (scrollTop = 0) to start editing.
   */
  function findLatestPostIndex(items) {
    if (!items || items.length === 0) return -1;

    const publishedIndices = [];
    const draftIndices = [];
    for (let i = 0; i < items.length; i++) {
      if (isDraftItem(items[i])) {
        draftIndices.push(i);
      } else {
        publishedIndices.push(i);
      }
    }

    // If there are no published posts (all drafts), return -1
    // to scroll directly to the beginning (scrollTop = 0)
    if (publishedIndices.length === 0) return -1;

    // If there are drafts, check their placement relative to published posts
    if (draftIndices.length > 0) {
      const firstDraft = draftIndices[0];

      // If drafts are at the top (index 0), e.g. upcoming curriculum planning drafts:
      // The latest published post is the first published post after these top drafts
      if (firstDraft === 0) {
        return publishedIndices[0];
      }

      // If drafts are at the bottom (newly created draft posts placed at bottom by default):
      // The latest published post is the last published post before the drafts
      const beforeDrafts = publishedIndices.filter((idx) => idx < firstDraft);
      if (beforeDrafts.length > 0) {
        return beforeDrafts[beforeDrafts.length - 1];
      }
      return publishedIndices[0];
    }

    // Default / All published posts:
    // In sequence, the latest post is the last published post
    return publishedIndices[publishedIndices.length - 1];
  }

  /**
   * Align the scroll window so that the target post is the 3rd post of 5 visible posts
   * (aligned to the middle of the scroll). Supports both standard and reversed sort orders.
   * If targetIndex is -1 (e.g. topic with all drafts), scrolls directly to the top.
   */
  function alignLatestPostToMiddle(container, items, targetIndex, reversed = false) {
    if (!items || items.length === 0) return;

    markProgrammaticScroll(container, 800);

    // If no published posts (all drafts, targetIndex < 0), scroll to the very top
    if (targetIndex < 0) {
      container.scrollTop = 0;
      return;
    }

    // The 3rd post of 5 visible posts is items[targetIndex].
    // In normal order, top visible item is targetIndex - 2.
    // In reversed order, items are displayed reversed, so top visible item is targetIndex + 2.
    let topIndex;
    if (reversed) {
      topIndex = Math.min(items.length - 1, targetIndex + 2);
    } else {
      topIndex = Math.max(0, targetIndex - 2);
    }

    const topItem = items[topIndex];
    if (!topItem) {
      container.scrollTop = 0;
      return;
    }

    const applyScroll = () => {
      if (!container.isConnected || !topItem.isConnected) return;
      if (topItem.offsetParent === container) {
        container.scrollTop = topItem.offsetTop;
      } else {
        const cRect = container.getBoundingClientRect();
        const iRect = topItem.getBoundingClientRect();
        if (cRect.height === 0 || iRect.height === 0) return;
        const delta = iRect.top - cRect.top;
        container.scrollTop = Math.max(0, Math.round(container.scrollTop + delta));
      }
    };

    const settle = trackLayoutSettle();

    applyScroll();
    requestAnimationFrame(() => {
      applyScroll();
      setTimeout(applyScroll, 80);
      setTimeout(applyScroll, 200);
    });
    // Keep the overlay up until the final late-layout adjustment has run.
    setTimeout(() => {
      applyScroll();
      if (settle) settle();
    }, 500);
  }

  /**
   * Resolved pathname of an anchor's href.
   */
  function linkPath(a) {
    const raw = a.getAttribute('href');
    if (!raw || /^(?:javascript|mailto|tel|sms|#)/i.test(raw.trim())) return '';
    try {
      return new URL(raw, location.href).pathname;
    } catch (_) {
      return '';
    }
  }

  /**
   * Multi-strategy collection of Topic containers and their post lists:
   * Strategy 1 (Native Classroom): Outermost [data-topic-id] sections and their <ol> post lists.
   * Strategy 2 (Heading-based): <h2> topic headings and their associated post lists.
   * Strategy 3 (Role/Tag): <ol> or [role="list"] with [data-stream-item-id] or [role="listitem"].
   * Strategy 4 (Fallback): Work links matching assignment paths.
   */
  function collectGroups(main) {
    const groups = new Map();
    const seenContainers = new Set();

    // Strategy 1: Google Classroom native [data-topic-id]
    // Filter strictly to outermost topic containers only, excluding menus or nested elements
    const topicNodes = Array.from(main.querySelectorAll('[data-topic-id]')).filter((node) => {
      if (node.closest(SKIP_ANCESTOR_SELECTOR)) return false;
      if (node.parentElement && node.parentElement.closest('[data-topic-id]')) return false;
      return true;
    });

    for (const topicNode of topicNodes) {
      // Find the posts container: ol[jsname="bN97Pc"], ol.Xzp3fc, or ol
      let list = topicNode.querySelector('ol[jsname="bN97Pc"], ol.Xzp3fc, ol');
      if (!list) {
        list = topicNode.querySelector('ol, [role="list"]:not([role="menu"]):not([role="listbox"])');
      }
      if (!list) {
        // Look for element following the topic header
        const header = topicNode.querySelector('[jsname="K3jAGe"], .jLMcgc') || topicNode.firstElementChild;
        if (header && header.nextElementSibling) {
          list = header.nextElementSibling.matches('ol, ul, [role="list"]')
            ? header.nextElementSibling
            : header.nextElementSibling.querySelector('ol, ul, [role="list"]');
        }
      }

      if (list && !seenContainers.has(list)) {
        if (list.closest(SKIP_ANCESTOR_SELECTOR) || list.getAttribute('role') === 'menu') {
          continue;
        }

        // Only count direct LI children if it's an OL/UL, avoiding duplicate child tags
        let items = Array.from(list.children).filter(
          (c) => (c.tagName === 'LI' || c.getAttribute('role') === 'listitem') && !c.classList.contains(CLASS.ui)
        );

        if (items.length === 0) {
          items = Array.from(list.children).filter(
            (c) =>
              !c.classList.contains(CLASS.ui) &&
              !c.classList.contains(CLASS.controls) &&
              c.getBoundingClientRect().height > 10
          );
        }

        if (items.length > 0) {
          seenContainers.add(list);
          groups.set(list, items);
        }
      }
    }

    // Strategy 2: Heading-based (h2 in main)
    const headings = Array.from(main.querySelectorAll('h2, [role="heading"][aria-level="2"]')).filter(
      (h2) => !h2.closest(SKIP_ANCESTOR_SELECTOR)
    );

    for (const h2 of headings) {
      const topicSection =
        h2.closest('[data-topic-id], section, [aria-label*="Topic" i], [role="region"]') ||
        h2.parentElement;
      if (!topicSection || topicSection === main) continue;

      let list = topicSection.querySelector('ol[jsname="bN97Pc"], ol.Xzp3fc, ol');
      if (!list) {
        let sibling = (h2.closest('div') || h2).nextElementSibling;
        while (sibling) {
          if (
            sibling.matches &&
            (sibling.matches('ol, [role="list"]:not([role="menu"])') ||
              sibling.querySelector('ol, [role="list"]:not([role="menu"])'))
          ) {
            list = sibling.matches('ol, [role="list"]')
              ? sibling
              : sibling.querySelector('ol, [role="list"]');
            break;
          }
          sibling = sibling.nextElementSibling;
        }
      }

      if (list && !seenContainers.has(list)) {
        if (list.closest(SKIP_ANCESTOR_SELECTOR) || list.getAttribute('role') === 'menu') continue;

        let items = Array.from(list.children).filter(
          (c) => (c.tagName === 'LI' || c.getAttribute('role') === 'listitem') && !c.classList.contains(CLASS.ui)
        );
        if (items.length === 0) {
          items = Array.from(list.children).filter(
            (c) =>
              !c.classList.contains(CLASS.ui) &&
              !c.classList.contains(CLASS.controls) &&
              c.getBoundingClientRect().height > 10
          );
        }
        if (items.length > 0) {
          seenContainers.add(list);
          groups.set(list, items);
        }
      }
    }

    // Strategy 3: Any ol or [role="list"] containing items (excluding menus)
    const roleLists = Array.from(main.querySelectorAll('ol, [role="list"]')).filter(
      (l) => !seenContainers.has(l) && !l.closest(SKIP_ANCESTOR_SELECTOR) && l.getAttribute('role') !== 'menu'
    );
    for (const list of roleLists) {
      const items = Array.from(list.children).filter(
        (child) =>
          (child.tagName === 'LI' ||
            (child.matches && child.matches('[role="listitem"]')) ||
            child.querySelector('[role="listitem"]')) &&
          !child.classList.contains(CLASS.ui)
      );
      if (items.length >= 2) {
        seenContainers.add(list);
        groups.set(list, items);
      }
    }

    // Strategy 4: Link-based fallback (anchors with coursework paths)
    const allLinks = Array.from(main.querySelectorAll('a[href]')).filter(
      (a) => !a.closest(SKIP_ANCESTOR_SELECTOR) && WORK_LINK_RE.test(linkPath(a))
    );

    if (allLinks.length > 0) {
      const roots = new Set();
      for (const link of allLinks) {
        const roleItem = link.closest(ROLE_ITEM_SELECTOR);
        if (roleItem && main.contains(roleItem)) {
          roots.add(roleItem);
          continue;
        }
        let node = link;
        while (node.parentElement && node.parentElement !== main && node.parentElement !== document.body) {
          const parent = node.parentElement;
          const otherLinks = allLinks.filter((l) => parent.contains(l) && !node.contains(l));
          if (otherLinks.length > 0) break;
          node = parent;
        }
        if (node && node !== main) roots.add(node);
      }

      const rootList = Array.from(roots).filter(
        (r) => !Array.from(roots).some((o) => o !== r && o.contains(r))
      );

      for (const root of rootList) {
        const container = root.parentElement;
        if (!container || seenContainers.has(container)) continue;
        if (!groups.has(container)) groups.set(container, []);
        groups.get(container).push(root);
      }
    }

    return groups;
  }

  function shouldHandle(container, items) {
    if (container === document.body || container === document.documentElement) return false;
    if (!container.isConnected) return false;
    if (container.closest(SKIP_ANCESTOR_SELECTOR)) return false;
    if (items.length >= CONFIG.minPostsToWindow) return true;
    // Truncated topics (Google still holds unloaded posts behind "View more")
    // are enhanced even while small, so scrolling them loads the next batch
    // lazily instead of waiting for a manual "View more" click.
    try {
      if (findViewMoreForContainer(container)) return true;
    } catch (_) {}
    return false;
  }

  function gapBetween(items) {
    if (items.length >= 2) {
      try {
        const style = getComputedStyle(items[0].parentElement);
        const rowGap = parseFloat(style.rowGap || '');
        if (!Number.isNaN(rowGap) && rowGap > 0) return rowGap;
      } catch (_) {
        // fall through to bounding rects
      }
      const a = items[0].getBoundingClientRect();
      const b = items[1].getBoundingClientRect();
      return Math.max(0, b.top - a.bottom);
    }
    return 0;
  }

  /** Measure the collapsed window height so 5 posts fit exactly. */
  function measureWindow(items) {
    const sample = items.slice(0, CONFIG.visiblePosts);
    let heights = sample.map((el) => el.getBoundingClientRect().height);
    const validHeights = heights.filter((h) => h > 0);
    const fallbackHeight = validHeights.length > 0
      ? validHeights.reduce((sum, h) => sum + h, 0) / validHeights.length
      : 66;

    heights = heights.map((h) => (h > 0 ? h : fallbackHeight));
    const gap = gapBetween(items);
    const contentHeight = heights.reduce((sum, h) => sum + h, 0) + gap * (heights.length - 1);
    if (!(contentHeight > 40)) return null;
    return {
      windowHeight: Math.round(contentHeight),
      avgHeight: contentHeight / heights.length,
      gap,
    };
  }

  function getControlsAnchor(container) {
    const dragCtrl = container.closest('[jscontroller="CJc2td"], [data-drag-list-group-key]');
    if (dragCtrl) {
      const next = dragCtrl.nextElementSibling;
      if (next && next.classList.contains('Mvr5Ef')) {
        return next;
      }
      return dragCtrl;
    }
    return container;
  }

  function ensureControls(container, st) {
    let ui = st.ui;
    if (!ui) {
      ui = document.createElement('div');
      ui.className = `${CLASS.ui} ${CLASS.controls}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = CLASS.toggle;
      button.addEventListener('click', () => {
        const state = stateByContainer.get(container);
        if (!state) return;
        const wasExpanded = state.expanded;
        // Where the button sits on screen right now. Collapsing shrinks the
        // scroll window, which drags the button (and the page below it) up.
        const anchorY = button.getBoundingClientRect().top;
        setExpanded(container, state, !wasExpanded);
        if (wasExpanded) lockPageToToggle(container, anchorY);
      });

      const textSpan = document.createElement('span');
      textSpan.className = CLASS.toggleText;
      button.appendChild(textSpan);

      const iconWrap = document.createElement('span');
      iconWrap.innerHTML = CHEVRON_SVG;
      button.appendChild(iconWrap.firstElementChild);

      ui.appendChild(button);
      st.ui = ui;
      st.button = button;
    }

    const anchor = getControlsAnchor(container);
    if (!ui.isConnected || ui.previousElementSibling !== anchor) {
      anchor.insertAdjacentElement('afterend', ui);
    }

    // Toggle label: "View all" to expand, "View fewer" to collapse.
    const textLabel = st.expanded ? 'View fewer' : `View all (${st.itemCount})`;
    const textSpan = st.button.querySelector(`.${CLASS.toggleText}`);
    if (textSpan && textSpan.textContent !== textLabel) {
      textSpan.textContent = textLabel;
    }
    st.button.setAttribute('aria-expanded', String(st.expanded));
    st.button.setAttribute(
      'aria-label',
      st.expanded ? 'View fewer posts' : `View all ${st.itemCount} posts`
    );
  }

  /**
   * Collapsing a topic shrinks its scroll window by thousands of pixels, which
   * yanks the toggle button and everything under it up the page, leaving the
   * user somewhere near the bottom. Re-anchor the window scroll so the button
   * the user just clicked stays exactly where it was on screen.
   */
  function lockPageToToggle(container, anchorY) {
    const st = stateByContainer.get(container);
    const button = st && st.button;
    if (!button) return;

    // Our own last scroll position. If the page moved by anything else (the
    // user scrolled), stop fighting them.
    let expectedY = null;
    const adjust = () => {
      if (!button.isConnected) return;
      if (expectedY !== null && Math.abs(window.scrollY - expectedY) > 2) return;
      const delta = button.getBoundingClientRect().top - anchorY;
      if (Math.abs(delta) >= 1) {
        window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' });
      }
      expectedY = window.scrollY;
    };

    // The height change lands synchronously, but Classroom's own layout can
    // settle a frame or two later, so re-anchor a few times.
    adjust();
    requestAnimationFrame(adjust);
    setTimeout(adjust, 80);
    setTimeout(adjust, 240);
  }

  function setExpanded(container, st, expanded) {
    if (st.expanded === expanded) return;
    st.expanded = expanded;
    if (!expanded) {
      container.classList.remove(CLASS.expanded);
      st.centered = false; // re-align to the latest post in the middle
      if (st.items && st.items.length) applyWindow(container, st.items);
    } else {
      container.classList.add(CLASS.expanded);
      markProgrammaticScroll(container, 250);
      container.scrollTop = 0;
      ensureControls(container, st);
    }
  }

  function teardown(container) {
    container.classList.remove(CLASS.window, CLASS.expanded);
    for (const prop of Object.values(VARS)) container.style.removeProperty(prop);
    const topicNode = topicNodeForContainer(container);
    if (topicNode) {
      for (const btn of topicNode.querySelectorAll('.cpp-native-view-more')) {
        btn.classList.remove('cpp-native-view-more');
      }
    }
    if (openTopicMenu && container.contains(openTopicMenu.anchor)) closeTopicMenu();
    for (const el of container.querySelectorAll(`.${CLASS.moveControls}`)) el.remove();
    for (const el of container.querySelectorAll(`.${CLASS.moveHost}`)) {
      el.classList.remove(CLASS.moveHost, CLASS.moveActive);
    }
    const st = stateByContainer.get(container);
    if (st && st.ui) st.ui.remove();
    if (st && st.heightObserver) st.heightObserver.disconnect();
    stateByContainer.delete(container);
    activeContainers.delete(container);
  }

  function applyWindow(container, items) {
    const rect = container.getBoundingClientRect();
    let st = stateByContainer.get(container);
    if (!st) {
      st = {
        expanded: false,
        centered: false,
        items: [],
        ui: null,
        button: null,
        itemCount: 0,
        /** Height currently applied to the scroll window. */
        windowHeight: 0,
        /** Height the 5-post window naturally needs (post expansion grows past it). */
        baseWindowHeight: 0,
        /** Natural height of each post at the time the window was measured. */
        baseItemHeights: null,
        /** Items currently watched for size changes by the height observer. */
        observedItems: null,
        heightObserver: null,
        heightSyncScheduled: false,
      };
      stateByContainer.set(container, st);
    }

    // Check if topic is collapsed by Google's native accordion or hidden
    const topicNode = container.closest('[data-topic-id]');
    const accordionBtn = topicNode ? topicNode.querySelector('button[jsname="ix0Hvc"]') : null;
    const isTopicCollapsed =
      (accordionBtn && accordionBtn.getAttribute('aria-expanded') === 'false') ||
      rect.width === 0 ||
      rect.height === 0;

    if (isTopicCollapsed) {
      if (st.ui) st.ui.style.display = 'none';
      return;
    }
    if (st.ui && st.ui.style.display === 'none') {
      st.ui.style.display = '';
    }

    const countChanged = st.itemCount !== items.length;
    st.items = items;
    st.itemCount = items.length;

    // Every post in a managed topic gets the hover overlay; posts in the short
    // topics get theirs from applyMoveControls() during the scan.
    for (const item of items) ensureMoveControls(item);

    const previousScroll = container.scrollTop;
    const metrics = measureWindow(items);
    if (!metrics) {
      log('could not measure posts yet');
      return;
    }

    if (countChanged || !st.windowHeight) {
      st.baseWindowHeight = metrics.windowHeight;
      st.baseItemHeights = measureItemHeights(items);
      st.windowHeight = metrics.windowHeight;
    }

    container.classList.add(CLASS.window);
    container.classList.toggle(CLASS.expanded, st.expanded);
    container.style.setProperty(VARS.height, `${Math.round(st.windowHeight)}px`);

    // If the user expands a post inline (e.g. to edit it), grow the window by
    // the same amount so the whole post stays visible.
    observeWindowHeights(container, st, items);
    watchInlineExpansion(container);
    syncWindowHeight(container);

    // Hide this topic's native View more; the bulk loader handles it.
    hideViewMoreForContainer(container);

    const latestIndex = findLatestPostIndex(items);

    // Apply sort order (normal or reversed)
    applySortOrderToContainer(container, items, isReversed);

    // Setup drag auto-scroll
    setupDragAndDrop(container);

    ensureControls(container, st);
    syncMoveControls(container);

    if (st.expanded) return;

    if (!st.centered || countChanged) {
      alignLatestPostToMiddle(container, items, latestIndex, isReversed);
      st.centered = true;
    } else if (container.scrollTop !== previousScroll) {
      // Only restore when the position actually drifted (e.g. posts
      // re-rendered).
      markProgrammaticScroll(container, 150);
      container.scrollTop = previousScroll;
    }
  }

  // --- Scroll window height follows inline post expansion ---

  function measureItemHeights(items) {
    const heights = new Map();
    for (const item of items) heights.set(item, item.getBoundingClientRect().height);
    return heights;
  }

  /**
   * Watch every post in the topic so an inline expansion can be noticed even
   * when it happens without a click we see (e.g. restored edit state).
   */
  function observeWindowHeights(container, st, items) {
    if (typeof ResizeObserver === 'undefined') return;

    if (!st.heightObserver) {
      st.heightObserver = new ResizeObserver(() => scheduleWindowHeightSync(container));
    }
    const ro = st.heightObserver;
    if (st.observedItems) {
      for (const el of st.observedItems) ro.unobserve(el);
    }
    for (const el of items) ro.observe(el);
    st.observedItems = items;
  }

  /**
   * A post expands when the user clicks it (or presses Enter). ResizeObserver
   * covers the layout change, but it is not delivered in every rendering
   * environment, so re-measure shortly after any interaction as well.
   */
  function watchInlineExpansion(container) {
    if (container._cppHeightWatch) return;
    container._cppHeightWatch = true;

    const remeasure = () => syncWindowHeight(container);
    const kick = () => {
      remeasure();
      setTimeout(remeasure, 80);
      setTimeout(remeasure, 250);
      setTimeout(remeasure, 600);
    };

    container.addEventListener('click', kick, true);
    container.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter' || e.key === ' ') kick();
      },
      true
    );
  }

  function scheduleWindowHeightSync(container) {
    const st = stateByContainer.get(container);
    if (!st || st.heightSyncScheduled) return;
    st.heightSyncScheduled = true;
    const run = () => syncWindowHeight(container);
    requestAnimationFrame(run);
    setTimeout(run, 60);
  }

  function syncWindowHeight(container) {
    const st = stateByContainer.get(container);
    if (!st) return;
    st.heightSyncScheduled = false;
    if (st.expanded || !st.items || !st.windowHeight || !st.baseItemHeights || !st.baseWindowHeight) {
      return;
    }

    // Grow by however much the posts currently exceed their natural height,
    // so an expanded post is fully visible and a collapsed one gives the
    // space back.
    let growth = 0;
    for (const [item, height] of measureItemHeights(st.items)) {
      const base = st.baseItemHeights.get(item);
      if (typeof base === 'number' && height > base + 0.5) growth += height - base;
    }

    const target = st.baseWindowHeight + growth;
    if (Math.abs(target - st.windowHeight) < 0.5) return;

    st.windowHeight = target;
    container.style.setProperty(VARS.height, `${Math.round(target)}px`);
  }

  // --- Drag & Drop Enhancements ---

  let isDragging = false;
  let potentialDrag = null;
  let activeDragScrollSpeed = 0;
  let activeDragScrollTimer = null;
  let activeScrollWindow = null;
  let windowScrollSpeed = 0;

  function startCombinedAutoScroll() {
    if (!activeDragScrollTimer) {
      const step = () => {
        if (isDragging && (activeDragScrollSpeed !== 0 || windowScrollSpeed !== 0)) {
          if (activeScrollWindow && activeDragScrollSpeed !== 0) {
            activeScrollWindow.scrollTop += activeDragScrollSpeed;
          }
          if (windowScrollSpeed !== 0) {
            window.scrollBy(0, windowScrollSpeed);
          }
          activeDragScrollTimer = requestAnimationFrame(step);
        } else {
          stopDragAutoScroll();
        }
      };
      activeDragScrollTimer = requestAnimationFrame(step);
    }
  }

  function stopDragAutoScroll() {
    if (activeDragScrollTimer) {
      cancelAnimationFrame(activeDragScrollTimer);
      activeDragScrollTimer = null;
    }
    activeScrollWindow = null;
    activeDragScrollSpeed = 0;
    windowScrollSpeed = 0;
  }

  function handleDragAutoScroll(x, y) {
    // 1. Viewport top / bottom page-level scrolling (so user can drag across topics)
    const vpHeight = window.innerHeight;
    const vpTopZone = 60;
    const vpBottomZone = vpHeight - 60;

    let pageSpeed = 0;
    if (y < vpTopZone && y >= 0) {
      pageSpeed = -Math.round(Math.max(5, (vpTopZone - y) / 3));
    } else if (y > vpBottomZone && y <= vpHeight) {
      pageSpeed = Math.round(Math.max(5, (y - vpBottomZone) / 3));
    }

    // 2. Check if cursor is over any topic scroll window
    let hoveredWindow = null;
    const scrollWindows = document.querySelectorAll(`.${CLASS.window}`);
    for (const win of scrollWindows) {
      const rect = win.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        hoveredWindow = win;
        break;
      }
    }

    let topicSpeed = 0;
    if (hoveredWindow) {
      const r = hoveredWindow.getBoundingClientRect();
      const topZone = r.top + 50;
      const bottomZone = r.bottom - 50;

      if (y < topZone) {
        const intensity = Math.max(0.2, (topZone - y) / 50);
        topicSpeed = -Math.round(intensity * 18);
      } else if (y > bottomZone) {
        const intensity = Math.max(0.2, (y - bottomZone) / 50);
        topicSpeed = Math.round(intensity * 18);
      }
    }

    if (pageSpeed !== 0 || topicSpeed !== 0) {
      activeDragScrollSpeed = topicSpeed;
      activeScrollWindow = hoveredWindow;
      windowScrollSpeed = pageSpeed;
      startCombinedAutoScroll();
    } else {
      stopDragAutoScroll();
    }
  }

  /**
   * A drag should be able to reach any post in the topic, not just the five in
   * the collapsed window, so starting one opens the topic to "View all".
   *
   * Expanding lays the list out from the topic's top, which would otherwise
   * yank the grabbed post out from under the cursor. The page is re-anchored
   * so the exact point of the post the user grabbed stays under the cursor.
   */
  function expandTopicForDrag(item, clientY) {
    const container = item.closest(`.${CLASS.window}`);
    if (!container) return;
    const st = stateByContainer.get(container);
    if (!st || st.expanded) return;

    // Where the cursor sits inside the post, measured before the layout moves.
    const grabOffsetY = clientY - item.getBoundingClientRect().top;

    setExpanded(container, st, true);

    // Re-anchor a few times: the height change lands synchronously, but
    // Classroom's own layout can settle a frame or two later.
    let expectedY = null;
    const adjust = () => {
      if (!item.isConnected || !container.classList.contains(CLASS.expanded)) return;
      // Our own last scroll position. If the page moved by anything else (the
      // user scrolled), stop fighting them.
      if (expectedY !== null && Math.abs(window.scrollY - expectedY) > 2) return;
      const delta = item.getBoundingClientRect().top + grabOffsetY - clientY;
      if (Math.abs(delta) >= 1) {
        window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' });
      }
      expectedY = window.scrollY;
    };

    adjust();
    requestAnimationFrame(adjust);
    setTimeout(adjust, 80);
    setTimeout(adjust, 240);
  }

  function setupGlobalDragHandlers() {
    if (window._cppGlobalDragAttached) return;
    window._cppGlobalDragAttached = true;

    // Track mousedown on post cards or drag handles (Google Classroom uses mousedown:RlITDf on div.jWCzBe)
    document.addEventListener(
      'mousedown',
      (e) => {
        if (e.button !== 0) return;
        const target = e.target;
        // Do not block post card itself (Google Classroom assigns role="button" to post rows)
        if (target.closest('button, a, input, textarea, select, [role="menuitem"], .cpp-ui, [data-is-tooltip-wrapper="true"]')) {
          return;
        }

        const item = target.closest('li[data-stream-item-id], [data-stream-item-id], li.tfGBod, [role="listitem"]');
        if (item) {
          potentialDrag = {
            startX: e.clientX,
            startY: e.clientY,
            item,
          };
        }
      },
      true
    );

    document.addEventListener(
      'mousemove',
      (e) => {
        if (!potentialDrag) return;

        if (!isDragging) {
          const dx = e.clientX - potentialDrag.startX;
          const dy = e.clientY - potentialDrag.startY;
          if (Math.hypot(dx, dy) > 5) {
            isDragging = true;
            document.body.classList.add('cpp-dragging-active');
            log('Post drag started');
            // Open the topic to every post as soon as the drag really starts.
            expandTopicForDrag(potentialDrag.item, e.clientY);
          }
        }

        if (isDragging) {
          handleDragAutoScroll(e.clientX, e.clientY);
        }
      },
      true
    );

    const finishDrag = () => {
      if (!potentialDrag && !isDragging) return;
      potentialDrag = null;

      if (isDragging) {
        log('Post drag ended');
        stopDragAutoScroll();

        // Let Google Classroom's drop handler and DOM mutation settle before re-scanning
        setTimeout(() => {
          isDragging = false;
          document.body.classList.remove('cpp-dragging-active');
          scheduleScan(80);
        }, 300);
      }
    };

    document.addEventListener('mouseup', finishDrag, true);
    document.addEventListener('pointerup', finishDrag, true);
    document.addEventListener('dragend', finishDrag, true);
  }

  function setupDragAndDrop(container) {
    if (container._cppDragAttached) return;
    container._cppDragAttached = true;

    // Standard HTML5 drag support (fallback/fixtures)
    container.addEventListener('dragover', (e) => {
      const rect = container.getBoundingClientRect();
      const y = e.clientY;
      const topZone = rect.top + 55;
      const bottomZone = rect.bottom - 55;

      if (y < topZone) {
        const intensity = Math.max(0.2, (topZone - y) / 55);
        activeDragScrollSpeed = -Math.round(intensity * 18);
        activeScrollWindow = container;
        startCombinedAutoScroll();
      } else if (y > bottomZone) {
        const intensity = Math.max(0.2, (y - bottomZone) / 55);
        activeDragScrollSpeed = Math.round(intensity * 18);
        activeScrollWindow = container;
        startCombinedAutoScroll();
      } else {
        stopDragAutoScroll();
      }
    });

    container.addEventListener('dragleave', (e) => {
      if (!container.contains(e.relatedTarget)) {
        stopDragAutoScroll();
      }
    });

    container.addEventListener('drop', () => {
      stopDragAutoScroll();
    });
  }

  // --- Per-post move controls (up / topic / down) ---
  //
  // Dragging a post is fiddly, so every post on the Classwork page carries a small
  // overlay that fades in while the post is hovered or focused: an up arrow, a
  // dot that opens the topic picker, and a down arrow. A move happens inside the
  // topic's own post list, one step through the order the user sees — with
  // Reverse order on, "up" is one step earlier on screen.

  /**
   * Every post list this page has, managed or not, so the arrows also work in
   * topics that are too small to need a scroll window.
   */
  let postLists = new Map();

  /**
   * Topic lists seen with posts in them at some point. collectGroups() drops a
   * list the moment it is empty, which used to make the topic vanish from the
   * picker as soon as its last post was moved out.
   */
  let knownTopicLists = new Set();

  /** The post list a post currently lives in, if any. */
  function postListForItem(item) {
    const parent = item && item.parentElement;
    if (!parent) return null;
    if (stateByContainer.has(parent) || postLists.has(parent)) return parent;
    for (const container of activeContainers) {
      if (container.contains(item)) return container;
    }
    for (const container of postLists.keys()) {
      if (container.contains(item)) return container;
    }
    return null;
  }

  /** The posts of a list in DOM order; our own chrome is never a post. */
  function containerItems(container) {
    return Array.from(container.children).filter(
      (child) => !child.classList.contains(CLASS.ui)
    );
  }

  /** The post whose controls are on screen, so they can follow it when it moves. */
  let hoveredMoveItem = null;
  /** Where the pointer was last seen, used to prove a post is still hovered. */
  let pointerPos = null;

  /**
   * Place a post's controls beside it.
   *
   * The controls are position: fixed so a topic's scroll window can never clip
   * them and they never take part in layout: they are placed here, in the empty
   * space left of the post's own box, and follow a post that scrolls. The dot
   * ends up on the post header's vertical midpoint.
   */
  function positionMoveControls(item, controls) {
    const box = item.getBoundingClientRect();
    if (!box.width && !box.height) return;
    const width = controls.offsetWidth || 28;
    controls.style.left = `${box.left - width}px`;
    controls.style.top = `${box.top + MOVE_TOP}px`;
  }

  function activateMoveControls(item, controls) {
    hoveredMoveItem = item;
    item.classList.add(CLASS.moveActive);
    positionMoveControls(item, controls);
  }

  function deactivateMoveControls(item) {
    if (!item) return;
    item.classList.remove(CLASS.moveActive);
    if (hoveredMoveItem === item) hoveredMoveItem = null;
  }

  function pointInBox(box) {
    return (
      !!pointerPos &&
      pointerPos.x >= box.left &&
      pointerPos.x <= box.right &&
      pointerPos.y >= box.top &&
      pointerPos.y <= box.bottom
    );
  }

  /**
   * Hide the controls unless the pointer is really still on the post (or on the
   * overlay itself).
   *
   * CSS :hover is not enough: Chrome keeps a stale hover state through a click,
   * an inline expansion or a scroll, which left the overlay stuck on screen
   * after a post was clicked. The pointer position is checked instead, whenever
   * anything may have moved underneath it.
   */
  function verifyHoveredMoveItem() {
    const item = hoveredMoveItem;
    if (!item) return;
    const controls = moveControlsFor(item);
    if (!item.isConnected || !controls) {
      deactivateMoveControls(item);
      return;
    }
    const onPost = pointInBox(item.getBoundingClientRect());
    const onOverlay = pointInBox(controls.getBoundingClientRect());
    if (!onPost && !onOverlay) {
      deactivateMoveControls(item);
      return;
    }
    positionMoveControls(item, controls);
  }

  document.addEventListener(
    'pointermove',
    (e) => {
      pointerPos = { x: e.clientX, y: e.clientY };
    },
    true
  );
  // A click can expand a post or scroll the page, after which Chrome does not
  // always refresh :hover: re-check once the click has been handled.
  document.addEventListener(
    'pointerdown',
    () => {
      setTimeout(verifyHoveredMoveItem, 0);
      setTimeout(verifyHoveredMoveItem, 260);
    },
    true
  );
  window.addEventListener('scroll', verifyHoveredMoveItem, true);
  window.addEventListener('resize', verifyHoveredMoveItem);
  window.addEventListener('blur', () => deactivateMoveControls(hoveredMoveItem));
  document.addEventListener('pointerleave', () => deactivateMoveControls(hoveredMoveItem));

  function moveControlsFor(item) {
    for (const child of item.children) {
      if (child.classList.contains(CLASS.moveControls)) return child;
    }
    return null;
  }

  function ensureMoveControls(item) {
    if (moveControlsFor(item)) return;

    // Nothing about the post's own box is touched: the overlay is fixed and
    // placed beside it, so the page's CSS layout stays exactly as Classroom
    // built it (no containing block, padding or position changes).
    item.classList.add(CLASS.moveHost);

    const controls = document.createElement('div');
    controls.className = `${CLASS.ui} ${CLASS.moveControls}`;
    controls.style.setProperty('--cpp-theme', courseThemeColor());
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Move this post');
    // Keep the overlay out of Classroom's (and our own) drag gesture.
    controls.addEventListener('mousedown', (e) => e.stopPropagation());

    const up = document.createElement('button');
    up.type = 'button';
    up.className = `${CLASS.moveBtn} ${CLASS.moveUp}`;
    up.innerHTML = MOVE_ICON.up;
    up.setAttribute('aria-label', 'Move post up');
    up.title = 'Move up';
    up.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      movePostByOne(item, -1);
    });

    const topic = document.createElement('button');
    topic.type = 'button';
    topic.className = `${CLASS.moveBtn} ${CLASS.moveTopic}`;
    topic.innerHTML = MOVE_ICON.dot;
    topic.setAttribute('aria-label', 'Move post to another topic');
    topic.setAttribute('aria-haspopup', 'menu');
    topic.setAttribute('aria-expanded', 'false');
    topic.title = 'Move to topic';
    topic.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTopicMenu(item, topic);
    });

    const down = document.createElement('button');
    down.type = 'button';
    down.className = `${CLASS.moveBtn} ${CLASS.moveDown}`;
    down.innerHTML = MOVE_ICON.down;
    down.setAttribute('aria-label', 'Move post down');
    down.title = 'Move down';
    down.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      movePostByOne(item, 1);
    });

    controls.appendChild(up);
    controls.appendChild(topic);
    controls.appendChild(down);
    item.appendChild(controls);

    positionMoveControls(item, controls);
    item.addEventListener('pointerenter', (e) => {
      // A drag whose mouseup never arrived (the button was released outside the
      // page) would otherwise keep every overlay suppressed for good.
      if (!e.buttons) document.body.classList.remove('cpp-dragging-active');
      pointerPos = { x: e.clientX, y: e.clientY };
      activateMoveControls(item, controls);
    });
    item.addEventListener('pointerleave', () => deactivateMoveControls(item));
    // Keyboard users reach the controls by tabbing; keep the overlay beside the
    // post while focus is inside it.
    controls.addEventListener('focusin', () => positionMoveControls(item, controls));
  }

  function removeMoveControls(item) {
    const controls = moveControlsFor(item);
    if (controls) controls.remove();
    item.classList.remove(CLASS.moveHost, CLASS.moveActive);
    if (hoveredMoveItem === item) hoveredMoveItem = null;
  }

  /** Drop overlays left on posts that no longer belong to a known post list. */
  function pruneMoveControls() {
    for (const controls of document.querySelectorAll(`.${CLASS.moveControls}`)) {
      const post = controls.parentElement;
      if (post && post.parentElement && postLists.has(post.parentElement)) continue;
      if (post) removeMoveControls(post);
      else controls.remove();
    }
  }

  /** Remove every overlay on the page: leaving Classwork, or switching it off. */
  function removeAllMoveControls() {
    for (const el of document.querySelectorAll(`.${CLASS.moveControls}`)) el.remove();
    for (const el of document.querySelectorAll(`.${CLASS.moveHost}`)) {
      el.classList.remove(CLASS.moveHost, CLASS.moveActive);
    }
    hoveredMoveItem = null;
    postLists = new Map();
    knownTopicLists = new Set();
  }

  /** Give every visible post its overlay, and keep the arrows in sync. */
  function applyMoveControls(groups) {
    postLists = new Map();
    for (const [container, items] of groups) {
      const live = containerItems(container);
      if (!live.length) continue;
      knownTopicLists.add(container);
      postLists.set(container, live);
      // A collapsed or parked topic has no box on screen: it gets its overlays
      // once it is visible again, so nothing is added to a hidden copy.
      if (!container.getClientRects().length) continue;
      for (const item of live) ensureMoveControls(item);
    }
    for (const container of Array.from(knownTopicLists)) {
      if (!container.isConnected) knownTopicLists.delete(container);
    }
    pruneMoveControls();
    for (const container of postLists.keys()) syncMoveControls(container);
  }

  /**
   * The arrows wrap, so both stay usable whenever a topic has something to
   * move; only a lone post has nowhere to go.
   */
  function syncMoveControls(container) {
    const color = courseThemeColor();
    const movable = containerItems(container).length > 1;
    for (const controls of container.querySelectorAll(`.${CLASS.moveControls}`)) {
      controls.style.setProperty('--cpp-theme', color);
      const up = controls.querySelector(`.${CLASS.moveUp}`);
      const down = controls.querySelector(`.${CLASS.moveDown}`);
      if (up) up.disabled = !movable;
      if (down) down.disabled = !movable;
    }
  }

  /** Re-apply everything that depends on the order of a topic's posts. */
  function afterPostMove(container) {
    const st = stateByContainer.get(container);
    const items = containerItems(container);
    if (st) {
      st.items = items;
      st.itemCount = items.length;
      // Let the next scan re-measure the window: the posts may differ in height.
      st.windowHeight = 0;
      applySortOrderToContainer(container, items, isReversed);
      observeWindowHeights(container, st, items);
      if (st.ui) ensureControls(container, st);
    }
    syncMoveControls(container);
    // The post just jumped, so the overlay's spot moved with it.
    verifyHoveredMoveItem();
    scheduleScan(120);
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  }

  /** Where every post in a topic sits right now, for the slide animation. */
  function postRects(container) {
    const rects = new Map();
    for (const el of containerItems(container)) rects.set(el, el.getBoundingClientRect());
    return rects;
  }

  /**
   * Slide every post from where it was to where it is now (FLIP).
   *
   * A post that wrapped around the end of the topic is faded back in from the
   * direction it was heading: gliding it across the whole list would look like
   * a glitch and pull the eye away from the post that actually moved.
   */
  function animatePostMove(container, item, before, after, wrapped, delta) {
    if (prefersReducedMotion()) return;
    const timing = { duration: MOVE_ANIM_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' };
    for (const el of containerItems(container)) {
      const from = before.get(el);
      const to = after.get(el);
      if (!from || !to) continue;
      if (el === item && wrapped) {
        // Down wraps to the top, so it re-enters from above, and vice versa.
        const enterFrom = delta > 0 ? -20 : 20;
        el.animate(
          [
            { opacity: 0, transform: `translateY(${enterFrom}px) scale(0.97)` },
            { opacity: 1, transform: 'none' },
          ],
          timing
        );
        continue;
      }
      const dy = from.top - to.top;
      if (Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], timing);
    }
  }

  /**
   * Move a post one step through the order shown: -1 up, +1 down.
   *
   * The ends wrap, so the down arrow on the last post sends it to the top of
   * the topic and the up arrow on the first sends it to the bottom.
   */
  function movePostByOne(item, delta) {
    const container = postListForItem(item);
    if (!container || !delta) return;
    const items = containerItems(container);
    if (items.length < 2) return;
    const visual = isReversed ? items.slice().reverse() : items;
    const index = visual.indexOf(item);
    if (index < 0) return;

    let target = index + delta;
    const wrapped = target < 0 || target >= visual.length;
    if (target < 0) target = visual.length - 1;
    else if (target >= visual.length) target = 0;
    const anchor = visual[target];
    if (!anchor || anchor === item) return;

    // Reverse order is a CSS `order` flip, so "next on screen" is "earlier in
    // the DOM" while it is on.
    const towardsStart = target < index;
    const insertBeforeAnchor = isReversed ? !towardsStart : towardsStart;

    const before = postRects(container);
    if (insertBeforeAnchor) container.insertBefore(item, anchor);
    else container.insertBefore(item, anchor.nextSibling);
    const after = postRects(container);

    afterPostMove(container);
    animatePostMove(container, item, before, after, wrapped, delta);
  }

  const TOPIC_HEADING_SELECTOR = 'h2, [role="heading"][aria-level="2"], [jsname="K3jAGe"]';

  function cleanTopicLabel(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      // The header sometimes carries the post count next to the title.
      .replace(/\s*[\u00b7\u2022|\u2013-]?\s*\d+\s+(?:post|assignment|material|question|item)s?$/i, '')
      .trim();
  }

  /**
   * The topic title the page shows above a post list.
   *
   * Taking "the first heading in the closest section" picked the wrong heading
   * on Classroom's nested markup, so the picker offered names that were not on
   * the page. The title that belongs to a list is the nearest heading *before*
   * it that lives inside the same topic wrapper.
   */
  function topicNameFor(container) {
    let heading = null;
    const wrapper = container.closest('[data-topic-id], section, [role="region"]');
    if (wrapper) {
      for (const el of wrapper.querySelectorAll(TOPIC_HEADING_SELECTOR)) {
        // Only headings above the list belong to it: a nested topic's heading
        // comes after its parent's list.
        if (el.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_FOLLOWING) {
          heading = el;
        }
      }
    } else {
      // A list without a topic wrapper: walk up looking for the heading right
      // above it, stopping at anything that belongs to another topic.
      const stop = getMainElement();
      let node = container;
      while (node && node !== stop && !heading) {
        let sibling = node.previousElementSibling;
        while (sibling) {
          if (sibling.matches('ol, [role="list"]') || sibling.querySelector('ol, [role="list"]')) {
            break;
          }
          const found = sibling.matches(TOPIC_HEADING_SELECTOR)
            ? sibling
            : sibling.querySelector(TOPIC_HEADING_SELECTOR);
          if (found) {
            heading = found;
            break;
          }
          sibling = sibling.previousElementSibling;
        }
        node = node.parentElement;
      }
    }
    const name = cleanTopicLabel(heading && heading.textContent);
    return name || 'Untitled topic';
  }

  /**
   * Whether a topic counts as somewhere a post can go.
   *
   * An emptied topic list no longer has a box of its own, so its wrapper — the
   * section that still holds the heading — decides. A collapsed topic, or
   * another class' copy parked in the DOM, has no box either and stays out.
   */
  function topicIsOnPage(container) {
    if (!container.isConnected) return false;
    if (container.getClientRects().length) return true;
    if (!containerItems(container).length) {
      try {
        if (getComputedStyle(container).display === 'none') return false;
      } catch (_) {
        return false;
      }
    }
    const wrapper = container.closest('[data-topic-id], section, [role="region"]');
    return !!(wrapper && wrapper.getClientRects().length) || container.offsetParent !== null;
  }

  /** Document order, so the picker matches the order the topics appear in. */
  function byPageOrder(a, b) {
    if (a === b) return 0;
    const relation = a.compareDocumentPosition(b);
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  /** Every topic a post could be moved into, including ones that are now empty. */
  function topicTargets() {
    const targets = [];
    const containers = new Set();
    for (const container of postLists.keys()) containers.add(container);
    for (const container of knownTopicLists) containers.add(container);
    for (const container of collectGroups(getMainElement()).keys()) containers.add(container);
    // Sorted rather than listed in discovery order: an emptied topic drops out
    // of the scan, and appending it at the end would reshuffle the menu.
    const ordered = Array.from(containers).filter((c) => c.isConnected).sort(byPageOrder);
    for (const container of ordered) {
      if (!topicIsOnPage(container)) continue;
      targets.push({ container, name: topicNameFor(container) });
    }
    return targets;
  }

  /** Append a post to another topic and keep both topics in shape. */
  function movePostToTopic(item, targetContainer) {
    const source = postListForItem(item);
    if (!targetContainer || !source || targetContainer === source) return false;
    targetContainer.appendChild(item);
    afterPostMove(source);
    afterPostMove(targetContainer);
    revealPostInContainer(targetContainer, item);
    return true;
  }

  /** Scroll a topic's window just enough to show the post that moved into it. */
  function revealPostInContainer(container, item) {
    const box = container.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    if (rect.height === 0 || box.height === 0) return;
    if (rect.top < box.top) container.scrollTop += rect.top - box.top;
    else if (rect.bottom > box.bottom) container.scrollTop += rect.bottom - box.bottom;
  }

  // --- Topic picker opened by the dot ---

  let openTopicMenu = null;

  function positionTopicMenu(menu, anchor) {
    const anchorRect = anchor.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    const margin = 8;
    // The controls sit on the left edge of the post, so the menu opens to their
    // right and only flips left when there is no room.
    let left = anchorRect.right + margin;
    if (left + size.width > window.innerWidth - margin) {
      left = Math.max(margin, anchorRect.left - margin - size.width);
    }
    let top = anchorRect.top + anchorRect.height / 2 - size.height / 2;
    top = Math.max(margin, Math.min(top, window.innerHeight - margin - size.height));
    menu.style.left = `${Math.round(Math.max(margin, left))}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function onTopicMenuOutside(event) {
    if (!openTopicMenu) return;
    if (openTopicMenu.menu.contains(event.target)) return;
    if (openTopicMenu.anchor.contains(event.target)) return;
    closeTopicMenu();
  }

  function onTopicMenuKey(event) {
    if (event.key === 'Escape') closeTopicMenu();
  }

  function closeTopicMenu() {
    if (!openTopicMenu) return;
    const { anchor, menu } = openTopicMenu;
    openTopicMenu = null;
    document.removeEventListener('mousedown', onTopicMenuOutside, true);
    document.removeEventListener('keydown', onTopicMenuKey, true);
    window.removeEventListener('scroll', closeTopicMenu, true);
    window.removeEventListener('resize', closeTopicMenu);
    if (anchor && anchor.isConnected) anchor.setAttribute('aria-expanded', 'false');
    menu.remove();
  }

  function toggleTopicMenu(item, anchor) {
    if (openTopicMenu && openTopicMenu.anchor === anchor) {
      closeTopicMenu();
      return;
    }
    closeTopicMenu();

    const current = postListForItem(item);
    const menu = document.createElement('div');
    menu.className = `${CLASS.ui} ${CLASS.topicMenu}`;
    menu.style.setProperty('--cpp-theme', courseThemeColor());
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Move post to topic');

    const title = document.createElement('div');
    title.className = CLASS.topicMenuTitle;
    title.textContent = 'Move to topic';
    menu.appendChild(title);

    let choices = 0;
    for (const { container, name } of topicTargets()) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = CLASS.topicOption;
      option.setAttribute('role', 'menuitem');
      option.textContent = name;
      if (container === current) {
        option.classList.add(CLASS.topicCurrent);
        option.setAttribute('aria-current', 'true');
        option.disabled = true;
      } else {
        choices++;
        option.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeTopicMenu();
          movePostToTopic(item, container);
        });
      }
      menu.appendChild(option);
    }

    if (choices === 0) {
      const empty = document.createElement('div');
      empty.className = CLASS.topicMenuEmpty;
      empty.textContent = 'No other topics on this page';
      menu.appendChild(empty);
    }

    (document.body || document.documentElement).appendChild(menu);
    positionTopicMenu(menu, anchor);
    anchor.setAttribute('aria-expanded', 'true');
    openTopicMenu = { anchor, menu };

    document.addEventListener('mousedown', onTopicMenuOutside, true);
    document.addEventListener('keydown', onTopicMenuKey, true);
    window.addEventListener('scroll', closeTopicMenu, true);
    window.addEventListener('resize', closeTopicMenu);

    const first = menu.querySelector(`.${CLASS.topicOption}:not([disabled])`);
    if (first) {
      try {
        first.focus({ preventScroll: true });
      } catch (_) {
        first.focus();
      }
    }
  }

  // --- Sort Order (Reverse All Topics) ---

  // Looking for "Collapse all" walks every button on the page, so the result is
  // cached for a few seconds per view instead of on every scan.
  let collapseBtnCache = null;
  let collapseBtnCacheAt = 0;
  let collapseBtnCachePath = '';

  function findCollapseAllButton() {
    const now = Date.now();
    if (
      collapseBtnCache &&
      collapseBtnCache.isConnected &&
      collapseBtnCachePath === location.pathname &&
      now - collapseBtnCacheAt < 5000
    ) {
      return collapseBtnCache;
    }
    const found = findCollapseAllButtonUncached();
    collapseBtnCache = found;
    collapseBtnCacheAt = now;
    collapseBtnCachePath = location.pathname;
    return found;
  }

  function findCollapseAllButtonUncached() {
    const allBtns = document.querySelectorAll('button, [role="button"]');
    for (const btn of allBtns) {
      if (btn.id === 'cpp-sort-toggle' || btn.closest(`.${CLASS.ui}`)) continue;
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const text = (btn.textContent || '').toLowerCase();
      if (
        label.includes('collapse all') || label.includes('expand all') ||
        text.includes('collapse all') || text.includes('expand all') ||
        text.includes('tout réduire') || text.includes('tout développer')
      ) {
        // Classroom parks previously visited classes' views — and their
        // toolbars — in the DOM, ahead of the class on screen. Anchoring to one
        // of those put our button inside a hidden subtree, so it only appeared
        // after a page reload. Only a control with a box on screen counts.
        if (btn.getClientRects().length) return btn;
      }
    }

    // Fallback: look near the first topic heading/section
    const main = getMainElement();
    const firstTopic = main.querySelector('[data-topic-id], section, h2');
    if (firstTopic && firstTopic.parentElement) {
      const candidateBtn = firstTopic.parentElement.querySelector('button');
      if (
        candidateBtn &&
        candidateBtn.id !== 'cpp-sort-toggle' &&
        candidateBtn.getClientRects().length
      ) {
        return candidateBtn;
      }
    }

    return null;
  }

  /** Box properties mirrored from Google's "Collapse all" button. */
  const MIRRORED_STYLE_PROPS = [
    'alignItems', 'backgroundImage', 'backgroundColor', 'borderBottomColor',
    'borderBottomLeftRadius', 'borderBottomRightRadius', 'borderBottomStyle',
    'borderBottomWidth', 'borderLeftColor', 'borderLeftStyle', 'borderLeftWidth',
    'borderRightColor', 'borderRightStyle', 'borderRightWidth', 'borderTopColor',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderTopStyle', 'borderTopWidth',
    'boxSizing', 'boxShadow', 'fontFamily', 'fontSize',
    'fontWeight', 'gap', 'height', 'justifyContent', 'letterSpacing', 'lineHeight',
    'maxHeight', 'minHeight', 'minWidth', 'paddingBottom', 'paddingLeft',
    'paddingRight', 'paddingTop', 'textTransform', 'verticalAlign', 'whiteSpace',
  ];

  /** Text properties mirrored from the element that renders Google's label. */
  const MIRRORED_TEXT_PROPS = [
    'color', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight',
    'letterSpacing', 'lineHeight', 'textTransform',
  ];

  /**
   * The element that actually renders a control's label text. Google wraps the
   * "Collapse all" label in its own <span> that carries the real typography, so
   * the button's own computed font can differ from the glyphs on screen.
   *
   * Only rendered elements count. Classroom keeps a hidden copy of the label
   * inside the same button (its tooltip), and a tooltip's colour is nothing
   * like the label's — copying it made our text and icon invisible.
   */
  function findLabelElement(el) {
    let best = el;
    let bestDepth = 0;
    const walk = (node, depth) => {
      for (const child of node.children) {
        if (child.namespaceURI === 'http://www.w3.org/2000/svg') continue;
        if (!(child.textContent || '').trim()) continue;
        if (!child.getClientRects().length) continue;
        if (depth + 1 > bestDepth) {
          best = child;
          bestDepth = depth + 1;
        }
        walk(child, depth + 1);
      }
    };
    walk(el, 0);
    return best;
  }

  /** True for colours that would paint nothing, e.g. rgba(0, 0, 0, 0). */
  function isTransparentColor(value) {
    if (!value) return true;
    const text = value.trim();
    if (text === 'transparent') return true;
    const match = /^rgba?\(([^)]+)\)$/.exec(text);
    if (!match) return false;
    const parts = match[1].split(/[,\s/]+/).filter(Boolean);
    return parts.length >= 4 && parseFloat(parts[3]) === 0;
  }

  /**
   * Copy the look of Classroom's own "Collapse all" button onto our button so
   * the two controls form one consistent pair (only the label differs).
   */
  function styleSortButtonLike(btn, source, active) {
    try {
      const cs = getComputedStyle(source);
      // Nothing useful to copy from a hidden button.
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      for (const prop of MIRRORED_STYLE_PROPS) {
        const value = cs[prop];
        if (value) btn.style[prop] = value;
      }
      if (cs.display) btn.style.display = cs.display;

      // Typography comes from the label element, not the button box, so the
      // text matches the "Collapse all" glyphs in type, colour and size.
      const labelEl = findLabelElement(source);
      const labelCS = labelEl === source ? cs : getComputedStyle(labelEl);
      // A fully transparent colour paints nothing; keep the CSS fallback.
      if (!isTransparentColor(labelCS.color)) btn.style.color = labelCS.color;
      const textSpan = btn.querySelector('.cpp-sort-text');
      if (textSpan) {
        for (const prop of MIRRORED_TEXT_PROPS) {
          const value = labelCS[prop];
          if (value && !(prop === 'color' && isTransparentColor(value))) {
            textSpan.style[prop] = value;
          } else {
            // Clear anything left over from a previous source button.
            textSpan.style.removeProperty(
              prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
            );
          }
        }
      }

      // Sits to the left of "Collapse all" with the same gap it uses itself.
      btn.style.marginRight = '8px';
      btn.style.marginLeft = '0px';
      btn.style.cursor = 'pointer';
      if (active) {
        // Keep the label exactly like "Collapse all"'s; the tint shows the state.
        btn.style.backgroundColor = 'rgba(11, 87, 208, 0.12)';
        btn.style.borderColor = '#0b57d0';
      }
    } catch (_) {
      // Computed styles are a nicety; the CSS fallback still applies.
    }
  }

  let sortButtonStyleSource = null;

  /** Re-apply the label and styling of the existing sort button. */
  function refreshSortButton() {
    const btn = document.getElementById('cpp-sort-toggle');
    if (!btn) return;
    btn.classList.toggle('cpp-sort-active', isReversed);
    const textSpan = btn.querySelector('.cpp-sort-text');
    if (textSpan) {
      textSpan.textContent = isReversed ? 'Reverse order: ON' : 'Reverse order';
    }
    if (sortButtonStyleSource && sortButtonStyleSource.isConnected) {
      styleSortButtonLike(btn, sortButtonStyleSource, isReversed);
    }
  }

  function removeSortToggleButton() {
    const btn = document.getElementById('cpp-sort-toggle');
    if (btn) btn.remove();
    // Don't keep a reference to a button from a class we have left.
    sortButtonStyleSource = null;
  }

  function ensureSortToggleButton() {
    let btn = document.getElementById('cpp-sort-toggle');

    // The button belongs to the Classwork tab only: never show it elsewhere.
    if (!onClassworkContent()) {
      // Classroom hides a Classwork view for a moment while it re-renders a
      // class. The button lives in the global toolbar, so leave it alone unless
      // the page is clearly somewhere other than Classwork.
      if (isClassworkPath() || document.querySelector('[data-topic-id]')) return;
      removeSortToggleButton();
      return;
    }

    const collapseBtn = findCollapseAllButton();

    if (!collapseBtn) {
      return;
    }

    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'cpp-sort-toggle';
      btn.className = 'cpp-sort-toggle';
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-label', 'Reverse order of posts in all topics');
      btn.innerHTML = `${SORT_ICON_SVG}<span class="cpp-sort-text">${isReversed ? 'Reverse order: ON' : 'Reverse order'}</span>`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSortOrder();
      });
    }

    // Place it immediately before "Collapse all" (its tooltip wrapper, if any).
    const insertTarget =
      collapseBtn.closest('[data-is-tooltip-wrapper="true"]') ||
      collapseBtn.closest('[data-is-touch-wrapper="true"]') ||
      collapseBtn;
    if (btn.nextElementSibling !== insertTarget) {
      insertTarget.parentNode.insertBefore(btn, insertTarget);
    }

    sortButtonStyleSource = collapseBtn;
    refreshSortButton();
  }

  function toggleSortOrder() {
    isReversed = !isReversed;
    try {
      localStorage.setItem(SORT_STORAGE_KEY, String(isReversed));
    } catch (_) {}

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ isReversed });
    }

    const btn = document.getElementById('cpp-sort-toggle');
    if (btn) {
      btn.classList.toggle('cpp-sort-active', isReversed);
      const textSpan = btn.querySelector('.cpp-sort-text');
      if (textSpan) {
        textSpan.textContent = isReversed ? 'Reverse order: ON' : 'Reverse order';
      }
    }

    applySortOrderToAll();
  }

  function applySortOrderToAll() {
    for (const container of activeContainers) {
      const st = stateByContainer.get(container);
      if (!st || !st.items) continue;

      applySortOrderToContainer(container, st.items, isReversed);
      // The arrows follow the order on screen, which just flipped.
      syncMoveControls(container);

      if (!st.expanded) {
        const latestIdx = findLatestPostIndex(st.items);
        alignLatestPostToMiddle(container, st.items, latestIdx, isReversed);
      }
    }

    // Without scroll areas a topic is still just a list, so the Reverse order
    // button flips it the same way.
    if (!scrollWindowsEnabled) {
      for (const [container, items] of collectGroups(getMainElement())) {
        applySortOrderToContainer(container, items, isReversed);
      }
    }
  }

  function applySortOrderToContainer(container, items, reversed) {
    container.classList.toggle('cpp-reversed', reversed);
    const count = items.length;
    for (let i = 0; i < count; i++) {
      if (reversed) {
        items[i].style.order = String(count - 1 - i);
      } else {
        items[i].style.removeProperty('order');
      }
    }
  }

  function recenterAllTopics(force) {
    for (const container of activeContainers) {
      const st = stateByContainer.get(container);
      if (!st || !st.items || st.expanded) continue;
      if (!force && st.centered) continue;
      const latestIdx = findLatestPostIndex(st.items);
      alignLatestPostToMiddle(container, st.items, latestIdx, isReversed);
      st.centered = true;
    }
  }

  const expansionAttemptsByTopic = new Map();
  // Maximum View more clicks per topic. Google loads ~10 posts per click.
  // A topic with 50+ posts needs 4+ clicks. Set high enough to cover any real classroom.
  const MAX_EXPANSION_ATTEMPTS = 30;

  /**
   * Inject CSS to hide the native "View more" button for topics we manage.
   * Buttons are only hidden after we add `.cpp-native-view-more`, so topics
   * that have not been enhanced keep Google's normal button.
   */
  function injectViewMoreHidingCSS() {
    if (viewMoreCssInjected) return;
    const style = document.createElement('style');
    style.id = 'cpp-hide-view-more';
    style.textContent = `
      /* Classroom++ — Visually hide a native "View more" button we manage */
      .cpp-native-view-more {
        position: absolute !important;
        opacity: 0 !important;
        width: 1px !important;
        height: 1px !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        overflow: hidden !important;
        clip: rect(0, 0, 0, 0) !important;
        clip-path: inset(50%) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    viewMoreCssInjected = true;
    log('injected CSS to hide managed View more buttons');
  }

  /**
   * Strictly verify if an element is Google Classroom's native "View more" button.
   * Must NOT match topic accordion buttons, post menus, or other Classroom buttons.
   */
  function isViewMoreButton(btn) {
    if (!btn || !btn.isConnected) return false;

    // Must not be disabled
    if (btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    // Must not be inside a container that Google Classroom explicitly hid
    const hiddenAncestor = btn.closest('[style*="display: none"], [style*="display:none"], [hidden]');
    if (hiddenAncestor) {
      return false;
    }

    // Check aria-label specifically for "View more"
    const ariaLabel = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
    if (ariaLabel.includes('view more')) {
      return true;
    }

    // Check inner text strictly
    const text = (btn.textContent || '').trim().toLowerCase();
    if (text === 'view more' || text.includes('view more posts') || text === 'afficher plus' || text === 'ver más') {
      return true;
    }

    // Check Google Classroom's topic overflow jsname="t6Kl7b"
    if (btn.getAttribute('jsname') === 't6Kl7b') {
      if (!ariaLabel || ariaLabel.includes('more') || text.includes('more')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Safely dispatch click event to trigger Google Wiz/Closure actions without stealing focus.
   * Dispatches a full pointer event sequence (pointerdown → pointerup → click) because
   * Google's WIZ jsaction listens for pointerdown:FEiYhc and pointerup:mF5Elf in addition
   * to click:h5M12e. Using only .click() may miss the pointer handlers on slow-loading pages.
   */
  function triggerClick(el) {
    if (!el) return;
    try {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    } catch (_) {
      // Fallback to the native .click() if PointerEvent isn't supported
      try { el.click(); } catch (_2) {}
    }
  }

  /**
   * Topics whose posts we already fetched, and when.
   *
   * Classroom re-renders the Classwork list by itself — often while the tab is
   * in the background — and a re-render drops the posts our "View more" clicks
   * fetched, so the same topics come back truncated a moment later. Without
   * remembering them, every re-render (and so every tab activation) refetched
   * the whole class. A topic that is genuinely new is not in here and loads at
   * once; after the interval the topics are fetched again, so posts added or
   * removed elsewhere are picked up after a real absence.
   */
  const AUTO_LOAD_INTERVAL_MS = 15 * 60 * 1000;
  const loadedTopicAt = new Map();

  function topicIdFor(btn) {
    const node = btn.closest('[data-topic-id]');
    return node ? node.dataset.topicId || node.getAttribute('data-topic-id') || 'unknown' : 'unknown';
  }

  /** Was this button's topic already loaded recently? */
  function isRecentlyLoadedTopic(btn) {
    const id = topicIdFor(btn);
    if (id === 'unknown') return false;
    const at = loadedTopicAt.get(id);
    if (!at) return false;
    if (Date.now() - at > AUTO_LOAD_INTERVAL_MS) {
      loadedTopicAt.delete(id);
      return false;
    }
    return true;
  }

  /**
   * Find any genuine "View more" buttons that haven't been clicked yet.
   */
  function findUnclickedViewMore() {
    const results = [];
    const seen = new Set();

    const selectors = [
      'button[aria-label*="View more" i]',
      '[role="button"][aria-label*="View more" i]',
      'button[jsname="t6Kl7b"]',
      '[role="button"][jsname="t6Kl7b"]',
    ];
    const candidates = document.querySelectorAll(selectors.join(', '));
    for (const el of candidates) {
      const btn = el.closest('button, [role="button"]') || el;
      if (!seen.has(btn) && !btn.dataset.cppClicked && isViewMoreButton(btn) && !isRecentlyLoadedTopic(btn)) {
        const topicNode = btn.closest('[data-topic-id]');
        const topicId = topicNode ? topicNode.dataset.topicId || topicNode.getAttribute('data-topic-id') : 'unknown';
        const attempts = expansionAttemptsByTopic.get(topicId) || 0;
        if (attempts < MAX_EXPANSION_ATTEMPTS) {
          seen.add(btn);
          results.push(btn);
        }
      }
    }

    // Also check other buttons strictly for "View more" text
    const allButtons = document.querySelectorAll('button, [role="button"]');
    for (const btn of allButtons) {
      if (!seen.has(btn) && !btn.dataset.cppClicked && isViewMoreButton(btn) && !isRecentlyLoadedTopic(btn)) {
        const topicNode = btn.closest('[data-topic-id]');
        const topicId = topicNode ? topicNode.dataset.topicId || topicNode.getAttribute('data-topic-id') : 'unknown';
        const attempts = expansionAttemptsByTopic.get(topicId) || 0;
        if (attempts < MAX_EXPANSION_ATTEMPTS) {
          seen.add(btn);
          results.push(btn);
        }
      }
    }

    return results;
  }

  /**
   * Find the topic section that owns a post-list container.
   */
  function topicNodeForContainer(container) {
    return (
      container.closest('[data-topic-id]') ||
      container.closest('section, [role="region"], [aria-label*="Topic" i]') ||
      container.parentElement
    );
  }

  function topicIdForNode(node) {
    const topicNode = node && node.closest ? node.closest('[data-topic-id]') : null;
    return topicNode
      ? topicNode.dataset.topicId || topicNode.getAttribute('data-topic-id') || 'unknown'
      : 'unknown';
  }

  /**
   * Find the native "View more" button belonging to one topic only.
   */
  function findViewMoreForContainer(container) {
    const topicNode = topicNodeForContainer(container);
    if (!topicNode) return null;

    for (const btn of topicNode.querySelectorAll('button, [role="button"]')) {
      if (btn.dataset.cppClicked || !isViewMoreButton(btn)) continue;
      const attempts = expansionAttemptsByTopic.get(topicIdForNode(btn)) || 0;
      if (attempts < MAX_EXPANSION_ATTEMPTS) return btn;
    }
    return null;
  }

  /**
   * Hide the native button for an enhanced topic (our scroll window takes over).
   */
  function hideViewMoreForContainer(container) {
    const topicNode = topicNodeForContainer(container);
    if (!topicNode) return;
    for (const btn of topicNode.querySelectorAll('button, [role="button"]')) {
      if (btn.dataset.cppClicked || isViewMoreButton(btn)) {
        btn.classList.add('cpp-native-view-more');
      }
    }
  }

  /**
   * Count the posts Classroom++ actually sees: the list items of the topic post
   * lists inside the Classwork main area. Uses the same grouping as the scanner,
   * so menus and the To-do sidebar are not counted as posts.
   */
  function countLoadedPosts() {
    const main = getMainElement();
    // Count each post once. Two things used to inflate this number:
    //   - overlapping groups (a wrapper list and the topic list inside it both
    //     contributed the same posts), and
    //   - the previous class' topic lists, which Classroom leaves in the DOM
    //     (hidden) while switching classes, so a second load added the first
    //     class' posts to the total.
    const counted = new Set();
    for (const [container, items] of collectGroups(main)) {
      if (!container.getClientRects().length) continue;
      for (const item of items) counted.add(item);
    }
    return counted.size;
  }

  /**
   * Cheap counter used only to notice that a "View more" click appended posts.
   * Includes role="listitem" so fixtures and pages that don't expose
   * data-stream-item-id still report progress.
   */
  function currentPostCount() {
    const main = getMainElement();
    return main.querySelectorAll('[data-stream-item-id], [role="listitem"]').length;
  }

  /**
   * Wait until a View more click actually adds posts. Resolves immediately on
   * the DOM mutation that appends the response and removes the clicked buttons,
   * instead of always sleeping for a fixed 500 ms. When Google leaves a button
   * connected, a short settle delay still protects parallel batch responses.
   */
  function waitForExpansionProgress(previousCount, clickedButtons) {
    return new Promise((resolve) => {
      let settled = false;
      let sawProgress = false;
      let settleTimer = 0;

      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timeout);
        clearTimeout(settleTimer);
        resolve();
      };

      const check = () => {
        if (settled) return;

        if (currentPostCount() > previousCount) sawProgress = true;

        const allButtonsDone = clickedButtons.every((btn) => !btn.isConnected);
        if (sawProgress && allButtonsDone) {
          finish();
          return;
        }

        // Some responses may arrive a little later than the first one. Give
        // them a short grace period when the button remains in the DOM.
        if (sawProgress) {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(finish, 500);
        }
      };

      const observer = new MutationObserver(check);
      const timeout = setTimeout(finish, EXPANSION_WAIT_TIMEOUT);
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      check();
    });
  }

  /**
   * Mark programmatic scroll changes so they don't look like the user asking
   * for more posts.
   */
  function markProgrammaticScroll(container, ms = 700) {
    container._cppIgnoreScrollUntil = Date.now() + ms;
  }

  let expansionRequested = false;
  /** A request parked because the tab was in the background when it arrived. */
  let pendingExpansion = false;

  /**
   * Expand every topic in the background whenever there is something left to
   * fetch. A no-op when everything is already loaded, which is what keeps a
   * return trip to the Classwork tab from reloading anything.
   */
  function requestExpansion(delay = 0) {
    if (isExpanding || expansionRequested) return;
    if (!scrollWindowsEnabled) return;
    if (!onClassworkContent()) return;
    if (findUnclickedViewMore().length === 0) return;

    // Never fetch in the background. Classroom keeps rebuilding the list while
    // the tab is hidden, and the work was invisible — the bar was still
    // finishing when the tab came back. Replay the request once, on the way in.
    if (document.visibilityState === 'hidden') {
      pendingExpansion = true;
      return;
    }

    expansionRequested = true;
    window.setTimeout(() => {
      expansionRequested = false;
      triggerAutoExpansion();
    }, delay);
  }

  /**
   * Safety net for a Classwork view that appears without a mutation our
   * observer can see (switching classes reuses the previous class' DOM and new
   * topics can be revealed by style/attribute changes only). Without this, a
   * half-loaded topic stayed that way until the page was reloaded.
   */
  function ensurePostsLoaded() {
    if (document.visibilityState === 'hidden') return;
    if (isExpanding || expansionRequested) return;
    if (!scrollWindowsEnabled) return;
    if (!onClassworkContent()) return;
    if (findUnclickedViewMore().length === 0) return;
    requestExpansion(0);
  }

  /**
   * Cheap snapshot of what Classwork is currently showing. Classroom can put a
   * whole page on screen by revealing already-rendered nodes (style/attribute
   * changes) rather than by adding nodes, which the MutationObserver never
   * reports — that is why entering a class sometimes did nothing until a
   * reload. The poll below compares this snapshot and rescans on any change.
   */
  function viewSignature() {
    const topics = Array.from(document.querySelectorAll('[data-topic-id]'));
    let visibleTopics = 0;
    let firstVisibleId = '';
    for (const topic of topics) {
      if (!topic.getClientRects().length) continue;
      visibleTopics++;
      if (!firstVisibleId) firstVisibleId = topic.getAttribute('data-topic-id') || '';
    }
    return [
      location.pathname,
      topics.length,
      visibleTopics,
      // Topic ids differ per class, so switching between two classes with the
      // same number of topics still counts as a change.
      firstVisibleId,
    ].join('|');
  }

  let lastViewSignature = '';
  let pollTimer = 0;

  /** Timer-driven fallback for views the observer cannot see. */
  function pollView() {
    // Nothing here matters while the tab is in the background; resuming the tab
    // fires visibilitychange, which scans immediately.
    if (document.visibilityState === 'hidden') return;
    if (!scrollWindowsEnabled) return;

    // Silent SPA navigation (history.pushState) fires no event of its own.
    if (location.pathname !== lastPath) onNavigationChange();

    const signature = viewSignature();
    const changed = signature !== lastViewSignature;
    // Also retry while Classwork is showing but nothing has been enhanced yet,
    // in case the first scan ran before the page was ready.
    const stuck =
      activeContainers.size === 0 &&
      onClassworkContent() &&
      document.querySelectorAll('[data-topic-id]').length > 0 &&
      Date.now() - lastScanAt > 1500;

    if (changed) lastViewSignature = signature;
    if (changed || stuck) scheduleScan(0);

    ensurePostsLoaded();

    // Keep the toolbar button there and on screen. Classroom re-renders its
    // toolbar and parks old views in the DOM; a button dropped along the way, or
    // left inside a hidden toolbar, would otherwise stay that way until the next
    // unrelated scan (or a page reload).
    const sortBtn = document.getElementById('cpp-sort-toggle');
    if (
      onClassworkContent() &&
      (!sortBtn || !sortBtn.getClientRects().length)
    ) {
      ensureSortToggleButton();
    }
  }

  /**
   * Load every post of every topic by clicking Google's native "View more"
   * until nothing is truncated, then apply the 5-post windows.
   */
  async function triggerAutoExpansion() {
    if (isExpanding) return;

    const initial = findUnclickedViewMore();
    if (initial.length === 0) return;

    // Only the Classwork tab has posts to load, so only it gets the progress bar.
    const showProgress = onClassworkContent();
    if (showProgress) beginSetup();
    isExpanding = true;
    injectViewMoreHidingCSS();

    const touchedTopics = new Set();

    try {
      // Click all currently-visible View more buttons. More rounds may be triggered
      // reactively by the MutationObserver as XHR responses arrive and new buttons appear.
      for (let round = 0; round < 20; round++) {
        // The user may navigate to another tab mid-load; stop fetching there.
        if (!onClassworkContent()) break;

        const buttons = findUnclickedViewMore();
        if (buttons.length === 0) break;

        log(`expanding ${buttons.length} native View more button(s) (round ${round + 1})`);

        const countBefore = currentPostCount();
        updateOverlay();

        for (const btn of buttons) {
          btn.dataset.cppClicked = 'true';
          btn.classList.add('cpp-native-view-more');
          const topicNode = btn.closest('[data-topic-id]');
          const topicId = topicNode ? topicNode.dataset.topicId || topicNode.getAttribute('data-topic-id') : 'unknown';
          if (topicId !== 'unknown') touchedTopics.add(topicId);
          const attempts = expansionAttemptsByTopic.get(topicId) || 0;
          // Bounded so a long-lived tab can never accumulate topic ids.
          if (expansionAttemptsByTopic.size > 500) expansionAttemptsByTopic.clear();
          expansionAttemptsByTopic.set(topicId, attempts + 1);

          triggerClick(btn);
        }

        // Resolve as soon as the XHR response appends posts instead of waiting
        // a fixed 500 ms for every batch.
        await waitForExpansionProgress(countBefore, buttons);
        noteSetupActivity();
      }
    } catch (err) {
      console.error('[Classroom++] auto expansion error:', err);
    } finally {
      isExpanding = false;
      noteSetupActivity();

      // Remember the topics that are now complete, so the next re-render of this
      // view (Classroom does that on its own) does not fetch them all again.
      const stillTruncated = new Set(findUnclickedViewMore().map(topicIdFor));
      for (const id of touchedTopics) {
        if (!stillTruncated.has(id)) loadedTopicAt.set(id, Date.now());
      }
      if (loadedTopicAt.size > 500) loadedTopicAt.clear();

      // Apply the 5-post window, sort order and latest-post alignment now that
      // every post is present. This replaces the old 50 ms + 300 ms delays.
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = 0;
      }
      scan();
      recenterAllTopics(true);

      // Restore scroll to top — loading caused the page to jump down
      if (window.scrollY > 0) {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
      noteSetupActivity();
    }
  }

  function scan() {
    // Don't rearrange while posts are still being appended; triggerAutoExpansion
    // runs a final scan once every View more batch has arrived.
    if (isDragging || isExpanding || scan._running) return;
    scan._running = true;
    try {
      // A different page or class is a fresh start: clear the per-topic click
      // budget so a topic that had hit the cap gets loaded after all (this is
      // what made switching classes sometimes need a full reload).
      if (location.pathname !== lastScanPath) {
        lastScanPath = location.pathname;
        expansionAttemptsByTopic.clear();
      }

      // The "To review" page has its own enhancement; its rows are not topic
      // posts and must never be turned into a 5-post scroll window.
      updateReviewMode();
      if (isToReviewView()) {
        for (const container of Array.from(activeContainers)) teardown(container);
        removeAllMoveControls();
        removeSortToggleButton();
        return;
      }

      // Not the Classwork view: leave the page exactly as Classroom rendered it
      // (no wrapping, no hidden buttons, no overlay). Anything we added on a
      // previous view is undone — but only once the topic nodes are really gone.
      // While Classroom re-renders a class, or keeps another class' view parked
      // in the DOM, tearing down would strip a view we are about to reuse, so we
      // simply do nothing and let the next scan finish the job.
      if (!onClassworkContent()) {
        // The Reverse order button lives in the global toolbar, outside the
        // parked view, so it always goes away here.
        removeSortToggleButton();
        // A different view means these per-topic counters are no longer useful.
        expansionAttemptsByTopic.clear();
        const parkedTopics = document.querySelector('[data-topic-id]');
        if (!parkedTopics && !isExpanding) {
          for (const container of Array.from(activeContainers)) teardown(container);
          removeAllMoveControls();
          cancelSetup();
        }
        return;
      }

      // Each Classwork feature has its own switch: turning one off only undoes
      // that feature and leaves the other two exactly as they are.
      if (reverseButtonEnabled) ensureSortToggleButton();
      else removeSortToggleButton();

      const main = getMainElement();
      const groups = collectGroups(main);

      if (scrollWindowsEnabled) {
        for (const [container, items] of groups) {
          if (!shouldHandle(container, items)) {
            if (activeContainers.has(container)) teardown(container);
            continue;
          }
          activeContainers.add(container);
          applyWindow(container, items);
        }

        for (const container of Array.from(activeContainers)) {
          if (!groups.has(container) || !container.isConnected) teardown(container);
        }
      } else {
        for (const container of Array.from(activeContainers)) teardown(container);
        // The topics are not windowed, but the Reverse order button still flips
        // each topic's own list.
        for (const [container, items] of groups) {
          applySortOrderToContainer(container, items, isReversed);
        }
        cancelSetup();
      }

      if (moveOverlayEnabled) {
        applyMoveControls(groups);
      } else if (document.querySelector(`.${CLASS.moveControls}`)) {
        removeAllMoveControls();
      }
      reportScan(groups);
    } catch (err) {
      console.error('[Classroom++] scan failed', err);
    } finally {
      scan._running = false;
      lastScanAt = Date.now();
      // No noteSetupActivity() here: routine scans (SPA mutations, re-renders)
      // must not keep the global overlay alive. Only actual loading shows it.

      // A topic may have appeared with posts still behind "View more" (new
      // topic, new post, return trip). Finish loading it in the background.
      if (!isExpanding && isClassworkView() && findUnclickedViewMore().length > 0) {
        requestExpansion(60);
      }
    }
  }

  let lastScanPath = location.pathname;

  let lastReport = '';
  function reportScan(groups) {
    const summary = `enhanced=${activeContainers.size} groups=${groups.size} path=${location.pathname}`;
    if (summary !== lastReport) {
      lastReport = summary;
      console.info(`[Classroom++] active (${extensionVersion()}): ${summary}`);
    }
  }

  function extensionVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (_) {
      return '?';
    }
  }

  /**
   * Reset all enhanced topics to default:
   * Collapsed (5 posts visible) and re-aligned with latest post in the middle.
   */
  function resetAllToDefault() {
    for (const container of activeContainers) {
      const st = stateByContainer.get(container);
      if (st) {
        st.expanded = false;
        st.centered = false;
        container.classList.remove(CLASS.expanded);
      }
    }
  }

  /**
   * A Classwork route (/c/<id>/t/all, /w/<id>/t/<topicId>) or a query that
   * names the Classwork view. Archived classes render the same tab with
   * different chrome, so the route is the most reliable signal.
   */
  function isClassworkPath() {
    return (
      /\/t\/(?:all|[^/]+)\/?$/i.test(location.pathname) ||
      /[?&]tab=classwork\b/i.test(location.search)
    );
  }

  /**
   * Check if current page is within the Classwork section.
   *
   * Only the Classwork tab may be enhanced. Its topic sections are the only
   * place Classroom++ has anything to do; the class Stream, Home, Calendar,
   * People and the To-do page share the same URL prefix for a class, so a class
   * page is never treated as Classwork just because of its path.
   */
  function isClassworkView() {
    // A visible topic list means the Classwork view is the one on screen.
    const topicNode = document.querySelector('[data-topic-id]');
    if (topicNode && topicNode.getClientRects().length > 0) return true;

    // A classwork route or a title that names the Classwork view is
    // authoritative. Archived classes render the same tab with different
    // chrome — their tab strip is missing or does not expose the selected tab —
    // and requiring those signals made the extension skip every archived class
    // entirely.
    if (isClassworkPath()) return true;
    if (/(?:^|[-–—|·:]\s*)classwork\s*$/i.test(document.title || '')) return true;

    // Classroom's own navigation, because a class' Stream page shares the class
    // URL prefix with its Classwork tab.
    const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
    if (activeTab) return /classwork/i.test(activeTab.textContent || '');
    const currentLink = document.querySelector('a[aria-current="page"]');
    if (currentLink) return /classwork/i.test(currentLink.textContent || '');

    // Topic nodes exist but are hidden, with no other signal: another tab is
    // showing, so there is nothing to load (and no progress bar).
    return false;
  }

  /** Does any topic section currently have a visible box on screen? */
  function hasVisibleTopics() {
    for (const topic of document.querySelectorAll('[data-topic-id]')) {
      if (topic.getClientRects().length) return true;
    }
    return false;
  }

  /**
   * Are we looking at something Classroom++ should enhance?
   *
   * Visible topic sections are unambiguous — no other Classroom view (Home,
   * Stream, Calendar, People, To-do) renders topics — so they decide on their
   * own, no URL or tab-name guessing. That is what makes every class behave the
   * same, whatever the route looks like.
   */
  function onClassworkContent() {
    return hasVisibleTopics() || isClassworkView();
  }

  let lastPath = location.pathname;
  let lastWasClasswork = isClassworkView();

  function onNavigationChange() {
    const currentPath = location.pathname;
    const currentIsClasswork = isClassworkView();

    // When the user enters Classwork, or exits and comes back:
    if (currentIsClasswork && (!lastWasClasswork || currentPath !== lastPath)) {
      // Entering Classwork mounts the view fresh, so Classroom fetches that
      // class's posts by itself; nothing needs reloading.
      resetAllToDefault();
      scheduleScan(100);
      // Only loads (and only shows the bar) if something is still behind
      // "View more"; posts already on the page are reused as-is.
      requestExpansion(0);
    } else if (!currentIsClasswork && lastWasClasswork) {
      cancelSetup();
    }

    lastPath = currentPath;
    lastWasClasswork = currentIsClasswork;
    updateReviewMode();
    scheduleScan(100);
  }

  let scanTimer = 0;
  let lastScanAt = 0;
  function scheduleScan(customWait) {
    if (scanTimer) return;
    const wait = customWait || Math.max(100, 300 - (Date.now() - lastScanAt));
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      scan();
    }, wait);
  }

  function isOurNode(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el || !el.classList || !el.classList.contains) return false;
    return (
      el.classList.contains(CLASS.ui) ||
      el.classList.contains('cpp-loading-overlay') ||
      el.id === 'cpp-sort-toggle' ||
      el.closest(`.${CLASS.ui}`) !== null ||
      el.closest('.cpp-loading-overlay') !== null
    );
  }

  const observer = new MutationObserver((records) => {
    // Ignore DOM mutations while the user is actively dragging posts
    if (isDragging) return;

    let hasRelevantChanges = false;

    for (const record of records) {
      if (record.type !== 'childList') continue;
      const addedNodes = Array.from(record.addedNodes);
      const allNodes = addedNodes.concat(Array.from(record.removedNodes));
      if (!allNodes.length) continue;
      if (allNodes.every(isOurNode)) continue;

      hasRelevantChanges = true;
    }

    if (!hasRelevantChanges) return;

    // New topics are enhanced silently. The scan itself starts a background
    // load only when a topic is actually truncated, so ordinary SPA mutations
    // never resurrect the loading bar.
    scheduleScan(120);
  });

  function diagnose() {
    const main = getMainElement();
    let groups = new Map();
    try {
      groups = collectGroups(main);
    } catch (err) {
      return { error: String(err) };
    }
    return {
      url: location.href,
      extensionVersion: extensionVersion(),
      isClassworkView: isClassworkView(),
      onClassworkContent: onClassworkContent(),
      visibleTopics: hasVisibleTopics(),
      title: document.title,
      topicsCount: document.querySelectorAll('[data-topic-id]').length,
      streamItemsCount: document.querySelectorAll('[data-stream-item-id]').length,
      roleMainFound: !!document.querySelector(MAIN_SELECTOR),
      h2Headings: main.querySelectorAll('h2').length,
      groups: Array.from(groups.entries()).map(([container, items]) => {
        const latestIdx = findLatestPostIndex(items);
        return {
          itemsCount: items.length,
          handled: shouldHandle(container, items),
          latestPostIndex: latestIdx,
          latestIsDraft: latestIdx >= 0 ? isDraftItem(items[latestIdx]) : false,
          hidden: container.getBoundingClientRect().width === 0,
        };
      }),
      enhanced: activeContainers.size,
      sortButtonPresent: !!document.getElementById('cpp-sort-toggle'),
      collapseButtonFound: !!findCollapseAllButton(),
      collapseCandidates: Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter((b) => b.getClientRects().length)
        .slice(0, 25)
        .map((b) => `${(b.getAttribute('aria-label') || '').trim()} | ${(b.textContent || '').trim()}`.slice(0, 80)),
    };
  }

  // ── To review: bulk "Mark as reviewed" ──────────────────────────────────

  const REVIEW_PATH_RE = /^\/(?:u\/\d+\/)?ta\/not-reviewed/;
  const REVIEW_ROW_SELECTOR = 'li[data-role="task-row"]';
  const REVIEW_MARK_LABEL_RE = /^mark as reviewed\b/i;

  let reviewActive = false;
  let reviewObserver = null;
  let reviewSyncTimer = 0;
  let reviewBar = null;
  let reviewBusy = false;
  let reviewMessage = '';
  let reviewMessageTimer = 0;
  let reviewAnchor = null; // last row toggled on its own, for shift-ranges
  const reviewSelected = new Set();

  /**
   * On the "To review" page each assignment is marked reviewed one at a time
   * through its "Assignment options" menu. This mode adds a checkbox per row
   * and a bar that marks every selected row in one go.
   */
  function isToReviewView() {
    if (REVIEW_PATH_RE.test(location.pathname)) return true;
    // Also covers fixtures and any rendered To review list regardless of URL.
    const row = document.querySelector(REVIEW_ROW_SELECTOR);
    return !!(row && row.getClientRects().length > 0);
  }

  function reviewRows() {
    return Array.from(document.querySelectorAll(REVIEW_ROW_SELECTOR));
  }

  function reviewMenuItemLabel(el) {
    return (el.getAttribute('aria-label') || el.textContent || '').trim();
  }

  /** Only rows whose options menu can mark the assignment reviewed. */
  function rowSupportsBulkReview(row) {
    const items = row.querySelectorAll('[role="menuitem"]');
    if (items.length) {
      return Array.from(items).some((item) => REVIEW_MARK_LABEL_RE.test(reviewMenuItemLabel(item)));
    }
    // Menus are rendered lazily on some Classroom versions.
    return !!row.querySelector(
      'button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"], button[aria-label*="options" i]'
    );
  }

  function reviewRowTitle(row) {
    const titleEl = row.querySelector('.YH8M6e, a[href*="/submissions/"] p, a[href*="/a/"] p');
    const text = titleEl && titleEl.textContent.trim();
    if (text) return text;
    const trigger = row.querySelector('button[aria-label*="options" i]');
    return ((trigger && trigger.getAttribute('aria-label')) || '')
      .replace(/^.*?options for\s*/i, '')
      .trim();
  }

  /** Markable rows in document order, i.e. the rows a shift-range can span. */
  function reviewRangeRows() {
    return reviewRows().filter((row) => !!row.querySelector('.cpp-review-box'));
  }

  /** Every row between two rows inclusive, or null if either is no longer listed. */
  function reviewRangeBetween(from, to) {
    const rows = reviewRangeRows();
    const a = rows.indexOf(from);
    const b = rows.indexOf(to);
    if (a < 0 || b < 0) return null;
    return rows.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  function setRowSelected(row, checked) {
    const box = row.querySelector('.cpp-review-box');
    if (box && box.checked !== checked) box.checked = checked;
    if (checked) reviewSelected.add(row);
    else reviewSelected.delete(row);
  }

  /**
   * A plain click selects one row and becomes the anchor. Shift-click selects
   * everything from the anchor to the clicked row, all in the clicked box's new
   * state, so a shift-click on a checked row clears the whole span.
   */
  function onReviewBoxClick(row, box, event) {
    if (reviewBusy) {
      box.checked = reviewSelected.has(row);
      return;
    }
    clearReviewMessage();

    const range = event.shiftKey && reviewAnchor ? reviewRangeBetween(reviewAnchor, row) : null;
    const affected = range || [row];
    for (const target of affected) setRowSelected(target, box.checked);

    reviewAnchor = row;
    updateReviewBar();
  }

  function addReviewCheckbox(row) {
    if (row.querySelector('.cpp-review-check')) return;
    row.classList.add('cpp-review-row');

    const wrap = document.createElement('span');
    wrap.className = 'cpp-review-check';
    wrap.addEventListener('click', (e) => e.stopPropagation());

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cpp-review-box';
    box.setAttribute('aria-label', `Select ${reviewRowTitle(row) || 'assignment'} for bulk review`);
    box.title = 'Shift-click to select a range';
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      onReviewBoxClick(row, box, e);
    });

    wrap.appendChild(box);
    row.insertBefore(wrap, row.firstChild);
  }

  function ensureReviewBar() {
    if (reviewBar && reviewBar.isConnected) return reviewBar;

    const bar = document.createElement('div');
    bar.className = 'cpp-review-bar';
    bar.hidden = true;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Bulk review actions');

    const allLabel = document.createElement('label');
    allLabel.className = 'cpp-review-all';
    const allBox = document.createElement('input');
    allBox.type = 'checkbox';
    allBox.className = 'cpp-review-all-box';
    allBox.setAttribute('aria-label', 'Select every assignment shown');
    allBox.addEventListener('change', () => {
      clearReviewMessage();
      reviewAnchor = null;
      for (const row of reviewRows()) {
        if (!row.querySelector('.cpp-review-box')) continue;
        setRowSelected(row, allBox.checked);
      }
      updateReviewBar();
    });
    const allText = document.createElement('span');
    allText.textContent = 'Select all';
    allLabel.appendChild(allBox);
    allLabel.appendChild(allText);

    const status = document.createElement('span');
    status.className = 'cpp-review-status';
    status.setAttribute('aria-live', 'polite');

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'cpp-review-run';
    run.addEventListener('click', () => markSelectedAsReviewed());

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cpp-review-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => clearReviewSelection());

    bar.appendChild(allLabel);
    bar.appendChild(status);
    bar.appendChild(run);
    bar.appendChild(cancel);
    document.body.appendChild(bar);
    reviewBar = bar;
    return bar;
  }

  function setReviewText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function clearReviewMessage() {
    reviewMessage = '';
    clearTimeout(reviewMessageTimer);
    reviewMessageTimer = 0;
  }

  function setReviewMessage(text, ms = 0) {
    reviewMessage = text;
    clearTimeout(reviewMessageTimer);
    reviewMessageTimer = 0;
    if (ms) {
      reviewMessageTimer = window.setTimeout(() => {
        reviewMessageTimer = 0;
        reviewMessage = '';
        updateReviewBar();
      }, ms);
    }
    updateReviewBar();
  }

  function updateReviewBar() {
    if (!reviewBar) return;

    let selected = 0;
    let selectable = 0;
    for (const row of reviewRows()) {
      const box = row.querySelector('.cpp-review-box');
      if (box) selectable++;
      const checked = reviewSelected.has(row);
      if (box && box.checked !== checked) box.checked = checked;
      if (box && box.disabled !== reviewBusy) box.disabled = reviewBusy;
      row.classList.toggle('cpp-review-selected', checked);
      if (checked) selected++;
    }

    const allBox = reviewBar.querySelector('.cpp-review-all-box');
    const status = reviewBar.querySelector('.cpp-review-status');
    const run = reviewBar.querySelector('.cpp-review-run');
    const cancel = reviewBar.querySelector('.cpp-review-cancel');

    const hide = selected === 0 && !reviewBusy;
    if (reviewBar.hidden !== hide) reviewBar.hidden = hide;

    if (allBox) {
      const allChecked = selected > 0 && selected === selectable;
      if (allBox.checked !== allChecked) allBox.checked = allChecked;
      const mixed = selected > 0 && !allChecked;
      if (allBox.indeterminate !== mixed) allBox.indeterminate = mixed;
      if (allBox.disabled !== reviewBusy) allBox.disabled = reviewBusy;
    }

    if (status) {
      const countText = selected === 1 ? '1 assignment selected' : `${selected} assignments selected`;
      setReviewText(status, reviewMessage || countText);
    }
    if (run) {
      setReviewText(run, selected === 1 ? 'Mark as reviewed' : `Mark ${selected} as reviewed`);
      const disabled = reviewBusy || selected === 0;
      if (run.disabled !== disabled) run.disabled = disabled;
    }
    if (cancel && cancel.disabled !== reviewBusy) cancel.disabled = reviewBusy;
  }

  function syncReviewRows() {
    if (!reviewActive) return;

    for (const row of reviewRows()) {
      // Skip rows that cannot be marked reviewed, and rows inside a collapsed
      // due-date group where the options menu cannot be opened.
      if (!rowSupportsBulkReview(row) || !row.getClientRects().length) {
        const existing = row.querySelector('.cpp-review-check');
        if (existing) existing.remove();
        row.classList.remove('cpp-review-row', 'cpp-review-selected');
        reviewSelected.delete(row);
        continue;
      }
      addReviewCheckbox(row);
    }

    for (const row of Array.from(reviewSelected)) {
      if (!row.isConnected) reviewSelected.delete(row);
    }
    updateReviewBar();
  }

  function scheduleReviewSync() {
    if (!reviewActive || reviewSyncTimer) return;
    reviewSyncTimer = window.setTimeout(() => {
      reviewSyncTimer = 0;
      syncReviewRows();
    }, 150);
  }

  function activateReviewMode() {
    reviewActive = true;
    document.documentElement.classList.add('cpp-review-mode');
    ensureReviewBar();
    if (!reviewObserver) {
      reviewObserver = new MutationObserver(scheduleReviewSync);
      reviewObserver.observe(document.body, { childList: true, subtree: true });
    }
    syncReviewRows();
  }

  function deactivateReviewMode() {
    if (!reviewActive && !reviewBar) return;
    reviewActive = false;
    document.documentElement.classList.remove('cpp-review-mode');
    reviewBusy = false;
    reviewMessage = '';
    clearTimeout(reviewMessageTimer);
    reviewMessageTimer = 0;
    clearTimeout(reviewSyncTimer);
    reviewSyncTimer = 0;
    if (reviewObserver) {
      reviewObserver.disconnect();
      reviewObserver = null;
    }
    reviewAnchor = null;
    reviewSelected.clear();
    for (const row of reviewRows()) {
      row.classList.remove('cpp-review-row', 'cpp-review-selected');
      const check = row.querySelector('.cpp-review-check');
      if (check) check.remove();
    }
    if (reviewBar) {
      reviewBar.remove();
      reviewBar = null;
    }
  }

  function updateReviewMode() {
    // The extra checkboxes/action bar are opt-in from the extension popup, and
    // they only ever exist on the To review tab.
    if (bulkReviewEnabled && isToReviewView()) {
      if (!reviewActive) activateReviewMode();
      else syncReviewRows();
    } else if (reviewActive) {
      deactivateReviewMode();
    }
  }

  function clearReviewSelection() {
    if (reviewBusy) return;
    clearReviewMessage();
    reviewAnchor = null;
    reviewSelected.clear();
    for (const row of reviewRows()) {
      const box = row.querySelector('.cpp-review-box');
      if (box) box.checked = false;
    }
    updateReviewBar();
  }

  function waitForCondition(condition, timeout = 2000, interval = 100) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        let result = null;
        try {
          result = condition();
        } catch (_) {}
        if (result) return resolve(result);
        if (Date.now() - started >= timeout) return resolve(null);
        window.setTimeout(tick, interval);
      };
      tick();
    });
  }

  function findReviewMenuTrigger(row) {
    const buttons = Array.from(
      row.querySelectorAll(
        'button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"], button[aria-label*="options" i]'
      )
    );
    return (
      buttons.find((btn) => /options/i.test(btn.getAttribute('aria-label') || '')) ||
      buttons[0] ||
      null
    );
  }

  function findMarkReviewedItem(row) {
    const direct = Array.from(row.querySelectorAll('button, [role="button"]')).find((el) =>
      REVIEW_MARK_LABEL_RE.test((el.getAttribute('aria-label') || '').trim())
    );
    if (direct) return direct;

    const isVisible = (el) => !!el.getClientRects().length;
    const inRow = Array.from(row.querySelectorAll('[role="menuitem"]')).filter((el) =>
      REVIEW_MARK_LABEL_RE.test(reviewMenuItemLabel(el))
    );
    const visibleInRow = inRow.find(isVisible);
    if (visibleInRow) return visibleInRow;

    // Open menus can be hoisted to the end of <body> instead of staying inline.
    for (const el of document.querySelectorAll('[role="menuitem"]')) {
      if (!REVIEW_MARK_LABEL_RE.test(reviewMenuItemLabel(el))) continue;
      if (isVisible(el) && !el.closest(REVIEW_ROW_SELECTOR)) return el;
    }
    // Closed menus keep their items in the DOM; the caller opens the menu first.
    return inRow[0] || null;
  }

  /** Open a row's options menu and click its "Mark as reviewed" action. */
  async function markRowAsReviewed(row) {
    if (!row.isConnected) return false;

    let item = findMarkReviewedItem(row);
    if (!item || !item.getClientRects().length) {
      const trigger = findReviewMenuTrigger(row);
      if (trigger) {
        triggerClick(trigger);
        item = await waitForCondition(() => {
          const found = findMarkReviewedItem(row);
          return found && found.getClientRects().length ? found : null;
        }, 1500);
      }
    }
    if (!item) return false;

    triggerClick(item);

    // Classroom drops the row from "To review" once the change is recorded
    // (some versions instead swap the row's action to "Mark as not reviewed").
    const finished = await waitForCondition(
      () => !row.isConnected || !rowSupportsBulkReview(row),
      5000
    );
    return !!finished;
  }

  async function markSelectedAsReviewed() {
    if (reviewBusy) return;
    const rows = reviewRows().filter((row) => reviewSelected.has(row));
    if (rows.length === 0) return;

    reviewBusy = true;
    updateReviewBar();

    let marked = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i++) {
      if (!isToReviewView()) break;
      setReviewMessage(`Marking ${i + 1} of ${rows.length}…`);
      const ok = await markRowAsReviewed(rows[i]);
      if (ok) {
        marked++;
        reviewSelected.delete(rows[i]);
      } else {
        failed++;
      }
    }

    reviewBusy = false;
    if (!reviewActive) return; // navigated away mid-run

    if (failed > 0) setReviewMessage(`${failed} of ${rows.length} could not be marked as reviewed.`, 6000);
    else setReviewMessage(`Marked ${marked} as reviewed.`, 4000);
  }

  // ── End To review bulk mode ──────────────────────────────────────────────

  function init() {
    loadInitialSettings();
    // Nothing is ever fetched or hidden outside the Classwork tab.
    if (isClassworkView()) injectViewMoreHidingCSS();
    setupGlobalDragHandlers();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', () => {
      // Re-measure the 5-post windows from scratch.
      for (const container of activeContainers) {
        const st = stateByContainer.get(container);
        if (!st) continue;
        st.windowHeight = 0;
        st.baseWindowHeight = 0;
        st.baseItemHeights = null;
      }
      scheduleScan();
    });
    window.addEventListener('popstate', onNavigationChange);
    window.addEventListener('hashchange', onNavigationChange);

    // One timer covers both jobs: noticing a Classwork view that appeared
    // without a mutation we could observe, and finishing posts Classroom still
    // holds behind "View more". It is paused while the tab is in the background.
    pollTimer = window.setInterval(pollView, 1200);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (pendingExpansion) {
        pendingExpansion = false;
        requestExpansion(0);
      }
      pollView();
    });
    // Release the timer if the page is put in the back/forward cache.
    window.addEventListener('pagehide', () => {
      clearInterval(pollTimer);
      pollTimer = 0;
    });
    window.addEventListener('pageshow', () => {
      if (!pollTimer) pollTimer = window.setInterval(pollView, 1200);
    });

    // Listen for genuine user tab clicks (e.g. clicking Classwork tab)
    document.addEventListener(
      'click',
      (e) => {
        // Ignore programmatic clicks dispatched by extension
        if (!e.isTrusted) return;

        const target = e.target.closest('a, button, [role="tab"]');
        if (!target) return;

        // Ignore clicks on our own toggle buttons
        if (target.classList.contains(CLASS.toggle) || target.closest(`.${CLASS.ui}`)) {
          return;
        }

        const role = target.getAttribute('role');
        const label = (target.getAttribute('aria-label') || '').toLowerCase();
        const text = (target.textContent || '').toLowerCase();
        const href = target.getAttribute('href') || '';

        // Only reset when user clicks the main Classwork navigation tab
        if (
          (role === 'tab' || target.tagName === 'A') &&
          (text.includes('classwork') || label.includes('classwork') || href.includes('/w/'))
        ) {
          // Reuse whatever is already loaded: no bar unless posts are missing.
          resetAllToDefault();
          scheduleScan(150);
          requestExpansion(150);
        }
      },
      true
    );

    // Load every post of every topic, then apply the 5-post windows.
    // On later visits the posts are already in the DOM and nothing is fetched.
    scan();
    requestExpansion(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Test and diagnostic hooks
  window.__classroomPlusPlus = {
    scan,
    scheduleScan,
    diagnose,
    isDraftItem,
    findLatestPostIndex,
    alignLatestPostToMiddle,
    resetAllToDefault,
    expandAllTopics: triggerAutoExpansion,
    triggerAutoExpansion,
    requestExpansion,
    countLoadedPosts,
    isClassworkView,
    isToReviewView,
    markSelectedAsReviewed,
    setBulkReviewEnabled(on) {
      bulkReviewEnabled = on !== false;
      updateReviewMode();
    },
    isBulkReviewEnabled: () => bulkReviewEnabled,
    setScrollWindowsEnabled(on) {
      scrollWindowsEnabled = on !== false;
      scan();
    },
    isScrollWindowsEnabled: () => scrollWindowsEnabled,
    setMoveOverlayEnabled(on) {
      moveOverlayEnabled = on !== false;
      scan();
    },
    isMoveOverlayEnabled: () => moveOverlayEnabled,
    setReverseButtonEnabled(on) {
      reverseButtonEnabled = on !== false;
      scan();
    },
    isReverseButtonEnabled: () => reverseButtonEnabled,
    // The single switch used before each feature had its own: it still flips
    // all three together for older callers.
    setClassworkLayoutEnabled(on) {
      scrollWindowsEnabled = on !== false;
      moveOverlayEnabled = on !== false;
      reverseButtonEnabled = on !== false;
      scan();
    },
    isClassworkLayoutEnabled: () =>
      scrollWindowsEnabled && moveOverlayEnabled && reverseButtonEnabled,
    ensurePostsLoaded,
    pollView,
    viewSignature,
    syncWindowHeight,
    toggleSortOrder,
    movePostByOne,
    movePostToTopic,
    topicTargets,
    ensureMoveControls,
    getIsReversed: () => isReversed,
    recenterAllTopics,
    ensureSortToggleButton,
    reset() {
      for (const container of Array.from(activeContainers)) teardown(container);
    },
  };
})();


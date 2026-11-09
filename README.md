# Classroom++

A Chrome extension (Manifest V3) that makes the **Classwork** tab of Google Classroom easier to
work with and speeds up marking on the **To review** page.

Not affiliated with, endorsed by, or sponsored by Google. Google Classroom is a trademark of
Google LLC.

## What it does

### Classwork layout

- **5-post topic windows.** Topics with more than 5 posts become their own scroll area showing 5
  posts at a time; shorter topics are left untouched. **View all** / **View fewer** expands a
  topic in place.
- **Everything loaded.** Google's hidden "View more" batches are fetched automatically, so the
  newest published post is always present and every post is scrollable. This loading belongs to
  the **Scroll areas** switch: turn it off and Classwork keeps Google's own truncated lists.
- **Newest post centred.** Each topic scrolls so the latest *published* post (not a draft) sits in
  the middle of the 5-post window, with upcoming drafts right below it.
- **Reverse order.** A button placed to the left of Google's "Collapse all" flips the post order in
  every topic; its look is copied from that button at runtime.
- **Move posts without dragging.** Hover a post for an up arrow, a down arrow and a topic dot in the
  space beside it. The arrows step the post one place (wrapping at the ends) with a slide animation;
  the dot opens a picker of the page's topics, in page order, so the post can be sent into another
  topic. The overlay takes the course's theme colour and never changes the page's own layout.
- **Editing stays visible.** Opening a post grows its scroll area by exactly the amount the post
  grew, so the whole post is visible.
- **Works in every class.** Enhancement is applied in any class, archived ones included. Entering
  Classwork never forces a page reload: the view mounts fresh, so its posts come from Classroom, and
  revisiting a class keeps its layout and does not fetch anything twice.

### To review: bulk select

- A checkbox on every assignment that can be marked reviewed, with **Select all** and a floating
  action bar.
- **Mark N as reviewed** clicks the same "Mark as reviewed" menu item you would click, one row at a
  time, then reports how many were marked.
- **Shift-click** selects a continuous range of rows; shift-clicking a checked row clears the range.
- Rows already reviewed, and the To-do sidebar, are never touched.

### Settings

Four switches in the popup, stored in `chrome.storage.sync`:

| Switch | Effect |
| --- | --- |
| **Scroll areas** | 5-post scroll windows, loading every post, centring the newest post, View all / View fewer. Off leaves Classwork exactly as Google renders it, with posts still behind "View more" |
| **Move overlay** | The up arrow, topic dot and down arrow beside each post |
| **Reverse order button** | The Reverse order button next to Google's "Collapse all" |
| **Bulk Select on To Review** | The checkboxes and action bar on the To review page |

Changing a switch refreshes any open Classroom tabs so the new layout is live immediately. A
Classwork feature that has never been switched on its own follows the old single **Classwork
Layout** setting, so an existing choice is kept.

## Scope and privacy

- Runs **only** on `https://classroom.google.com/*`, and only after you allow it. Site access is
  **optional**: nothing is requested or injected at install. Click **Enable on Google Classroom**
  on the welcome page or in the popup, and Chrome asks for that one site. The extension declares
  `storage` and `scripting` (to register the content script once access is granted); revoking the
  site in Chrome turns it off again.
- Home, Stream, Calendar, People and the To-do page are left exactly as Google renders them.
- No analytics, no accounts, no network requests, no remote code or fonts — everything ships in the
  package and runs locally. See [PRIVACY.md](PRIVACY.md).

## Install (developer mode)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this directory (the one containing `manifest.json`).
3. The welcome page opens: click **Enable on Google Classroom** and accept Chrome's prompt. The
   same button is in the popup if you skip it. Nothing is injected until you do this.
4. Open any Google Classroom **Classwork** page.

> Granting access reloads any Classroom tab that is already open, so the extension starts working
> without a manual refresh.

> After changing code, press the ⟳ reload button on the Classroom++ card, then refresh Classroom.

## Testing

```sh
sh tests/run.sh
```

Runs four headless-Chrome fixture suites and prints PASS/FAIL for each assertion:

| Fixture | Covers |
| --- | --- |
| `tests/classwork-fixture.html` | Windows, centring, drafts, View all/fewer, collapse anchoring, loading labels, class switches, parked views, the feature switches, the move overlay |
| `tests/to-review-fixture.html` | Bulk select, shift-range, select all, marking reviewed, the popup switch |
| `tests/stream-fixture.html` | Class Stream is never enhanced; parked Classwork views keep their layout |
| `tests/archived-classwork-fixture.html` | Archived class with no topics and no selected tab is still enhanced |

## Packaging for the Chrome Web Store

```sh
sh tools/package.sh     # -> dist/classroom-plus-plus-<version>.zip
```

The archive contains only runtime files (manifest, popup, background, onboarding, changelog,
icons, `src/`). Test fixtures, screenshots, developer docs and local Classroom captures are
excluded.

Submission copy, permission justifications, data-usage answers and the review checklist live in
[`store/listing.md`](store/listing.md).

## Files

| Path | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 definition, permissions, CSP |
| `background.js` | Content-script registration after access is granted, install/update lifecycle (defaults, welcome screen, changelog) |
| `src/content.js` | All page behaviour: detection, 5-post windows, loading, To review bulk select |
| `src/content.css` | Scoped styles for the windows, toggles, overlay and To review UI |
| `popup.html` / `popup.js` | The extension popup with the four switches |
| `onboarding.html` / `onboarding.js` | Welcome screen |
| `changelog.html` / `changelog.js` | Changelog |
| `icons/` | 16/32/48/128 px icons |
| `tests/` | Fixture suites and the runner |
| `tools/package.sh` | Builds the Web Store zip |
| `tools/make-icons.py` | Regenerates the icon set |

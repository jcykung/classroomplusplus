# Chrome Web Store submission kit

Copy-paste material for the Chrome Web Store developer dashboard, plus a packaging
script so the uploaded `.zip` contains only runtime files.

## Package

```sh
sh tools/package.sh          # builds dist/classroom-plus-plus-<version>.zip
```

The archive contains exactly the files the extension needs at runtime:
`manifest.json`, `background.js`, `popup.html`, `popup.js`, `onboarding.html`,
`onboarding.js`, `changelog.html`, `changelog.js`, `icons/` and `src/`. Tests, fixtures,
screenshots, `classroom-feed.html` and the developer docs stay out of the package.

## Store listing fields

**Name:** Classroom++

**Short description (132 chars max):**

```
Scrollable 5-post topic windows and a hover post mover on the Classroom Classwork tab, plus bulk select on To review.
```

**Category:** Education

**Language:** English

**Homepage URL:** https://github.com/jcykung/classroomplusplus
**Support URL:** https://github.com/jcykung/classroomplusplus/issues
**Privacy policy URL:** https://github.com/jcykung/classroomplusplus/blob/main/PRIVACY.md

**Detailed description:**

```
Classroom++ makes the Google Classroom Classwork tab easier to work with, and speeds up
end-of-term review.

CLASSWORK LAYOUT
• Each topic becomes its own scroll area that shows 5 posts at a time, so long topics no
  longer stretch the whole page.
• Every post is loaded up front — Classroom's hidden "View more" batches are fetched for
  you — and the newest published post is centred so the drafts you are about to post sit
  right next to it.
• "View all" / "View fewer" expands a topic in place.
• A "Reverse order" button next to Classroom's own "Collapse all" flips the order of posts
  in every topic.
• Hover any post for an up arrow, a down arrow and a topic dot beside it: step the post up or
  down (the ends wrap around) or send it to another topic from the dot's picker, with a slide
  animation instead of dragging.
• Every Classwork feature has its own switch — scroll areas, move overlay and the Reverse order
  button — so you can keep only the parts you want.
• Opening a post to edit it grows its scroll area by the same amount, so the whole post
  stays visible.
• Entering a class's Classwork never reloads the page — the view mounts fresh, so its posts
  load once — and coming back to that class keeps its layout and re-fetches nothing.

BULK SELECT ON TO REVIEW
• A checkbox on each assignment in To review, with "Select all" and a floating action bar.
• Mark a whole batch as reviewed in one pass, using the same menu item you would click
  yourself.
• Shift-click selects a continuous range of rows.
• The batch switches off with one toggle if you prefer the plain page.

PRIVACY
• No accounts, no analytics, no tracking, no ads, no network requests. Settings live in
  Chrome's own sync storage. Everything the extension does happens locally in the tab
  you are already viewing.
• You decide when it runs: Classroom++ requests no site access at install. Click "Enable on
  Google Classroom" once and Chrome asks for that one site; revoke it any time in Chrome.

Classroom++ is an independent project. It is not affiliated with, endorsed by, or
sponsored by Google. Google Classroom is a trademark of Google LLC.
```

## Single purpose statement

```
Classroom++ changes how the Google Classroom Classwork tab is laid out and speeds up
marking assignments reviewed. Everything it does serves that one purpose: presenting
Classroom's existing content in a more compact, navigable layout, and reducing repetitive
clicking when marking work reviewed.
```

## Permission justification

**`storage`**
```
Stores the user's display preferences (scroll areas on/off, move overlay on/off, reverse order
button on/off, bulk select on/off) in chrome.storage.sync. No personal data is stored.
```

**`scripting`**
```
Used only to add the content script to Google Classroom after the user grants access, and
to remove that registration if access is revoked. It never targets any other site.
```

**Optional host permission `https://classroom.google.com/*`**
```
The extension's entire function is to adjust Google Classroom's own pages, so the content
script must run there to lay out topic sections and to add the To review checkboxes. The
host is declared optional and is requested only from a user click on "Enable on Google
Classroom" in the popup or the welcome page — never at install, and never for any other
site. The same access lets the popup refresh open Classroom tabs so a settings change
takes effect immediately.
```

## Data usage answers (Privacy practices tab)

- Does the extension collect or use personal/sensitive user data? **No.**
- Does it sell data to third parties? **No.**
- Does it use data for purposes unrelated to its single purpose? **No.**
- Does it use data to determine creditworthiness? **No.**
- Remote code: **None.** All JavaScript, CSS and fonts are packaged with the extension;
  the manifest declares `script-src 'self'`.
- Certify compliance with the Developer Program Policies: **Yes.**

## Review checklist (what reviewers look for)

- [x] Manifest V3, no background page, no `eval`, no `new Function`, no inline scripts.
- [x] No remotely hosted code or assets — Google Fonts links were removed in favour of
      system fonts.
- [x] Permissions are the minimum needed: `storage`, `scripting`, and one optional Classroom
      host that is only requested from a user click. No site access at install.
- [x] Description matches what the extension actually does; single purpose is stated.
- [x] Users must click **Enable on Google Classroom** before anything is injected; the
      welcome page and popup both request the same optional host from that click.
- [x] Icons 16/32/48/128 present and valid PNG.
- [x] Privacy policy reachable, and the extension is not affiliated with Google (stated
      in the detailed description).
- [x] Extension works without any network access beyond classroom.google.com itself.
- [x] No student data is committed or shipped (the local `tests/to-review-snapshot.html`
      and `classroom-feed.html` reference captures are excluded from the package).

## Screenshots to prepare (1280×800 or 640×400)

1. Classwork tab with two scrollable topics and the Reverse order button.
2. A topic expanded with "View fewer" and a post open for editing.
3. The To review page with checkboxes and the floating action bar.
4. The extension popup showing the four settings.

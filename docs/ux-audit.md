# UX audit of Terminal Grid (V4 baseline)

Written by the worker at the start of the polish run (T2), from the "before" gallery in `docs/screens/before/`
(13 scenes × 1920×1080 and 1100×700, produced by `node tests/tools/scenes.js all --out docs/screens/before`)
plus a look at the code. This is the worker's own checklist: items are ticked (`[x]`) with the task that fixed them.
Screenshot names are `docs/screens/before/<scene>-<size>.png`. Contrast ratios were computed from `tokens.css` (WCAG formula).

## Topbar
- [x] **TB-1 · 14 controls in one 52px row, *(fixed in T6: 9 controls, no label-hiding media queries; checked at 900/1100/1280/1920/2560)* and labels disappear instead of the layout adapting.** At 1100px "PowerShell", "זוג סוכנים" and
  "ייבוא סוכנים" lose their text (media queries at 1500/1320/1080/640 in `responsive.css`) and become anonymous icons (plus, two people, download)
  whose meaning is only in a tooltip. See `grid-4-1100x700.png`. → T5 (split button), T6 (redesign).
- [x] **TB-2 · The font select is cut off at every width.** *(fixed in T6: removed from the topbar; font lives in settings, Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+wheel zoom)* "Cascadia (כמו Windows Te…" is truncated even at 1920, and select + A−/A+ spend
  ~190px of the most valuable row on something set once. → T4 (settings), T6 (remove).
- [ ] **TB-3 · No entry points for settings, search, shortcuts or help.** *(T4: gear button + Ctrl+, exist; palette T7, shortcuts T8 pending)* There is no gear, no palette, no shortcuts list; every preference lives
  in localStorage with no UI. → T3, T4, T7, T8.
- [x] **TB-4 · The brand mark looks like a button but is inert** *(fixed in T6: plain glyph without a box)*, and sits right next to the real sidebar toggle (two square icon buttons side by
  side in the top-end corner, the inert one teal). `empty-1920x1080.png`. → T6.
- [x] **TB-5 · The RTL-layer toggle is an unlabeled "align" icon** *(settings now explain it with a labelled switch; the topbar toggle stays as a one-click shortcut with its tooltip)* whose tooltip is a whole sentence; nobody can guess what it does. → T4 (switch with
  description in settings), T6 (keep a clear icon in the topbar).
- [ ] **TB-6 · The status summary is rewritten with `innerHTML` every 400 ms inside an `aria-live="polite"` region** (`status.js`), which makes
  screen readers re-announce it, and it disappears completely at ≤1240px. → T6.
- [x] **TB-7 · The folder chip shows only the folder's base name and a chevron.** *(T5/T6: the chip sits next to the New split button and the New menu shows the folder on its second line)* Nothing says it is "the folder of the NEXT terminal", and it
  sits apart from the New button it belongs to. → T5/T6 (put it next to the split button with a hint).

## Panes
- [ ] **PN-1 · The pane header is dense and has no menu.** Seven elements in 32px (status dot, kind icon, name, title, badge, expand, close);
  expand/close icons are 14px in muted grey; rename exists only as an undiscoverable double-click. `grid-4-1920x1080.png`. → T9.
- [ ] **PN-2 · An exited pane only gets a small red "הסתיים" badge and a dim line inside the terminal.** No restart, no close hint, no exit
  code in the UI. → T9.
- [ ] **PN-3 · Nothing shows which Alt+1…9 reaches which pane.** The mapping is invisible. → T8 (index badge or shortcut hint).
- [ ] **PN-4 · "ממתין לך" is assigned to any unfocused pane that printed anything** (`status.js`: `p.dirty && !isFocused`), so a build log looks
  identical to an agent asking a question. The attention model cannot separate "needs you" from "finished printing". → attention batch.
- [ ] **PN-5 · Tiles in the expanded layout are useless as thumbnails.** A 380px-wide scaled-down terminal renders at ~3px text, the tile
  header shows only the name, and five tiles cost ~20% of the width. `expanded-1920x1080.png`. → layouts batch (tile content: kind, status, last line).
- [ ] **PN-6 · Native Windows scrollbars with arrow buttons** *(T4: thin dark scrollbars app-wide; jump-to-bottom is T10)* show inside the terminals and the duo chat (small ▲▼ at the bottom/top end). They are
  unstyled and look unfinished; there is no "jump to bottom" either. `grid-4-1100x700.png`, `duo-board-1100x700.png`. → T10 + scrollbar styling.
- [ ] **PN-7 · A single wide pane at 1900px wastes the eye.** With the RTL layer, Claude's Hebrew text hugs the right edge while the input box
  stays at the left edge: ~1500px apart. `grid-1-1920x1080.png`. → layouts batch (max text width / centred column option).
- [ ] **PN-8 · The layout cannot be controlled.** Cells are computed automatically (1→1, 2→2 columns, 3→2+1 wide, 4→2×2…); no splitters, no presets,
  no way to keep two panes big and the rest small. → layouts batch.

## Sidebar
- [ ] **SB-1 · The sidebar is only a history of conversations.** There is no list of the terminals that are open right now; "open" is a small word
  in the time column. `side-open-1920x1080.png`. → "open terminals" sidebar task.
- [ ] **SB-2 · Metadata text fails contrast.** Relative times (11px), the parent-path line and the "אין עדיין…" hint use `--text-dim` (#626c84):
  3.51:1 on `--surface` and 3.28:1 on `--surface-2`, below AA (4.5:1) for small text. → T4/T6 tokens, polish batch.
- [ ] **SB-3 · The group header is crowded and the "+" is hidden.** Chevron, folder icon, name, count and a separate path line compete; the per-folder
  "new conversation" button has `opacity: 0` until hover, so it is undiscoverable (and invisible to touch).
- [ ] **SB-4 · The empty "זוגות סוכנים" section costs a header + hint before any conversation appears**, and the search field has no clear button.
- [ ] **SB-5 · A folder that no longer exists is just dimmed.** Its conversations do nothing when clicked except a toast; no inline explanation.

## Popovers and dialogs
- [ ] **PD-1 · Real bug: the duo dialog glues folder name and path together.** `shop-appC:\work\shop-app` — the two `<bdi>` elements have no gap.
  `duo-dialog-1920x1080.png`. → fix when the duo dialog is touched (polish batch; quick CSS fix).
- [ ] **PD-2 · Three different overlay patterns.** *(T5: menu.js is the shared menu; popovers/dialogs unification continues)* The folder and adopt popovers are `position: fixed` boxes whose coordinates are computed once at open
  (they do not follow a resize), focus does not move into them, there is no arrow-key navigation and no trap; the duo dialog is a real modal `<dialog>`.
  → T5 (`menu.js`) and a shared overlay approach.
- [ ] **PD-3 · The folder popover is a plain list.** No icons, the current folder differs only by a faint tint (no check mark), recents cannot be removed,
  and the pasted-path field gives no feedback until Enter. `folder-popover-1920x1080.png`.
- [ ] **PD-4 · The adopt popover puts "ייבא הכל" at the far end from its title, and the meaning of "import"** (it closes the agent in its old window)
  is only in a long tooltip. Two-step confirm is good but the first state gives no warning text. `adopt-popover-1920x1080.png`.
- [ ] **PD-5 · The duo dialog is 440px wide at 1920 with four stacked text blocks**, and its select/textarea styling differs from the popovers.

## Duo view
- [ ] **DV-1 · The empty duo screen has two "new pair" buttons.** A ghost "+ זוג חדש" floats in the top-end corner (looks disabled) and the card has the
  real one. `duo-empty-1920x1080.png`.
- [ ] **DV-2 · Duo terminals have headers with only name + dot** (no expand, close, restart), while the board column is ~580px wide and its chat ends
  at 55% of the height leaving a big void; the terminals show a single line each. `duo-board-1920x1080.png`. → agent-pair polish task.
- [ ] **DV-3 · At 1100×700 the chat list is ~220px tall** with native scrollbar arrows, the first message is clipped at the top and the composer
  placeholder wraps onto two lines. `duo-board-1100x700.png`.
- [ ] **DV-4 · The status chips ("ארכיטקט פנוי / עובד פנוי") use a lightning icon and a grey dot with no legend.**

## Empty state
- [ ] **ES-1 · The only hint is Alt+1…9, which does nothing while there are no terminals.** No recent folders, no "continue the last conversation",
  no list of the important shortcuts. `empty-1920x1080.png`. → T8, T7.
- [ ] **ES-2 · A 520px card in a 1920×1080 void;** the hint line is 12px dim text (3.7:1 on `--bg`).

## Global
- [x] **GL-1 · Settings live in localStorage, which is per origin.** *(fixed in T3: server-side settings.json)* Another port (dev instance, a different run) means every preference is lost, and
  the server cannot see them. → T3.
- [ ] **GL-2 · `index.html` loads Heebo from fonts.googleapis.com** *(T3: the stylesheet no longer blocks scripts; self-hosting is T19)* with a render-blocking stylesheet: offline or behind a firewall the first paint waits
  for a network timeout, and every open leaks a request. Self-host or fall back to local fonts. → polish batch.
- [ ] **GL-3 · A global `:focus-visible` outline exists (`base.css`) but parents with `overflow: hidden`** (pane header, `.seg`, tiles) can clip it, and
  there are only three component-level focus rules. Needs a pass per component. → polish batch.
- [ ] **GL-4 · Colours outside `tokens.css`.** `components.css` (3), `duo.css` (1), `panes.css` (1 + several `rgba(70, 227, 198, …)`) — blocks themes. → themes batch.
- [ ] **GL-5 · One theme only,** and the terminal palette is the fixed Campbell set in `constants.js`. → themes batch.
- [ ] **GL-6 · Error states are thin.** "claude not found" is only a tooltip on the New button; folder errors are toasts that vanish after 4s. → T5/T6.
- [ ] **GL-7 · No attention signals.** The window title gets "(n)" and that is all: no notification, sound or taskbar flash when an agent needs you. → attention batch.
- [ ] **GL-8 · Keyboard access is partial.** Header buttons are tabbable, but the terminal's textarea captures focus, there is no shortcut to move focus to
  the topbar or between panes except Alt+N, and no visible focus ring on the focused pane for keyboard users beyond the teal border. → T7, T8.
- [ ] **GL-9 · Responsive behaviour was never checked below ~1080px.** At 900px the topbar still fits but only because it drops the font select's label;
  `grid-4` at 900×700 shows panes of ~430px with wrapped PowerShell prompts. 2560px works but leaves the topbar controls tiny. → T6.

## Status at the end of the V4 run (T19)

Every item has a status: **fixed** (with the task), **partial**, **open** (not built tonight, see `docs/MORNING.md` for the order I would do them) or **rejected** (with the reason, from the product principles in `.duo/RULES.md`: fewer, calmer, no settings nobody opens).
"After" screenshots of every scene at 1920x1080 and 1100x700 are in `docs/screens/after/` (same names as `before/`).

| Item | Status | Task / reason |
|---|---|---|
| TB-1 controls and hidden labels | fixed | T6 |
| TB-2 font select cut off | fixed | T6 (moved to settings, zoom keys) |
| TB-3 entry points | partial | gear + Ctrl+, (T4), the "⋯" menu (T6); palette and cheat sheet (T7/T8) not built |
| TB-4 inert brand mark | fixed | T6 |
| TB-5 RTL toggle | fixed | T4/T6, quieter pressed style in T19 |
| TB-6 summary rewritten every 400 ms | fixed | T27: the summary and title are written only when the text changes; hidden at <=900 px by design (Alt+W works at every width) |
| TB-7 folder chip | fixed | T5/T6 |
| PN-1 dense pane header without menu | partial | T12: one clear status label; the pane menu (T9) is not built |
| PN-2 exited pane | partial | T12: red "הסתיים" label; restart/close actions (T9) not built |
| PN-3 Alt+N mapping invisible | open | T8 |
| PN-4 "waiting" for any unfocused output | fixed | T11/T12 (exact hook state; heuristic only as fallback) |
| PN-5 useless tiles | fixed | T27 |
| PN-6 scrollbars | partial | thin dark scrollbars (T4); "jump to bottom" (T10) not built |
| PN-7 single wide pane | open | layout batch not built |
| PN-8 layout control | open | T15 (splitters) not built |
| SB-1 open terminals list | open | T13 |
| SB-2 metadata contrast | fixed | T19: `--text-dim` 3.0-3.7:1 -> 4.7-5.9:1 on every surface token |
| SB-3 hidden "+" | fixed | T19: visible at 50 percent at rest, full on hover (the crowded header was left as is) |
| SB-4 empty pairs section / search clear | open | not built |
| SB-5 missing folder | open | not built |
| PD-1 duo dialog glued folder + path | fixed | T19 |
| PD-2 three overlay patterns | partial | T5 menu.js for menus; popovers and the dialog were not unified |
| PD-3 folder popover | open | not built |
| PD-4 adopt popover wording | open | not built |
| PD-5 duo dialog | open | not built |
| DV-1 two "new pair" buttons | open | T17 not built |
| DV-2 duo terminal headers | open | T17 not built |
| DV-3 chat height at 1100x700 | open | T17 not built |
| DV-4 status chips without legend | open | T17 not built |
| ES-1 empty state hint | open | T14 not built |
| ES-2 hint contrast | fixed | T19 (token); the card size was left as is |
| GL-1 settings in localStorage | fixed | T3 |
| GL-2 Google Fonts | fixed | T19: Heebo hebrew+latin 400-700 self-hosted (84 KB, OFL license in `public/fonts/`), no request leaves the machine (e2e check) |
| GL-3 focus rings clipped | open | not audited component by component |
| GL-4 colours outside tokens | rejected | only mattered for themes, which are rejected |
| GL-5 one theme only | rejected | product principle: no themes, no colour schemes, no light mode |
| GL-6 thin error states | open | not built |
| GL-7 no attention signals | fixed | T11/T12: exact states, summary button, favicon dot, opt-in desktop notifications |
| GL-8 keyboard access | partial | Alt+W added (T12); no palette (T7) or shortcut table (T8) |
| GL-9 responsive below 1080 px | fixed | T6 (checked 900/1100/1280/1920/2560) |

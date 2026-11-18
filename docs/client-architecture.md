# Client architecture

The UI is plain ES modules + plain CSS files served straight from `public/` (no build step, no framework).
The xterm libraries are classic `<script>` tags in `index.html` that define globals (`Terminal`, `FitAddon`,
`WebLinksAddon`, `Unicode11Addon`, `WebglAddon`); the modules use those globals. The only entry is
`<script type="module" src="/js/main.js">`.

## Modules (`public/js/`)

| Layer | Module | Responsibility |
|---|---|---|
| 0 | `constants.js` | font stack, terminal theme, font list, layout numbers |
| 0 | `util.js` | `basename`, `plural` |
| 0 | `dom.js` | `$` helper + the few elements several modules share (`stage`, `emptyEl`, `gridBtn`, `offlineEl`) |
| 0 | `icons.js` | inline SVG icons, `renderIcons()` fills every `[data-icon]` |
| 0 | `store.js` | `localStorage` wrapper (`tg.*` keys, never throws) |
| 0 | `rtl.js` | Hebrew right-alignment canvas layer for a Claude terminal (`attach(term, opts)`); no app imports |
| 0 | `hebrew-copy.js` | copy from a Claude pane in LOGICAL order (T67): `selectionText(term, kind)`, `logicalText`, `visualToLogical`, `isHebrewRow`; Claude sends Hebrew rows in visual order and the RTL layer only mirrors them for display |
| 0 | `rename.js` | inline rename editor shared by every named card (T56): `overlayRename(anchor, { value, onCommit })`, `isRenameKey` (F2) |
| 0 | `renderer-pool.js` | who paints: `pool.setRendering(pane, on)` hides the terminal host of a pane that is not visible (tile, parked agent-pair pane, hidden grid) and releases its WebGL context; at most 8 panes hold WebGL (most recently focused wins), the rest use the DOM renderer; `webglCount()` for tests. Logic is injectable and unit-tested |
| 0 | `favicon.js` | the tab icon: draws the canvas icon with an amber dot while any terminal waits (`setWaitingMark(n)`, redrawn only when waiting starts or stops) |
| 1 | `history-data.js` | saved conversations for the start screen: `fetchHistory()` (POST `/api/history` with a 3 s client cache and a shared in-flight request) and `recentSessions(history, n)` |
| 1 | `tile-preview.js` | the body of a tile: the last two readable output lines from the xterm buffer, refreshed twice a second and only when the text changed |
| 1 | `state.js` | the one shared mutable `state` object + the tiny event bus (`bus.on/emit`) |
| 1 | `toast.js` | corner notifications |
| 1 | `input-select.js` | Ctrl+A in the Claude input (T63): finds the typed text between the two rule lines, highlights it with `term.select`, copy/cut/delete (Delete x after the cursor then Backspace x before it, verified against the real Claude), passes Ctrl+A through when unsure |
| 2 | `connection.js` | WebSocket transport + message registry (`onMessage(type, fn)`, `send`, `connect`) |
| 2 | `adopt.js` | "bring an open agent in" popover |
| 2 | `links.js` | Ctrl+click only, web links only (T47): hover chip, `mailto:`/`file:` are copied, never opened |
| 2 | `duo/data.js` | agent pairs: the state that comes from the server, selection, current view (grid or pairs), `duoStatus`/`duoName` |
| 3 | `duo/ctx.js` | right-click menu of a pair (T57): rename, pause/resume, close |
| 4 | `duo/board.js` | the middle board of a pair: shared task list and chat, controls, the single calm alert banner (T65) |
| 5 | `duo/create.js` | the "new pair" dialog |
| 6 | `duo/list.js` | pairs in the side menu and the count on the top bar |
| 6 | `duo/view.js` | the one tab row for grid tabs AND pair tabs (T60, always visible since T68, Chrome-like with a "+" that opens an empty tab and no grid/pair switch since T69), the pair screen columns, pointer-drag and Alt+Shift+arrow reorder for both groups |
| 7 | `duo/index.js` | entry point of the pair feature (calls the `init*()` of the duo modules) |
| 3 | `settings.js` | settings mirror: `getSetting/setSetting/onSetting`, optimistic local write, debounced send to the server, one-time migration from localStorage |
| 3 | `layout.js` | grid/expanded layout (tiles do not render: see `renderer-pool.js`), focus, expand, and the view state synced to the server (`sendView`/`applyView`: grid tabs `{ tabs, active }`), `switchTab` (T60) |
| 3 | `launch.js` | server info, opening terminals (`openClaude`), working-folder popover (`setCwd`) |
| 2 | `menu.js` | shared popup menu: `openMenu({ anchor | point, items, onSelect, align, focus })` (keyboard, roving tabindex, flips inside the window, RTL-aware); `menu.css` |
| 4 | `new-menu.js` | the chevron of the split "Claude חדש" button: builds its menu (new Claude/PowerShell, pair, import, folder) |
| 4 | `fonts.js` | `fontStack()`, `installedFonts()`, applies font size/family to every terminal; zoom: Ctrl + `=`/`-`/`0` and Ctrl + wheel over a terminal |
| 4 | `more-menu.js` | the "⋯" topbar button: import agents, new pair, about dialog |
| 4 | `terminal-options.js` | line height, cursor style/blink, scrollback: initial xterm options + live apply |
| 2 | (panes.js, `startup` message) | start-up phase (T41): the server marks every new Claude terminal `startup: true` and broadcasts `{t:'startup', id, phase:'ready', why}`; `renderPaneMeta` shows/hides the opaque "מכין את Claude…" cover (`.pane-startup`, fade 150 ms), tiles show only the status text, `why:'timeout'` adds a quiet header label |
| 3 | `image-attach.js` | instant image paste/drop in Claude panes (T45): reads the image from the paste/drop event, uploads to `/api/paste-image`, `term.paste` of the quoted temp path (fallback: Alt+V), chip "מצרף תמונה…", drop hint, per-pane `images` list |
| 3 | `pending.js` | instant feedback for anything that waits for the server (T38): `addPending(reqId, label)` puts an "opening <label>…" card into the grid layout until `created` with the same reqId arrives (removed with a toast on an error or after 10 s), `busy(btn, text)` gives a button a spinner and restores it on error/timeout |
| 4 | `appearance.js` | style (ide/classic/paper) and accent colour: sets `data-style`/`data-accent` on `:root` (tokens.css does the rest), then feeds the terminal colours (`--term-*`) into the shared `THEME` and every open xterm; index.html applies the cached values before the first paint |
| 4 | `settings-ui/general-group.js` | the "כללי" group: `setAutostart(enabled)` (POST `/api/autostart`) and its note; the value `system.autostart` is virtual (the server reads it from the startup shortcut file) |
| 1 | `settings-ui/controls.js` | reusable settings widgets (switch, slider, number, select, segmented), each returns `{ el, set(v), focus() }` |
| 3 | `settings-ui/claude-group.js` | the "סוכני Claude" group: live note about running terminals and the "מה זה ומה מומלץ?" disclosure |
| 4 | `settings-ui/rows.js` | the declarative list of settings rows (one object per setting) |
| 5 | `settings-ui/panel.js` | the compact settings dialog (`rows.js` rows, `controls.js` widgets) |
| 5 | `tabs.js` | grid tabs (T60): `newTab`, `closeTab`, `moveToTab`, `reorderTabs`, `tabName`/`tabStatus` (the dot), tab and "move to tab" menus. The model is `state.tabs` in `state.js`; `state.order` / `focusId` / `expandedId` are getters of the ACTIVE tab, so every other module keeps working on "the current grid" |
| 4 | `pane-actions.js` | per-pane drag-to-swap, one-click close (`requestClose`, T55), rename (`beginRename`); announces `pane-menu` for the "⋯" button and the header right-click, and handles the exited overlay's restart button |
| 5 | `pane-menu.js` | the pane actions menu (rename, duplicate next to the original, restart for exited panes, copy folder path, reveal in Explorer, clear, expand/collapse, `/compact` for Claude panes, close): items per pane state, built on `menu.js` |
| 4 | `sidebar.js` | side menu: saved conversations grouped by project folder |
| 5 | `start-screen.js` | the screen shown when there are no terminals: primary "Claude חדש ב-<folder>", PowerShell, folder switch, the 4 newest conversations, 4 recent folders, skeleton only if the history is slow, "claude not found" message with a re-check; filled on the `empty-shown` event |
| 3 | `attention.js` | who needs you: `focusNextWaiting()` (summary button and Alt+W; approval first, then oldest finished, repeated calls cycle), desktop notifications (setting `ui.notifyWaiting`, only when the window is unfocused: needs approval, or finished after 20 s of work; tag per terminal), the one-time offer toast |
| 4 | `status.js` | one status per terminal (header label + class, from hook state or the old output-timing heuristic), summary button "N ממתינים לך", favicon mark, window title, hover title with time in state, "server closed" screen |
| 6 | `shortcuts.js` | Alt+1…9 (terminal N of the active tab), Ctrl+Alt+←/→ and Ctrl+Alt+1…9 (grid tabs), Alt+W, Ctrl+, and window focus |
| 4 | `toolbar.js` | grid button and the RTL layer toggle |
| 5 | `pane-terminal.js` | creates one xterm (addons; WebGL comes from `renderer-pool.js`) and the clipboard handlers |
| 6 | `panes.js` | creates/removes panes, pane header, list sync with the server, terminal messages |
| 7 | `main.js` | wiring only: calls every `init*()` in a fixed order and starts the connection |

(The layer number is the longest import chain below a module; `node tests/tools/check-imports.js` prints it.)

## Rules

1. **Imports point down.** A module may import from lower layers and from siblings that do not import it back.
   No cycles (`check-imports.js` fails on one). If a low module must trigger a higher one, emit an event with
   `bus.emit('name')` and let the higher module `bus.on('name', fn)` (current events: `connected`, `focus`, `expanded`, `agent-change` ({ pane, prev, prevSince, state }: a hook state change, listened to by `attention.js`), `empty-shown` (the start screen was just shown: `start-screen.js` loads its lists), `pane-menu` (pane, { anchor | point }: open the actions menu);
   the call is synchronous, so order of effects is the same as a direct call).
2. **Server messages go through the registry.** `connection.js` knows nothing about message meaning. A feature
   registers `onMessage('type', fn)` in its `init*()`; several handlers for one type run in registration order,
   which is the order of the `init*()` calls in `main.js` (e.g. `panes` handles `created` before `sidebar` refreshes).
3. **No work at import time except constants and element lookups.** Listeners, intervals and fetches live in `init*()`
   (called from `main.js`) so the order is explicit. Modules run deferred, so the DOM is ready when they load.
4. **No `window` globals.** Share through exports, `state` or `bus`.
5. **Keep ids, class names and storage keys stable** (tests and the user's browser profile rely on them):
   `tg.rtlLayer`, `tg.side`, `tg.sideCollapsed`, `tg.fontSize`, `tg.fontFamily`, `tg.cwd`, `tg.recents`. Since T3 the six that are settings
   (`rtlLayer`, `side`, `fontSize`, `fontFamily`, `cwd`, `recents`) are only a write-through **cache** (see "Settings flow"); the server is the truth.
6. Comments are Hebrew, identifiers English. Editing tools turn `\uXXXX` escapes into literal characters: for invisible
   characters (e.g. the ZWNJ in the window title) check the file afterwards.

## Settings flow (T3)

Preferences live on the server in `settings.json` (`TG_SETTINGS_FILE`, default next to `server.js`; `npm run dev` uses `.dev/settings.json`),
not in the browser: localStorage is per origin, so another port used to mean "all settings lost".

- **Schema** – `server/settings.js` has one declarative table (path like `terminal.fontSize`, type, default, min/max/enum, label id).
  `defaults()`, `normalize()` (drops unknown keys, clamps numbers, checks enums, limits string length) and `merge()` are derived from it, so a new
  setting is one row. The file is versioned (`v: 1`), written atomically (tmp + rename); a corrupt file is copied to `.bak` and defaults are used.
  `GET /api/settings` returns `{ settings, schema }` (the schema gives the UI its bounds and defaults).
- **Transport** – the client sends `{ t: 'settings:set', patch, rid }` over the WebSocket; the server validates, saves and broadcasts
  `{ t: 'settings', settings, rid }` to every window (also when nothing changed, so the sender can clear `rid`). The `list` message carries `settings`
  too, so a new window has them immediately.
- **Client** – `public/js/settings.js`: `getSetting(path)`, `setSetting(path, value)` (applied locally at once, sent after 200 ms),
  `onSetting(path, fn)` and the bus event `settings`. While requests are in flight, echoes are ignored until the last one returns, and values with a
  pending local change are never overwritten, so a fast slider does not flicker. `main.js` awaits `loadSettings()` before connecting.
- **First paint** – `settings` starts from `SETTINGS_FALLBACK` (constants.js) and the legacy `tg.*` cache; the server's answer replaces it.
- **Migration** – while the server says `migrated: false`, the first window to receive `list` sends what the old `tg.*` keys held with `migrate: true`;
  the server applies it once and sets `migrated: true`, later windows cannot overwrite.
- **Adding a setting** – a row in `SCHEMA` (and in `SETTINGS_FALLBACK` if it is needed before the server answers; `tests/server/settings.js` checks the two agree),
  then `onSetting('your.path', apply)` in the module that uses it.

## Settings panel (T4)

A small `<dialog id="settingsDlg">` in one column (no navigation, no search: there are only a handful of settings). Group "תצוגה" is always open
(font family, font size with a live sample, Hebrew alignment); group "מתקדם" is a disclosure, collapsed by default, whose state is the setting `ui.advancedOpen`
(line height, cursor style/blink, scrollback, and "איפוס כל ההגדרות" with a two-step confirm). Changes apply instantly and silently; there are no per-row reset icons (a switch is just clicked again), only the two-step "איפוס כל ההגדרות".
A row whose change needs the server (`apply` hook, e.g. autostart) flips at once, shows a small spinner beside the control, and flips back with an inline note on failure. Code in `public/js/settings-ui/`: `rows.js` (declarative `GROUPS` and `ROWS`: `{ id, group, label, description, control, path, options?, format?, unit?, sample? }`),
`controls.js` (reusable `createSwitch/Slider/Number/Select/Segmented`, each returns `{ el, set(v), focus() }`, ARIA and keyboard built in) and `panel.js` (builds once, opens/closes, focus restore).
Group "סוכני Claude" (T21): rows can be `stack: true` (control under the text), `number: true` (numeric select), `showWhen: { path, equals }` (visible only for a value of another setting) or `control: 'custom'` with a `build()` (notes and the collapsed explanation in `claude-group.js`).
**Adding a setting to the panel** = a schema row in `server/settings.js`, its fallback in `SETTINGS_FALLBACK`, and one object in `ROWS` (min/max/step come from the server schema);
apply it live with `onSetting(path, fn)` where it is used (`terminal-options.js` shows the pattern for xterm options). The panel opens from `#settingsBtn` and from the bus
event `open-settings` (Ctrl+, in `shortcuts.js`; the command palette will emit the same event).

## CSS (`public/css/`)

Linked from `index.html` in this order, which **is** the cascade order (a later rule wins at equal specificity):
`tokens` (font-face + variables) → `base` → `components` (buttons, chips, icon buttons) → `layout` → `topbar` → `panes` →
`empty-state` → `popovers` → `adopt` → `sidebar` → `rtl` → `overlays` (toasts, banner, dialog, "gone") → `settings` → `menu` → `responsive` (all media
queries, last on purpose). A new feature gets its own file placed before `responsive.css`.
Careful: `.icon-btn[aria-pressed]` must stay after `.icon-btn:hover`, and `responsive.css` must stay last.

## Adding a feature module (e.g. the agent-duo panel)

1. Create `public/js/duo.js` exporting `initDuo()`. Import only from lower layers (`state`, `dom`, `store`, `icons`, `toast`,
   `connection`, `layout`, …). Look up its own elements at module level with `$()`.
2. Put its markup in `index.html` (give elements ids/classes with a feature prefix) and its styles in `public/css/duo.css`,
   linked before `responsive.css`.
3. Talk to the server with `send({ t: 'duo:…' })` and `onMessage('duo:…', fn)` inside `initDuo()`. Keep per-feature state in
   the module (or a `state.duo` field if other modules must read it). Persist preferences with `store.get/set` (`tg.duo*`).
4. If it must react to something in a higher module, emit/listen on `bus` instead of importing.
5. Call `initDuo()` from `main.js` after `initPanes()` (message order), then run `node tests/tools/check-imports.js`.
6. Add an e2e test under `tests/e2e/` (see `controls.js` for the pattern: start a server on a free port, drive the page over CDP).

## Verification tools (`tests/tools/`, manual)

- `check-esm.js` – every module parses as an ES module. `check-imports.js` – imports resolve, no cycles, prints layers.
- `dump-dom.js dump <appDir> <out.json>` / `compare a.json b.json` – dumps every element's computed style, classes, attributes and
  text (with all hidden popovers/banners force-shown) and diffs two versions of the UI: the "zero visual change" proof for refactors.
- `shot.js <out.png> [empty|grid|side]` – a real screenshot (copy of the app with the side menu optionally open).
- `scenes.js [scene…] [--size WxH,…] [--out dir]` – named scenes (empty, grid-N, expanded, side-open, duo-*, popovers…) at several sizes against a fake-data server; scenes are registered in `scene-defs.js`. See `tests/README.md`.
- `verify-split.js <ref>` – one-off check used for the split of the old `app.js`/`rtl.js` (every old line still exists).

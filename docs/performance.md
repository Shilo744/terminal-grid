# Performance notes (T26, T27)

How typing latency and freezes were measured, what was changed, and what is still open. The box this ran on is shared and at 25-95 percent CPU from other programs, so single runs
swing a lot: compare medians and look at the spread, not at one number.

## Method
`node tests/tools/latency.js [--noisy 8] [--keys 60] [--label x] [--focus js|click]` starts N noisy terminals (`tests/fixtures/flood.js`: about 0.6 MB/s each of mixed ANSI colour and Hebrew) plus one "echo"
terminal, loads the page in headless Chrome (DOM renderer, below-normal priority like the whole test suite), types 60 real keystrokes (CDP `Input.dispatchKeyEvent`) into the echo terminal and records
keystroke-to-echo latency inside the page (from the real `keydown` event to the character appearing in the terminal DOM), main-thread long tasks (`PerformanceObserver` longtask) and the server event-loop delay
from `/api/health` (`monitorEventLoopDelay`; the histogram resolution is 10 ms, so a delay of about 10 ms is the floor). `tests/e2e/latency.js` is the light assertion version (4 noisy terminals, 25 keys, generous limits),
`tests/server/flush.js` checks that a flood arrives complete, in order and in messages of at most 64 KB.

## Numbers (8 noisy terminals, 60 keys, three runs each, same machine conditions)
| run | echo p50 ms | p95 ms | p99 ms | client long tasks | server loop delay p99 ms | server blocked (watchdog >200 ms) |
|---|---|---|---|---|---|---|
| before1 | 49.2 | 62.1 | 70.7 | 0 (max 0ms) | 19.12 | 0 (worst 0ms) |
| before2 | 48.2 | 79.5 | 167.4 | 0 (max 0ms) | 21.81 | 0 (worst 0ms) |
| before3 | 56 | 603.6 | 1082.2 | 5 (max 130ms) | 80.15 | 2 (worst 564ms) |
| **after** (batching + adaptive flush + rtl throttle) | | | | | | |
| afterjs1 | 65.4 | 352 | 363.4 | 13 (max 157ms) | 180.62 | 3 (worst 288ms) |
| afterjs2 | 44.4 | 55.4 | 56.9 | 0 (max 0ms) | 19.82 | 0 (worst 0ms) |
| afterjs3 | 48.1 | 134.7 | 220.3 | 2 (max 107ms) | 65.54 | 1 (worst 256ms) |

Reading: the medians of p50 are about the same (44-65 ms after, 48-56 before); the worst spikes (p95/p99 up to 600-1000 ms before, up to 350 ms after, one clean run at 55/57) overlap within the machine noise,
so **the numbers do not prove an improvement in latency**. What the changes do prove is less work per output byte: far fewer `term.write` calls on the page (one per frame per focused pane, one per ~100 ms for the others,
instead of one per server message), fewer and larger ws messages for background terminals (40 ms instead of 8 ms), a hard cap of 256 KB per flush tick and 64 KB per message so one noisy terminal cannot starve the loop for long,
and RTL redraws of background panes at most every 100 ms.

## What was changed
- **(a) client batching** (`panes.js`): incoming `data` is queued per pane and written once per animation frame for the focused pane or a pane typed into in the last 1.5 s, once per 100 ms for the rest;
  the queue is flushed before an exit message, dropped before a snapshot repaint, and flushed when focus moves to the pane or the user types in it. Order is kept, nothing is lost (`tests/server/flush.js`).
- **(b) server flush** (`server.js`): 8 ms for the focused pane (from the `view` message) or one typed into in the last 1.5 s, 40 ms for the others; at most 256 KB per tick (the rest goes to the next tick, after other events such as
  `input`), messages of at most 64 KB, `input` is handled immediately as before.
- **(c) rtl.js**: background panes redraw the Hebrew layer at most every 100 ms; the focused pane draws on every render as before (no flicker).
- **(g) watchdog and health** (`server/health.js`): `GET /api/health[?reset=1]` returns uptime, RSS, session and client counts, loop delay p50/p99/max and the watchdog counters; a loop blocked for more than 200 ms is logged in `server.log`.

## What the measurement showed about "freezes"
- The server watchdog reports blocks of 400-1700 ms during a 40000-line flood in `tests/server/flush.js`. A micro-benchmark of the headless terminal alone (1.2 MB in 8 KB writes) drains in 120 ms with at most 43 ms of loop lag,
  so the stalls are **not** parsing. The test servers run at below-normal priority on a machine that other programs keep at 60-95 percent CPU, so most of that is the OS not scheduling the process. The live app runs at normal priority.
  The watchdog is now in the server, so a real stall in the live app will show up in `server.log` with a timestamp.
- Clicking a pane when more than 4 terminals are open expands it and turns the others into scaled tiles (existing behaviour); with 8 noisy terminals that layout change produced dozens of long tasks (up to 500 ms) in the page.
  `--focus click` reproduces it. Reducing the cost of tile layout (hidden/tile panes should not pay for WebGL, see below) is the biggest remaining lever.

## T27: cheap tiles and parked panes (the biggest lag source)
**Cause.** With more than 4 terminals, clicking one expands it and the other 8 become *scaled live terminals*: each kept its own xterm renderer (WebGL context), repainted at full size and was only shrunk with a CSS transform. One click re-laid out and repainted nine terminals, and every busy tile kept doing it all the time.

**Fix.**
- A tile no longer renders. Its `.term-host` is `display: none` (xterm pauses painting, output still goes into its buffer) and its WebGL context is released. In its place the tile shows the status text and the last two readable output lines from the xterm buffer (`tile-preview.js`, twice a second, DOM written only when the text changed). Tiles are 76 px tall instead of a scaled copy of the main terminal, and their PTY is not resized.
- Expanding a tile shows the host again, re-measures it (`fit`), restores a WebGL context and redraws from the buffer (`term.refresh`), so the screen is current. Tested by reading the xterm buffer against the DOM (`tests/e2e/tiles.js`).
- Agent-pair panes parked in the hold container, and the whole grid while the pair view is open, are hidden and release their contexts the same way (`renderer-pool.js`).
- WebGL budget: at most 8 panes hold a context (`MAX_WEBGL`); when more are visible the most recently focused panes win and the rest use the DOM renderer. Unit-tested (`tests/unit/renderer-pool.js`); with a software GPU `tests/e2e/webgl-budget.js` checks the real count: 9 visible panes -> 8, expanded -> 1, back to the grid -> 8.
- (f) the 400 ms status tick builds the summary string and writes `innerHTML` / `document.title` only when it changed.
- (d) `/api/history` is asynchronous: `readdir`/`stat` through `fs.promises`, transcript parsing in 8 ms slices with a yield to the event loop in between, the result cached for 3 s and shared by concurrent requests; if the very first scan takes longer than 1.5 s the response is `partial: true` and the scan finishes in the background. `transcriptExists` has a cache ("yes" forever, "no" for 5 s) and an async variant for the restore path.

**Numbers** (`node tests/tools/latency.js --noisy 8 --focus click`, 60 keys, three runs each, same machine, one client click on the echo terminal like a real user):

| | echo p50 ms | p95 ms | p99 ms | client long tasks | longest task |
|---|---|---|---|---|---|
| before run 1 | 316.8 | 590.1 | 1379.3 | 79 (6331 ms total) | 357 ms |
| before run 2 | 618.3 | 917.4 | 969.3 | 76 (6704 ms) | 378 ms |
| before run 3 | 100.1 | 239.0 | 277.8 | 48 (3360 ms) | 348 ms |
| **before, median** | **316.8** | **590.1** | **969.3** | **76** | **357 ms** |
| after run 1 | 47.1 | 155.7 | 238.4 | 1 (59 ms total) | 59 ms |
| after run 2 | 56.7 | 215.2 | 243.9 | 2 (129 ms) | 72 ms |
| after run 3 | 70.3 | 224.5 | 453.1 | 4 (533 ms) | 219 ms |
| after run 4 | 46.9 | 129.9 | 211.7 | 2 (144 ms) | 87 ms |
| after run 5 (server starved, see below) | 72.1 | 1148 | 2809.9 | 5 (419 ms) | 139 ms |
| after run 6 | 46.5 | 258.1 | 546.1 | 0 | 0 |
| **after, median of 6** | **52** | **220** | **348** | **2** | **80 ms** |

Reading: long tasks per run went from 48-79 to 0-5 and the longest from 348-378 ms to 0-219 ms (5 of 6 runs stayed under 150 ms); typing latency in the focused terminal after a click is back to the 46-72 ms of the pre-click case (median p50 317 -> 52 ms). Run 5 is a machine artefact, not the page: its echo p95/p99 are 1.1/2.8 s with only 5 short client tasks, while the server watchdog logged 13 blocked loops (worst 1678 ms), i.e. the test server process was starved by other programs (the same pattern T26 described). Run 3 is the one run with a 219 ms task and is not explained beyond "the one-off re-layout of the expanded terminal on a busy machine".

**Server side, `tests/server/history.js`** (600 conversations of about 150 KB in 30 projects, run against the pre-T27 server with `APP_DIR=tests/.tmp/before-t27` and against the new one): before, one `/api/history` call blocked the event loop for **3.66 s** (watchdog: 1 block, worst 3661 ms; pings during the scan: worst 3686 ms); after, the same scan takes 1.2 s and the worst ping during it is **18 ms** (no block recorded); a second call within 3 s is answered from the cache in 6 ms.

## Not done (candidates, in the order I would do them)
- A single long task of 219 ms appeared in 1 of 6 runs after the change (run 3); the others stayed at 0-139 ms. Most likely the one-off re-layout and `fit` of the expanded terminal on a busy machine, but this is not proven.
- Freeze guard (back-pressure with xterm write callbacks for a flood or a huge paste) belongs to T18.

## Paste (T33)
**Question:** the user says pasting into a terminal takes several seconds. Where does the time go? `node tests/tools/paste.js [--sizes 1,20,100,500] [--runs 3]` pastes through the real client path (`term.paste(text)`, exactly what Ctrl+V does) into a terminal running `tests/fixtures/paste-echo.js` (a fake claude that enables bracketed paste, counts bytes and reports `PD <bytes> <first> <last> <sha1>`) and times the stages; the server logs `big input <id> <chars> chars, pty.write returned after <ms>` for every input of 8 KB or more.

| stage | 1 KB | 5 KB | 20 KB | 200 KB |
|---|---|---|---|---|
| (1) browser: `term.paste` -> websocket send | 0.4 ms | 0.2 ms | 0.5 ms | not measured |
| (2) server: `pty.write` returned | 0.2 ms | 0.2 ms | 0.1-0.2 ms | under 500 ms (checked by the test) |
| (3) ConPTY -> the program got the last byte | 0.2 s (page path, machine at 91 percent CPU) | 1.6 s (same conditions) | **0.96-1.05 s** (ws only, normal priority, no browser) | **13.9 s** (`tests/server/paste.js`, complete and in order) |
| (4) the echoed report visible in the xterm buffer | not measured cleanly (see below) | | | |

- **The whole wait is stage (3): ConPTY handing the input to the program, about 15-20 KB per second on this machine.** The browser (under 1 ms) and the server (`pty.write` returns in 0.1-0.2 ms, the data is queued by node-pty) are not the slow part. 200 KB is delivered complete and in order in about 14 s, the server stays responsive meanwhile (worst `/api/health` ping 14 ms over 442 pings) and a keystroke typed in another terminal during the paste is echoed after 0.75 s.
- **Hypothesis (a), chunked writes, was tested and rejected** (20 KB, ws to program, normal priority): one `pty.write` 1049 ms; 1 KB chunks with `setImmediate` 938 ms; 4 KB chunks 1114 ms; 512 B chunks with a 3 ms gap 1718 ms. Chunking does not change the ConPTY rate (and a gap makes it worse), so no chunking was kept. (b) T26's caps only shape OUTPUT (flush ticks) and do not touch input. (d) the right-click path: `navigator.clipboard.readText()` took 0.6 ms with the permission granted (the first use in a real browser shows Chrome's permission prompt, not measured here). The image path sends one 2-byte `ESC v` regardless of size.
- (c) the RTL layer and the headless parse of a huge echo were not the issue for a paste into a program that does not echo; the echo stage (4) could not be measured cleanly: the machine was at about 90 percent CPU in those runs and the harness browser runs at below-normal priority (a report took 60-165 s to appear in the page while the same report reached a websocket client at once), so numbers for stage (4) are omitted rather than guessed.
- **Targets not met, with the reason:** 20 KB delivered in under 300 ms (measured about 1 s) and 200 KB in under 1.5 s (measured about 14 s). The limit is inside ConPTY and the receiving program's console input, not in Terminal Grid; the receiving side of the measurement is a node program reading the console (libuv translates key events), a real Claude Code (a different runtime) may read faster or slower. Nothing in the server was changed except the `big input` log line; kept: the tool, the fixture and a regression test (`tests/server/paste.js`: 200 KB complete and in order, server responsive, another terminal still typeable).

## Start-up of a Claude terminal (T41)
The user's complaint: terminals "take long to load" after creating a pair and in the grid, and it looks strange to watch the trust dialog being answered. Two parts: **hide** the start-up behind one calm cover, and **shorten** the part that is ours. Measured with `node tests/tools/startup.js` (a fake `claude` that prints the real trust layout and then the main screen; the real Claude adds its own load time on top, so these numbers are only our share: server, screen polling, key presses). Median of 3 runs, milliseconds from the click on this machine:

| case | spawn | first byte | trust handled | ready |
|---|---|---|---|---|
| grid Claude, before (T32 polling: 250 ms, settle 400 ms) | 100 | 148 | 2744 | 3007 |
| resume, before | 101 | 148 | 2736 | 3030 |
| pair (both agents), before | 175 | | | 3469 |
| grid Claude, **after (T41: 100 ms, settle 150 ms)** | 102 | 149 | **2064** | **2357** |
| resume, after | 91 | 159 | 2083 | 2390 |
| pair (both agents), after | 206 | | | **2684** |

What the numbers say:
- **Trust handling is about 0.7 s faster** (polling every 100 ms instead of 250 ms, 150 ms settle instead of 400 ms; the Down press waits only for the marked line to move, in 50 ms steps). The T40 navigation (Down, then Enter) is included in both columns.
- **The pair starts both agents in parallel** already (`Duo.start` spawns the two terminals back to back, the pair costs +0.3 s over a single terminal, not 2x). The 250 ms stagger exists only in `restoreState` (after a server restart), never for a click.
- **The biggest block is outside our code: about 0.8 s for `powershell.exe` to start** (the terminal runs `powershell -NoLogo -NoExit -Command claude ...`). `-NoProfile` was measured and rejected: this machine has no PowerShell profile, and `powershell -NoLogo -NoProfile -Command exit` takes 806-872 ms against 800-1009 ms with the profile, so there is nothing to gain and it would change what the user's shell does after Claude exits. Left as is.
- The server's own share between the click and the spawn is about 100 ms (hook settings file write + `pty.spawn`).

The cover: every new Claude terminal (new, resume, restore, restart, adopt, both pair agents) is marked `startup: true` by the server and covered by an opaque layer "מכין את Claude…" until the first of: the SessionStart hook, the main prompt on screen (`? for shortcuts` or the `│ >` box), any dialog that needs a human (not the trust prompt), the process exiting, or 12 s (then a quiet "הטעינה לוקחת יותר מהרגיל" label in the pane header). The trust prompt is the only thing answered invisibly. Test hooks: `TG_STARTUP_TIMEOUT_MS`, `TG_STARTUP_QUIET_MS` (tests only: a fake claude without hooks or an input box counts as ready after that much silence; the test harness sets 1.2 s and 0.6 s).

## Scrolling (T52)
Two parts: a **visible defect** (both the Hebrew layer and the plain terminal showing while scrolling) and the **feel** of wheel / trackpad scrolling.

**1. Both RTL and LTR visible while scrolling (fixed).** Cause: the RTL layer is a canvas on top of the terminal. Only the focused pane redrew it on every xterm render; every other pane redrew at most once per 100 ms. In grid mode the pane under the wheel is usually not the focused one, so while it scrolled xterm already showed the NEW rows (left-aligned) over a canvas that still held the OLD mirrored rows, for up to 100 ms, again and again. Fix (`public/js/rtl.js`): `term.onScroll` marks the pane as hot for 300 ms, so every render in that time redraws the canvas in the same frame. Measured by `tests/e2e/rtl-scroll.js` (real wheel events on a pane that is not focused, at 60 Hz): **renders where the canvas showed other rows than the terminal: 60 of 60 before, 0 of 60 after.**

**2. Feel.** Method: `node tests/tools/scroll-perf.js` (5 cases, about 30 s, real CDP `mouseWheel` events at 60 Hz, 5000-line scrollback, headless Chrome with the DOM renderer, direction flips every 25 events). Frame times were never the problem on this machine, the steps were: xterm moved the view 3-4 lines per wheel event with no animation (stepped scrolling).

| case (before) | p50 ms | p95 ms | max ms | dropped (>33 ms) | max lines/frame | avg lines/frame |
|---|---|---|---|---|---|---|
| 1 pane, trackpad 40 px, RTL on | 16.7 | 16.7 | 16.8 | 0/474 | 4 | 3.1 |
| 1 pane, mouse notch 100 px, RTL on | 16.7 | 16.7 | 16.8 | 0/459 | 4 | 3.1 |
| 1 pane, trackpad, RTL off | 16.7 | 16.7 | 16.8 | 0/477 | 4 | 3.1 |
| 4 panes, trackpad, RTL on | 16.7 | 16.7 | 16.8 | 0/489 | 4 | 3.1 |
| 4 panes, mouse notch, RTL on | 16.7 | 16.7 | 100 | 2/501 | 4 | 3.1 |

| case (after) | p50 ms | p95 ms | max ms | dropped | max lines/frame | avg lines/frame |
|---|---|---|---|---|---|---|
| 1 pane, trackpad 40 px, RTL on | 16.7 | 16.7 | 16.8 | 0/583 | 2 | 1.1 |
| 1 pane, mouse notch 100 px, RTL on | 16.7 | 16.7 | 16.8 | 0/552 | 2 | 1.2 |
| 1 pane, trackpad, RTL off | 16.7 | 16.7 | 16.8 | 0/482 | 2 | 1.1 |
| 4 panes, trackpad, RTL on | 16.7 | 16.8 | 16.8 | 0/478 | 2 | 1.1 |
| 4 panes, mouse notch, RTL on | 16.7 | 16.7 | 16.8 | 0/476 | 2 | 1.1 |

Fix: xterm's `smoothScrollDuration` = 100 ms **only while the wheel is in use** (switched on by the first wheel event over a terminal, off 500 ms after the last one; `public/js/pane-terminal.js`). Always-on was tried first and rejected: xterm also animates programmatic scrolls, so following new output at the bottom lagged (viewport 40 lines short two frames after `scrollToBottom`) and the scroll restore after a renderer swap took many frames. `tests/e2e/scroll-smooth.js` pins both: at rest the option is 0, `scrollToLine`/`scrollToBottom` land within one frame, new output keeps the bottom followed, a view scrolled up is not dragged. No setting row. Wheel sensitivity was left at the xterm default (the numbers above show 3-4 lines per notch before, which is the usual terminal feel).

Typing latency (T26 tool, `latency.js --noisy 8 --focus click`) after the change: echo p50 42.9 / p95 51.4 / p99 54.8 ms, in the band of the T26 runs (p50 44-56 ms), no client long tasks.

Other surfaces: the side menu, settings dialog, board chat, task list and menus have no `backdrop-filter` and no scroll-linked work; the only thing missing was `overscroll-behavior: contain` (a wheel at the end of a list scrolled the page behind it), added in `public/css/menu.css`. Not measured with a frame recorder: those surfaces are plain overflow containers of text, and the terminal surface (heaviest) shows no dropped frames, so a measurement there would not drive a change. Not measured: the WebGL renderer (headless Chrome here has no GPU; the animation is a viewport scroll and does not depend on the renderer).

## Long text paste as a file (T53)
Measured with `tests/e2e/paste-text.js` (a fake Claude that counts the bytes and the time it receives; the page dispatches a real paste event with the text): a 200 KB paste into a Claude pane reaches the program as ONE 147-byte reference line **25 ms** after the paste event (limit 300 ms). The same data pasted the old way (Ctrl+Shift+V, 100 KB of text, 124 KB of bytes) took **5.5-6.1 seconds** to arrive, i.e. a 200 KB paste used to take about 11 seconds. ConPTY still limits shell panes and Ctrl+Shift+V (see "Paste" above); Claude panes no longer wait.

## Claude start-up cover (T72)
Measured with `tests/tools/startup-real.js` (real Claude Code v2.1.301 on port 7795, fresh state, 3 runs each, time from the create request until the "מכין את Claude…" cover lifts):

| case | before | after |
|---|---|---|
| idle machine | 3404 ms (ended by the hook; the input box was visible at 3406 ms) | 3253 ms (ended by the prompt on screen) |
| 8 CPU burners | 4637 ms | 3250 ms |

Claude itself needs about 3 s on an idle machine, so the idle gain is small. The change matters when the hook does not arrive: the cover used to wait for the 12 s timeout, now it ends when the real input box (labelled rule + `❯` + NBSP, `server/startup-detect.js`) is on screen. If a start-up really is slow, after 5 s the cover says "Claude מתחיל… N שניות" so it is clearly alive.

## Scrolling with the RTL layer on, and wheel sensitivity (T70)
**RTL layer cost** (`node tests/tools/scroll-perf.js`, now with a column "RTL draws (n / avg ms / max ms)" taken from `rtl.stats`; Hebrew-heavy scrollback, headless Chrome without a GPU, a continuous wheel at 60 Hz):

| case | p50 / p95 / max frame ms | dropped | RTL draws (n / avg / max ms) |
|---|---|---|---|
| 1 pane, trackpad, layer ON | 16.7 / 16.8 / 16.8 | 0/496 | 412 / 3.64 / 14.1 |
| 1 pane, mouse notch, layer ON | 16.7 / 16.8 / 16.8 | 0/483 | 415 / 3.64 / 7.6 |
| 1 pane, trackpad, layer OFF | 16.7 / 16.8 / 16.8 | 0/472 | 415 / 1.59 / 3.4 (the cost of clearing) |
| 4 panes, trackpad, layer ON | 16.7 / 16.7 / 16.8 | 0/476 | 417 / 1.68 / 3.4 |
| 4 panes, mouse notch, layer ON | 16.7 / 16.8 / 16.8 | 0/474 | 416 / 1.56 / 3.4 |

ON is within 20 percent of OFF at p95 (16.8 vs 16.8 ms), no frame over 50 ms and no long task, so no change to how the canvas is drawn was needed. What the numbers do show: one redraw of the biggest pane (1500x900, about 40 Hebrew rows) costs about 3.6 ms, 22 percent of a 60 Hz frame, so on a slower machine that is the first place to optimise (reuse row layouts per buffer line and translate the canvas by the scroll offset). The T52 ghosting fix (redraw in the same render while scrolling) stays.

**What changed that you can feel (T70):**
- Selecting in a mirrored Hebrew row no longer makes the text jump to the left: the row stays mirrored while selected, the highlight is painted on the canvas at the displayed place, and the mouse acts on what is displayed (drag, double-click a word, hover, Ctrl+click on a link) because the layer maps the pointer x back to the original cell before xterm sees it (`tests/e2e/rtl-select.js`, real mouse events).
- **Sensitivity** (`public/js/wheel.js`, `tests/unit/wheel.js`, `tests/e2e/wheel-sensitivity.js` with real wheel events): one mouse notch scrolls about 12 percent of the visible rows of THAT pane (min 3, max 12 lines), a trackpad or high-resolution delta scrolls its real pixel distance converted to lines with the remainder carried (a 3 px event moves 3 px worth in total, never a jump), Alt multiplies by 5. Measured lines per notch: 4-pane grid cell at 1100x700 (14 rows) 3, full pane at 1100x700 (32 rows) 4, full pane at 1920x1080 (56 rows) 7; font 11 (69 rows) 8, font 18 (43 rows) 5; Alt notch 35 lines; 60 events of 3 px = 11 lines at 16 px per line (180 px). Before, every wheel event moved 3-4 lines whatever the pane size.

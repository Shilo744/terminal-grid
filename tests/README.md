# Tests

Run everything: `npm test`. Only some: `npm test -- ui` (matches the file path), `npm run test:server`, `npm run test:e2e`.

| Folder | What it is |
|---|---|
| `server/` | Talks to a throw-away server over WebSocket/HTTP. No browser. |
| `unit/` | Pure logic in Node, no server and no browser (the agent state machine, hook-cli, the renderer pool and tile preview). |
| `e2e/` | Real headless Chrome (CDP) against a throw-away server. Measures the DOM and canvas pixels. |
| `fixtures/` | A fake `claude` on `PATH` (set by the harness): `bin-args` prints its arguments, `bin-heb` prints Claude-style Hebrew, `bin-env` its environment, `bin-agent` arguments + `TG_*` variables (hooks tests), `bin-ticker` a numbered line every 300 ms (tiles), `bin-flood` a flood (latency), `bin-duo` agent-pair agents. |
| `lib/harness.js` | Shared helpers (free port, start server, ws client, Chrome/CDP, PASS/FAIL). |
| `tools/` | Manual helpers (screenshots). Not run by `npm test`. |
| `.tmp/` | Scratch space (git-ignored). |

Every test starts its own server on a free port with its own state file and its own settings file (`TG_SETTINGS_FILE`, set by the harness), so nothing touches the real app, `state.json` or `settings.json`.

## Gotchas (all learned the hard way on this machine)

- **Never** spawn `powershell.exe` / `cmd.exe` from a test script and **never** `fs.cpSync` onto an existing directory: both hard-kill node with exit code 127 and no output. Create junctions with `fs.symlinkSync(target, link, 'junction')`; copy files with `copyFileSync`.
- CDP `Page.captureScreenshot` returns blank/partial frames here. Use `chromeScreenshot()` from the harness (`chrome --screenshot` with a virtual-time budget). Use CDP only to measure the DOM/canvas.
- A DOM assertion can pass while the page looks broken (a CSS class once collided with a full-screen overlay). For visual changes, look at a real screenshot.
- Headless Chrome flushes `localStorage` to disk only after ~5 s, so seeding a profile is unreliable; patch the default in a *copy* of the app instead.
- Real `claude` (not the fake) runs in the **alternate screen** and needs a trusted folder; tests that need the real thing are opt-in and not part of `npm test`.

## Tests never touch the real home folder (T43)
`tests/lib/harness.js` points `USERPROFILE`, `HOME`, `HOMEDRIVE` and `HOMEPATH` of the test process (and so of every test server it starts) at `tests/.tmp/home`, so `os.homedir()` and `process.env.USERPROFILE` inside a test are the temporary home. Why: a test once created a pair "in the home folder" and wrote fake `.duo\CHAT.md` and `TASKS.md` ("first thing", "done by the fake worker") into the user's real `C:\Users\<name>`, and other tests read the real `~/.claude`. Helpers: `fakeTranscript()` (a fake saved conversation for resume tests) and `seedHistory()` (fake projects and conversations for the side menu and start screen). Only Chrome gets the real home variables (it does not start without them; it writes only into its own temporary profile folder). `tests/run.js` starts every run with a clean temporary home and ends with a **home guard**: if `<real home>\.duo` (or a file in it) is newer than the start of the run, the run fails ("a test wrote into the user's real home"). `tests/unit/home-isolation.js` proves it end to end (a pair created in the "home folder" writes only into the temporary one).

## Test browsers cannot launch external apps (T50)
Chrome treats `mailto:` as "allowed without asking": navigating to it starts the PC's mail app at once. On this machine the `mailto` default points to a class that no longer exists, so such a launch opens Windows' "choose an app" window (`OpenWith.exe`) on the user's desktop, and it stays open. The Chrome preference `protocol_handler.excluded_schemes` cannot prevent it (`true` is ignored, `false` allows), there is no command-line switch for it, and Chrome policies on Windows live in the registry, which tests must not touch. So the block is in the page:
- `tests/lib/external-guard.js` is injected (CDP `Page.addScriptToEvaluateOnNewDocument`) before the first script of every page that `openPage` and `tests/tools/dump-dom.js` open. `window.open`, anchor clicks, form `submit()`/`requestSubmit()` and the Navigation API (`location.href = ...`) to anything but http/https/about/blob/data are cancelled and written to `window.__tgBlockedExternal`. `e2e/external-guard.js` proves each path with a scheme that does not exist (`x-tg-test:`), never with a real `mailto:`.
- A test must never navigate to `mailto:`/`ms-settings:`/... to "see what happens". Use `x-tg-test:`. `e2e/links.js` still asserts that the app's own seatbelt did the blocking (the guard's log stays empty).
- `tests/run.js` counts `OpenWith.exe` processes (`tasklist`) before, every 3 seconds during, and after the run. If the number grows it prints `TEST POPPED AN OS DIALOG` with the test files that were running, and the run fails. (A chooser window that you open yourself during a run is a false alarm.)
- (T58 changed the last two points: a NEW `OpenWith.exe` that appears during a run is now closed at once by its exact pid, and the run only fails if no running test declared it with `allowExternal`. See the next section.)

## Agents and tests may open things, they must close them (T58)
The user does not want agents blind ("if it cannot open things it will need me more"), only tidy: whatever an experiment opens is closed when the experiment ends, also on failure, timeout and Ctrl+C. Servers and helper processes count as much as windows.
- **Tracker** (`tests/lib/tracker.js`, used by `harness.startServer` and `harness.openPage`, so by every test and tool): each server and Chrome that is started is recorded by pid and image; an exit/SIGINT/SIGTERM handler closes them with their tree (`taskkill /PID <pid> /T /F`). Only exact pids that the experiment recorded itself (checked again against the image name, so a reused pid is never touched), plus **new** `OpenWith.exe` processes that were not running at the start. Never by name, never anything that was already running. `tasklist` is the only search, no powershell/wmic/cmd.
- **Why a registry too:** `tests/run.js` gives each run an id (`TG_TEST_RUN_ID`) and every test appends what it starts to `tests/.tmp/run-<id>/<pid>.jsonl`. A test that is hard-killed (the 15-minute timeout) cannot clean up, so `run.js` sweeps its file when it exits and once more at the end: a survivor is closed by exact pid and printed as `LEFTOVER: <test> left <image> pid <n>` plus a loud `===== LEFTOVERS` summary line (the run prints `leftovers: none` when clean). Note: processes that node spawns normally die with their parent (libuv puts children in a kill-on-close job); the leaks are programs started through the shell, windows and dialogs, and anything started with `detached` or by hand, which is what the sweep and the rule below are for.
- **Opting in:** a test that really needs to open something outside the page calls `await page.allowExternal(['mailto', 'file'], { reason: '...', images: ['notepad.exe'] })`. That lifts the T50 navigation guard for THAT page only, logs `ALLOWED EXTERNAL`, writes an opt-in marker for run.js and adds the listed images to the "new processes are closed at the end" list. Default stays blocked.
- **`OpenWith.exe` during `npm test`:** closed at once by exact pid; fails the run only when no running test had opted in (then the line says which tests were running). A window you open yourself in that exact moment would be closed too: do not open that dialog during a run.
- **Prove it:** `node tests/tools/open-close-proof.js` then `node tests/tools/open-close-proof.js --after` (separate processes) starts a server, two headless Chromes and a real `OpenWith.exe` window, exits without closing anything and shows with tasklist that all of it is gone afterwards and that nothing from before was touched. It opens a real window for a few seconds, so it is not part of `npm test`.
- **By hand (agents):** a server started with Bash/PowerShell (the 7795 dev instance, a fixture) is stopped by exact pid when the experiment is over (RULES 4b); the tracker cannot see what you start outside the harness.

## Real-Claude key check (T74/T75)
`node tests/tools/real-claude-keys.js [--on] [--images]` drives a REAL Claude Code through the real browser key path (CDP key events) on port 7795 with a fresh state file and real home; nothing is submitted. It prints what the input looks like after each key and saves screenshots to `tests/.tmp/real-keys/`. It exists because the fixture-only tests passed while the real screen differed (non-breaking space after the marker, a label on the rule). Everything it opens is closed by exact pid; it leaves tiny `.jsonl` stubs (200 bytes, no messages) in `~/.claude/projects/<this folder>` that should be deleted by exact name afterwards.

## Dev instance and safety rules

- `npm run dev` starts a **dev instance** for manual looking around: port **7795**, state in `.dev/state.json` (git-ignored), `TG_KEEP_ALIVE=1` so it does not shut itself down when no window is open. It prints the URL and its PID and does not open a browser. Settings live in `.dev/settings.json` (`TG_SETTINGS_FILE`). Override the port with `TG_DEV_PORT` (never 7791).
- Stop a dev instance with Ctrl+C, or by its **exact PID** (printed on start). Never kill node by name or pattern: other node servers on the machine must survive.
- **Port 7791 is the user's live app.** Never listen on it, connect to it, or run `start.ps1` against it. The one exception (T20) is checking the launcher by hand with `start.ps1 -Port 7795 -NoBrowser` (and stopping that exact PID afterwards); tests never run it. Tests always pick a free port themselves (`freePort()` in the harness).
- `TG_TEST_NO_CLAUDE=1` (server env) makes the server believe `claude` is not installed (the start-screen test).
- Autostart tests use `TG_TEST_STARTUP_DIR=<temp folder>` and `TG_TEST_AUTOSTART_STUB=1` (the server writes a JSON file instead of running PowerShell); they never touch the real Startup folder.
- `TG_AUTOTRUST=0` (server env) turns the folder-trust auto-accept off and `TG_TRUST_WINDOW_MS=<ms>` shortens its 45 s window (tests only; there is no setting for it); `tests/fixtures/bin-trust` is a fake `claude` that prints a trust prompt and counts the Enters it receives.
- Tests use the fake `claude` from `tests/fixtures`, never the real one, and never touch `~/.claude`, the registry or anything outside this folder (except the OS temp folder).

## Screenshot scenes (`tests/tools/scenes.js`)

`node tests/tools/scenes.js [scene ...] [--size 1920x1080,1100x700] [--out docs/screens/before]` renders named scenes (list and format: `tests/tools/scene-defs.js`).
Each scene gets its own throw-away server (fake `claude`, fake terminals, fixed fake history/open-agents data so no personal info appears) and a real Chrome
screenshot at every requested size. A new scene is `scene('name', { panes: [...], page: "await click('#someBtn')" })`. Gotchas it already handles:
- Headless Chrome is a real window with a frame: the page viewport is 22×98 px smaller than `--window-size`, and the screenshot is stretched afterwards, so layout measured by JS
  is wrong. The tool shows the app inside an `<iframe>` of exactly the requested size (the copy's `x-frame-options` header is removed; the real server is untouched).
- `String.replace` with `$$`/`$'` in the replacement corrupts injected code: use a function replacement.
- Headless Chrome stops painting after the last visible change, so a layout that waits for `requestAnimationFrame` never finishes; a 1px invisible animation keeps frames coming.
- Resizing a live PTY between two shots garbles its text: every size gets fresh terminals.
- On a loaded machine the first WebGL paint (and sometimes the whole stage) can be missing in a shot: always LOOK at the PNG and re-render that scene if the panes are blank (default settle is 2500 ms; `--disable-gpu` makes it worse, not better).

## Keeping the suite stable (T23)

- This machine is shared with other agents, so timing is the enemy: **never assert after a fixed `sleep`**. Wait for the real condition: `page.waitFor(jsExpression, ms)`, `page.appReady(minPanes)`
  (first sync done), `page.reload()` (waits for the load), `poll(fn, ms)` for ws/file conditions (all in `tests/lib/harness.js`). A fixed sleep is only right for a **negative** check ("nothing woke up").
- `node tests/tools/repeat.js <n> [filter]` runs the suite n times and prints a pass/fail table per file (a retry counts as a failure there); `npm test` retries a failed file once and says so.
- Windows can fail `rename` with EPERM when another process has the target open (the polling test itself, an antivirus, the indexer): server writes go through `server/atomic-write.js` which retries.

## Be a polite neighbour (T25)

The user types in other windows on this machine while tests run, and the tests share the CPU with everything else, so:
- Everything runs at **below-normal priority** (`tests/run.js` and `tests/lib/harness.js` call `os.setPriority`; children, i.e. test servers and Chrome, inherit it). `TG_TEST_NORMAL_PRIORITY=1` turns it off.
- e2e Chrome runs with **`--disable-gpu`** (xterm uses its DOM renderer, which the app supports) and a renderer limit: far cheaper than SwiftShader software WebGL. A test that really needs WebGL passes `openPage(url, { gpu: true })`
  (or set `TG_TEST_GPU=1` to run everything the old way). Only the screenshot tools use SwiftShader.
- While iterating run **only the affected files** (`npm test -- e2e/menu`) and `npm run test:quick` (server + unit tests, no Chrome, a few seconds; files marked `// @slow` in their first lines are skipped); the full `npm test` once per task.
- Never render all screenshot scenes at both sizes in normal work: name the scenes you changed.
- `npm test` prints wall time and the machine's average CPU during the run (against the background load measured before it), the flake count (`FLAKE: <file> passed on retry`), and cleans old Chrome profiles at start.

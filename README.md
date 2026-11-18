# Terminal Grid

A local multi-terminal grid for running several [Claude Code](https://claude.com/claude-code) agents side by side. It is a small Node.js server plus a browser UI: the server owns real terminals (node-pty), so refreshing or closing the window never kills your agents, and everything comes back when you reopen it.

Works on Windows, macOS and Linux. Developed and tested on Windows; the macOS/Linux code paths are written but not yet verified on real machines, so expect small fixes.

## Features

- Grid of terminals (Claude Code or a plain shell) with tabs; each tab has its own working folder.
- Terminals keep running in the background and are restored after a restart (Claude conversations resume).
- Agent pairs: a worker and a reviewer agent that hand tasks to each other through shared files.
- Pasting or dragging images, long-paste handling, Shift+Enter for a new line.
- Right-to-left (Hebrew) text layer and copy support. The UI itself is in Hebrew.
- Everything is local: the server listens on `127.0.0.1` only and checks the Origin of every request.

## Requirements

- Node.js 18 or newer
- Claude Code installed and on your `PATH` (`claude`), optional if you only want plain shells
- Chrome, Edge or Brave for the app-style window (otherwise your default browser is used)

## Run

```bash
npm ci
node start.mjs            # starts the server and opens the window
node start.mjs ~/project  # also opens a new terminal in that folder
```

Options: `--kind powershell` for a plain shell instead of Claude, `--port 7795` for a separate instance, `--no-browser` for no window.

On macOS you can also double-click `Terminal Grid.command` (run `chmod +x "Terminal Grid.command"` once). On Windows, `start.ps1` does the same and also raises an already open window.

You can also run the server directly: `npm start`, then open http://127.0.0.1:7791.

## Tests

```bash
npm run test:quick
```

## Layout

- `server.js`, `server/` — the server (terminals, state, agent pairs, platform layer in `server/platform.js`)
- `public/` — the browser UI (plain ES modules, xterm.js)
- `tests/` — unit, server and browser tests
- `docs/` — design notes (partly Hebrew)

## License

ISC

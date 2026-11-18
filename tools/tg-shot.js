#!/usr/bin/env node
'use strict';
// tg-shot: screenshot of a web page or a local HTML file, so an agent can SEE what it built. Part of the basic tools of Terminal Grid.
//   tg-shot <url | file.html> <out.png> [--size 1280x800] [--wait 1500] [--full] [--js "code"] [--scale 0.5]
//   --wait ms   how long to let the page run before the picture (default 1500)
//   --full      the whole page height, not only the first screen
//   --js code   JavaScript to run in the page first (click something, start a game, set a state), then a short pause
//   --scale n   shrink the picture (0.5 = half the size) when it is only for you to look at
// Then look at the PNG with your file-reading tool. Renders with the Electron that Terminal Grid itself uses (no browser to install).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const flagVal = (n, d) => { const i = argv.indexOf(n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (n) => { const i = argv.indexOf(n); if (i < 0) return false; argv.splice(i, 1); return true; };
if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(argv.length ? 0 : 1);
}
const size = /^(\d+)x(\d+)$/.exec(flagVal('--size', '1280x800') || '') || [0, 1280, 800];
const opts = {
  width: Number(size[1]), height: Number(size[2]), wait: Number(flagVal('--wait', 1500)), full: flag('--full'),
  js: flagVal('--js', ''), scale: Number(flagVal('--scale', 1)) || 1, console: flag('--console'), timeout: Number(flagVal('--timeout', 60)) || 60,
};
const [target, out] = argv;
if (!target || !out) { console.error('usage: tg-shot <url | file.html> <out.png> [--size 1280x800] [--wait ms] [--full] [--js code] [--scale n]'); process.exit(1); }
opts.out = path.resolve(out);
opts.url = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : require('url').pathToFileURL(path.resolve(target)).href;

const root = path.resolve(__dirname, '..');
const candidates = [
  process.env.TG_ELECTRON,
  path.join(root, '..', 'App', 'node_modules', 'electron', 'dist', 'electron.exe'),           // inside a release folder: Terminal Grid Versions\V5.x\tools -> Terminal Grid Versions\App
  path.join(root, '..', 'Terminal Grid Versions', 'App', 'node_modules', 'electron', 'dist', 'electron.exe'), // development folder
  path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
].filter(Boolean);
const electron = candidates.find((p) => fs.existsSync(p));
if (!electron) { console.error('tg-shot: the Electron of Terminal Grid was not found (set TG_ELECTRON to electron.exe)'); process.exit(2); }

const env = { ...process.env, TG_SHOT: JSON.stringify(opts) };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(electron, [path.join(__dirname, 'shot-main.js'), '--user-data-dir=' + path.join(os.tmpdir(), 'tg-shot-profile')], { env, encoding: 'utf8', windowsHide: true, timeout: (opts.timeout + 15) * 1000 });
if (r.stdout) process.stdout.write(r.stdout.split('\n').filter((l) => /^(saved|tg-shot|page error)/.test(l)).join('\n') + '\n');
if (r.stderr) process.stderr.write(r.stderr.split('\n').filter((l) => /^(tg-shot|page error)/.test(l)).join('\n') + '\n');
if (r.status !== 0 || !fs.existsSync(opts.out)) { console.error('tg-shot: failed'); process.exit(r.status || 1); }

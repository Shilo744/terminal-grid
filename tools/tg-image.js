#!/usr/bin/env node
'use strict';
// tg-image: generate a picture with the image generation of Codex CLI (OpenAI), for sprites, textures, backgrounds, icons, reference art. Part of the basic tools of Terminal Grid.
//   tg-image "<what to draw>" <out.png> [--timeout 300]
// Describe the picture precisely (subject, style, colours, background, size/aspect), and say if you need a transparent or plain background.
// It takes about 30-90 seconds and uses the user's Codex/OpenAI quota, so use it for what the task needs, not for decoration. Then look at the PNG with your file-reading tool.
// Needs the "codex" command (npm i -g @openai/codex) signed in once.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const flagVal = (n, d) => { const i = argv.indexOf(n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 7).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(argv.length ? 0 : 1);
}
const timeout = (Number(flagVal('--timeout', 300)) || 300) * 1000;
const [prompt, out] = argv;
if (!prompt || !out) { console.error('usage: tg-image "<what to draw>" <out.png>'); process.exit(1); }
const dest = path.resolve(out);

const genDir = path.join(os.homedir(), '.codex', 'generated_images');
const images = () => { const all = []; const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(png|jpe?g|webp)$/i.test(e.name)) { try { all.push({ p, t: fs.statSync(p).mtimeMs }); } catch { /* gone */ } } } }; walk(genDir); return all; };
const before = new Set(images().map((x) => x.p));
const started = Date.now() - 2000;

const wrapped = 'Use your image generation tool to create ONE image: ' + prompt + '\n\nJust generate it. Do not copy, move, save or edit files yourself and do not write code. When the image has been generated reply with the single word: done';
const run = spawnSync(process.platform === 'win32' ? 'codex.cmd' : 'codex', ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-'], { input: wrapped, cwd: os.tmpdir(), encoding: 'utf8', timeout, windowsHide: true, shell: process.platform === 'win32' });
if (run.error && run.error.code === 'ENOENT') { console.error('tg-image: the "codex" command was not found (npm i -g @openai/codex, then sign in)'); process.exit(2); }

const fresh = images().filter((x) => !before.has(x.p) && x.t >= started).sort((a, b) => b.t - a.t);
if (!fresh.length) {
  console.error('tg-image: no image was generated.' + (run.status ? ' codex exited with ' + run.status + '.' : '') + '\n' + String(run.stdout || run.stderr || '').split('\n').slice(-6).join('\n'));
  process.exit(1);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(fresh[0].p, dest);
console.log('saved ' + dest + ' (' + fs.statSync(dest).size + ' bytes, from ' + fresh[0].p + ')');

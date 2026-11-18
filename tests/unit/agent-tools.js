'use strict';
// The basic tools of Terminal Grid for the agents: tg-shot (screenshot of a page) and tg-image (picture from Codex CLI).
// Checks that the commands exist, print their help, refuse bad input, and that every agent is told about them. (Rendering itself needs Electron and is tried by hand.)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { checker } = require('../lib/harness');

const t = checker('agent tools (tg-shot, tg-image)');
const tools = path.resolve(__dirname, '..', '..', 'tools');
const run = (f, args) => spawnSync(process.execPath, [path.join(tools, f), ...args], { encoding: 'utf8', windowsHide: true });

for (const f of ['tg-shot.js', 'tg-image.js', 'shot-main.js', 'AGENT-TOOLS.md', path.join('bin', 'tg-shot.cmd'), path.join('bin', 'tg-image.cmd')]) t.check('tools/' + f + ' exists', fs.existsSync(path.join(tools, f)), '');
t.check('the .cmd wrappers call node on the script next to them', /node "%~dp0\.\.\\tg-shot\.js" %\*/.test(fs.readFileSync(path.join(tools, 'bin', 'tg-shot.cmd'), 'utf8')) && /node "%~dp0\.\.\\tg-image\.js" %\*/.test(fs.readFileSync(path.join(tools, 'bin', 'tg-image.cmd'), 'utf8')), '');

const h1 = run('tg-shot.js', ['--help']), h2 = run('tg-image.js', ['--help']);
t.check('tg-shot --help prints its usage', h1.status === 0 && /tg-shot <url \| file\.html> <out\.png>/.test(h1.stdout), h1.stdout + h1.stderr);
t.check('tg-image --help prints its usage', h2.status === 0 && /tg-image "<what to draw>" <out\.png>/.test(h2.stdout), h2.stdout + h2.stderr);
const bad = run('tg-shot.js', ['only-one-argument']);
t.check('tg-shot without an output file says so and fails', bad.status !== 0 && /usage: tg-shot/.test(bad.stderr), bad.stderr);
const bad2 = run('tg-image.js', ['a prompt only']);
t.check('tg-image without an output file says so and fails', bad2.status !== 0 && /usage: tg-image/.test(bad2.stderr), bad2.stderr);

const { PROMPTS } = require('../../server/duo/protocol');
for (const role of ['architect', 'worker']) t.check('the ' + role + ' prompt tells the agent about tg-shot and tg-image', /tg-shot/.test(PROMPTS[role]) && /tg-image/.test(PROMPTS[role]), '');

process.exit(t.finish() ? 0 : 1);

'use strict';
/*
 * T75/T74: manual check (NOT part of npm test) of the Claude input with the REAL browser key path and a REAL Claude Code.
 *   node tests/tools/real-claude-keys.js [--on]      --on = turn the Ctrl+A emulation on (it is off by default since T75)
 * Starts the dev server (server.js on port 7795 like scripts/dev.js, but with a fresh state file in tests/.tmp/real-keys/, real home and real claude), opens one headless Chrome, opens ONE Claude pane in this folder,
 * types, presses Ctrl+A and more through CDP key events, prints what the input and the selection look like after each step and saves screenshots to
 * tests/.tmp/real-keys/. Nothing is submitted (no Enter), so no conversation is written. Everything it opens is closed by exact pid at the end (tracker).
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { REAL_HOME, sleep, poll, connect, openPage, tracker, getJson } = require('../lib/harness');

const ON = process.argv.includes('--on');
const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 7795;
const OUT = path.join(__dirname, '..', '.tmp', 'real-keys');
fs.mkdirSync(OUT, { recursive: true });
const drive = path.parse(REAL_HOME).root.replace(/[\\/]+$/, '');
const realEnv = { ...process.env, USERPROFILE: REAL_HOME, HOME: REAL_HOME, HOMEDRIVE: drive, HOMEPATH: REAL_HOME.slice(drive.length), LOCALAPPDATA: process.env.TG_REAL_LOCALAPPDATA, APPDATA: process.env.TG_REAL_APPDATA };
delete realEnv.CLAUDE_CODE_CHILD_SESSION;

(async () => {
  for (const f of ['state.json', 'settings.json']) { try { fs.unlinkSync(path.join(OUT, f)); } catch { /* none */ } } // a fresh state: the dev state may restore old panes
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...realEnv, PORT: String(PORT), TG_STATE_FILE: path.join(OUT, 'state.json'), TG_SETTINGS_FILE: path.join(OUT, 'settings.json'), TG_KEEP_ALIVE: '1' }, stdio: 'ignore' });
  tracker.record(server.pid, 'node.exe', 'real-claude-keys dev server');
  for (let i = 0; i < 40; i++) { try { await getJson(`http://127.0.0.1:${PORT}/api/info`); break; } catch { await sleep(300); } }
  const keeper = await connect(PORT);
  const page = await openPage(`http://127.0.0.1:${PORT}/`, { width: 1300, height: 800 });
  const { ev } = page;
  await page.appReady(0);
  keeper.send({ t: 'create', kind: 'claude', cwd: ROOT, name: 'real' });
  await poll(() => keeper.sessions.size >= 1, 20000);
  const id = [...keeper.sessions.values()].find((x) => x.name === 'real').id;
  await page.appReady(1);
  await page.waitFor(`document.querySelector('.pane[data-id="${id}"] .pane-startup').hidden`, 60000);
  if (ON) await ev("import('/js/input-select.js').then((m) => { m.setInputSelectEnabled(true); return true; })");
  const IN = (code) => ev(`import('/js/state.js').then(async ({ state }) => { const m = await import('/js/input-select.js'); const term = state.panes.get('${id}').term; ${code} })`);
  const look = () => IN(`const r = m.findInput(term); const a = document.activeElement; return { input: r ? { rows: r.rows.map((x) => x.body), empty: r.empty, cy: r.cy, cx: r.cx } : null, rows: (() => { const b = term.buffer.active; const cur = b.baseY + b.cursorY; const out = []; for (let y = Math.max(0, cur - 6); y <= Math.min(b.length - 1, cur + 4); y++) { const t = b.getLine(y).translateToString(true); out.push(y + (y === cur ? '*' : ' ') + '|' + (t.length > 90 ? t.slice(0, 30) + '..' + t.slice(-50) : t)); } return { cursor: [b.cursorX, b.cursorY, b.baseY], cols: term.cols, out }; })(),
 selection: term.hasSelection() ? term.getSelection() : null, focus: a ? (a.className || a.tagName) : null, sent: (window.__sent || []).length, codes: (() => { const b = term.buffer.active; const t = b.getLine(b.baseY + b.cursorY).translateToString(true); return [...t.slice(0, 4)].map((c) => c.charCodeAt(0).toString(16)); })(), ruleTest: (() => { const b = term.buffer.active; const t = b.getLine(b.baseY + b.cursorY - 1).translateToString(true).trim(); return { len: t.length, tail: [...t.slice(-14)].map((c) => c.charCodeAt(0).toString(16)).join(' ') }; })() };`);
  await poll(async () => { const l = await look(); return l.input; }, 60000, 300);
  await ev(`window.__sent = []; import('/js/state.js').then(({ state }) => { state.panes.get('${id}').term.onData((d) => window.__sent.push(JSON.stringify(d).slice(0, 60))); return true; })`);
  const key = async (k, code, vk, modifiers = 0, text) => { await page.call('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) }); await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(250); };
  const typeText = async (s) => { for (const ch of s) await key(ch, 'Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), 0, ch); };
  const clearAll0 = async () => { await key('e', 'KeyE', 69, 2); for (let i = 0; i < 60; i++) await key('Backspace', 'Backspace', 8); await sleep(500); };
  const shot = async (name) => fs.writeFileSync(path.join(OUT, `${ON ? 'on' : 'off'}-${name}.png`), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  const say = async (label) => {
    await sleep(400);
    const l = await look();
    console.log(`--- ${label}\n  input=${JSON.stringify(l.input)} selection=${JSON.stringify(l.selection)} cursor=${JSON.stringify(l.rows.cursor)} sent=${l.sent}`);
    await shot(label.replace(/\W+/g, '-').slice(0, 40));
  };

  await ev(`import('/js/state.js').then(({ state }) => { state.panes.get('${id}').term.focus(); return true; })`);
  await say('1 empty input');
  await typeText('hello world');
  await say('2 typed hello world');
  await key('a', 'KeyA', 65, 2);
  await say('3 after Ctrl+A');
  await typeText('x');
  await say('4 after typing x');
  await key('Backspace', 'Backspace', 8);
  await say('5 after Backspace');
  await key('Escape', 'Escape', 27);
  await typeText('yz');
  await say('6 after Esc and typing yz');
  await key('a', 'KeyA', 65, 2);
  await key('ArrowLeft', 'ArrowLeft', 37);
  await typeText('q');
  await say('7 after Ctrl+A, Left, q');
  // clean the input without submitting: Ctrl+E then many Backspaces
  for (let i = 0; i < 40; i++) await key('Backspace', 'Backspace', 8);
  await say('8 cleaned');

  // ---- T74: image tokens. Paste the PATH of a real PNG (what the T45 paste/drop does) and see what the real input shows and how it deletes ----
  if (process.argv.includes('--images')) {
    const png = path.join(OUT, 'img.png');
    fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const pastePath = async () => { await ev(`import('/js/state.js').then(({ state }) => { state.panes.get('${id}').term.paste(${JSON.stringify('"' + png + '"')}); return true; })`); await sleep(1200); };
    const clearAll = clearAll0;
    await clearAll(); await say('B0 cleared');
    await pastePath(); await say('B1 pasted an image path');
    await key('Backspace', 'Backspace', 8); await say('B2 one Backspace after the token');
    await clearAll(); await pastePath(); await typeText('abc'); await say('B3 token + abc');
    for (let i = 0; i < 3; i++) await key('Backspace', 'Backspace', 8);
    await say('B4 three Backspaces (abc gone)');
    await key('Backspace', 'Backspace', 8); await say('B5 one more Backspace (the token?)');
    await clearAll(); await pastePath(); await key('a', 'KeyA', 65, 2); await say('B6 only a token, Ctrl+A');
    await key('Backspace', 'Backspace', 8); await say('B7 Backspace with the selection');
    await clearAll(); await typeText('hi '); await pastePath(); await typeText(' there'); await key('a', 'KeyA', 65, 2); await say('B8 text + token + text, Ctrl+A');
    await key('Backspace', 'Backspace', 8); await say('B9 Backspace with the selection');
    await clearAll();
  }
  // ---- a click on the terminal while highlighted, then typing ----
  await clearAll0();
  await typeText('abc def');
  await key('a', 'KeyA', 65, 2);
  await say('C1 typed abc def, Ctrl+A');
  const tr = await ev(`(() => { const b = document.querySelector('.pane[data-id="${id}"] .xterm-screen').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height - 60 }; })()`);
  await page.mouse('mousePressed', tr.x, tr.y); await page.mouse('mouseReleased', tr.x, tr.y);
  await sleep(300);
  await typeText('w');
  await say('C2 click on the terminal, then w');
  await clearAll0();
  // Hebrew keyboard layout: the key is a Hebrew letter, the physical key is still KeyA
  await typeText('abc');
  await key('ש', 'KeyA', 65, 2);
  await say('D1 Ctrl+A on the Hebrew layout (key ש, code KeyA)');
  await key('Backspace', 'Backspace', 8);
  await say('D2 Backspace');
  await clearAll0();
  await typeText('delete me'); await key('a', 'KeyA', 65, 2); await key('Delete', 'Delete', 46);
  await say('E1 Ctrl+A then Delete');
  await typeText('one'); await key('Enter', 'Enter', 13, 8 /* Shift */); await typeText('two'); await key('Enter', 'Enter', 13, 8); await typeText('three');
  await key('a', 'KeyA', 65, 2); await say('E2 three rows (Shift+Enter), Ctrl+A');
  await shot('E2-three-rows-highlighted');
  await key('x', 'KeyX', 88, 2); await say('E3 Ctrl+X');
  // focus outside the terminal (a click on the tab row), then Ctrl+A and typing: where do the keys go?
  const sentBefore = (await look()).sent;
  const r = await ev("(() => { const e = document.querySelector('.gtab'); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()");
  await page.mouse('mousePressed', r.x, r.y); await page.mouse('mouseReleased', r.x, r.y);
  await sleep(300);
  await key('a', 'KeyA', 65, 2);
  await sleep(500); console.log('focusId debug', JSON.stringify(await ev("import('/js/state.js').then(({ state }) => ({ focusId: state.focusId, has: state.panes.has(state.focusId), active: document.activeElement.className, tabs: state.tabs.map((t) => [t.id, t.focus, t.order]) }))")));
  const pageSel = await ev("({ selected: getSelection().toString().length, active: document.activeElement.className || document.activeElement.tagName })");
  await typeText('k');
  await sleep(600);
  const l9 = await look();
  console.log(`--- 9 click on the tab row, Ctrl+A, type k\n  page selection chars=${pageSel.selected} active=${pageSel.active} keys delivered to Claude=${l9.sent - sentBefore} lastSent=${JSON.stringify(await ev("window.__sent.slice(-3)"))} activeNow=${await ev("document.activeElement.className || document.activeElement.tagName")} input=${JSON.stringify(l9.input)}`);
  await shot('9-after-click-on-tab-ctrl-a');

  page.close(); keeper.close();
  tracker.killTree(server.pid);
  tracker.forget(server.pid);
  process.exit(0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

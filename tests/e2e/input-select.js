'use strict';
// @slow
/*
 * Ctrl+A in the Claude input (T63) with a fixture that draws the input like the REAL Claude Code v2.1.301 (borderless: rule, "❯ text", indented rows, rule, mode line;
 * and the older boxed style) and reacts like it (Backspace, Delete, Shift+Enter, Ctrl+A = start of line, arrows). Real key events through CDP.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('Ctrl+A selects the typed text in the Claude input');
  const shots = path.join(__dirname, '..', '..', 'docs', 'screens');
  const logA = path.join(TMP, 'input-select-a.log'), logB = path.join(TMP, 'input-select-b.log');
  for (const f of [logA, logB]) { try { fs.unlinkSync(f); } catch { /* none */ } }

  /* =============== בלי מסגרת (Claude האמיתי), עברית חזותית =============== */
  let srv = await startServer({ binDir: path.join(FIXTURES, 'bin-input'), env: { INPUT_VISUAL: '1', INPUT_LOG: logA } });
  let keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'cl' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'ps' });
  await poll(() => keeper.sessions.size === 2, 15000);
  let page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1100, height: 700 });
  await page.appReady(2);
  const ids = { cl: [...keeper.sessions.values()].find((s) => s.name === 'cl').id, ps: [...keeper.sessions.values()].find((s) => s.name === 'ps').id };
  await page.waitFor(`document.querySelector('.pane[data-id="${ids.cl}"] .pane-startup').hidden`, 15000);
  const IN = (code) => page.ev(`import('/js/state.js').then(async ({ state }) => { const m = await import('/js/input-select.js'); const term = state.panes.get('${ids.cl}').term; ${code} })`);
  const region = () => IN('const r = m.findInput(term); return r && { rows: r.rows.map((x) => x.body), cy: r.cy, cx: r.cx, empty: r.empty, text: m.inputText(r) };');
  const sel = () => IN('return term.hasSelection() ? term.getSelection() : null;');
  await poll(async () => { const r = await region(); return !!r; }, 15000, 100);
  await page.ev(`window.__clip = { writes: [] }; Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.resolve(''), writeText: (s) => { window.__clip.writes.push(s); return Promise.resolve(); } }, configurable: true }); true`);
  const writes = () => page.ev('window.__clip.writes');
  const key = (k, code, vk, modifiers = 0, text) => page.call('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) }).then(() => page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }));
  const ctrlA = () => key('a', 'KeyA', 65, 2);
  const focus = (id) => page.ev(`import('/js/state.js').then(({ state }) => { state.panes.get('${id}').term.focus(); return true; })`);
  const send = (d) => keeper.send({ t: 'input', id: ids.cl, d });
  const logged = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).join(''); } catch { return ''; } };
  const ctrlAs = (f) => (logged(f).match(/\u0001/g) || []).length;
  const settle = async (pred, ms = 5000) => !!(await poll(async () => pred(await region()), ms, 80));
  await focus(ids.cl);

  // T75: the emulation is switched OFF by one constant (users reported a dead input after Ctrl+A); the rest of this file turns it on to keep testing the code
  await page.ev("import('/js/input-select.js').then((m) => { m.setInputSelectEnabled(false); return true; })"); // the kill switch (INPUT_SELECT_ENABLED = false does the same for everyone)
  keeper.send({ t: 'input', id: ids.cl, d: 'abc' });
  await sleep(600);
  await page.ev(`import('/js/state.js').then(({ state }) => { state.panes.get('${ids.cl}').term.focus(); return true; })`);
  await page.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await sleep(500);
  const offLog = (() => { try { return fs.readFileSync(logA, 'utf8'); } catch { return ''; } })();
  const offSel = await page.ev(`import('/js/state.js').then(({ state }) => state.panes.get('${ids.cl}').term.hasSelection())`);
  t.check('T75 kill switch: with the emulation OFF Ctrl+A reaches the program and nothing is highlighted', offLog.includes('\\u0001') && offSel === false, offLog.slice(0, 80));
  keeper.send({ t: 'input', id: ids.cl, d: '\x05\x7f\x7f\x7f' }); // Ctrl+A moved the cursor to the start (readline): go to the end first
  await sleep(500);
  await page.ev("import('/js/input-select.js').then((m) => { m.setInputSelectEnabled(true); return true; })");
  await focus(ids.cl);

  /* ---------- תיבה ריקה: Ctrl+A עובר ל-Claude כמו שהוא ---------- */
  const e0 = await region();
  t.check('an empty input (the dim placeholder) is recognized as empty', !!e0 && e0.empty === true, JSON.stringify(e0));
  await ctrlA();
  await sleep(300);
  t.check('Ctrl+A on an empty input passes through to the program (readline: start of line), nothing is highlighted', (await sel()) === null && (await poll(() => ctrlAs(logA) === 2, 3000, 80)));

  /* ---------- שורה אחת ---------- */
  send('hello world');
  t.check('the typed text is found in the buffer', await settle((r) => r && !r.empty && r.rows.join('|') === 'hello world'));
  await ctrlA();
  t.check('Ctrl+A highlights exactly the typed text (no marker) with the normal selection', !!(await poll(async () => (await sel()) === 'hello world', 3000, 80)), JSON.stringify(await sel()));
  t.check('and it is NOT passed to the program (only the first two Ctrl+A reached it (one with the emulation off, one on an empty input))', ctrlAs(logA) === 2);
  await key('c', 'KeyC', 67, 2);
  await sleep(200);
  t.check('Ctrl+C with the highlight copies the typed text and clears the highlight', JSON.stringify(await writes()) === JSON.stringify(['hello world']) && (await sel()) === null);
  t.check('the input is untouched by copying', (await region()).text === 'hello world');
  await ctrlA(); await sleep(150);
  await key('Backspace', 'Backspace', 8, 0);
  t.check('Backspace with the highlight deletes ALL of it (the placeholder is back)', await settle((r) => r && r.empty === true));
  t.check('nothing was submitted and the highlight is gone', (await sel()) === null && !logged(logA).includes('\r'));

  /* ---------- כמה שורות, הסמן באמצע ---------- */
  send('line one\x1b\rline two is a bit longer\x1b\rthree');
  t.check('three rows are found', await settle((r) => r && r.rows.length === 3 && r.text === 'line one\nline two is a bit longer\nthree'));
  send('\x1b[A'); await sleep(150);
  for (let i = 0; i < 5; i++) { send('\x1b[C'); await sleep(40); }
  t.check('the cursor is in the middle of the second row (Up from the end of row three, then 5 to the right: column 10 of the text, checked in the buffer)', await settle((r) => r && r.cy === 1 && r.cx === 12), JSON.stringify(await region()));
  await ctrlA();
  const ms = await poll(async () => { const s = await sel(); return s && s.includes('line one') && s.includes('three') ? s : null; }, 3000, 80);
  t.check('Ctrl+A highlights all three rows', !!ms, JSON.stringify(ms));
  await sleep(300);
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(path.join(shots, 'T63-highlight.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await key('c', 'KeyC', 67, 2);
  await sleep(200);
  t.check('Ctrl+C copies the three typed lines as they are typed: line breaks kept, no marker, no indent', (await writes())[1] === 'line one\nline two is a bit longer\nthree', JSON.stringify(await writes()));
  await ctrlA(); await sleep(150);
  await key('Delete', 'Delete', 46, 0);
  t.check('Delete from the MIDDLE of the text empties all three rows (Delete for what follows the cursor, Backspace for what precedes it)', await settle((r) => r && r.empty === true));

  /* ---------- Ctrl+X, תו רגיל, ומקשים אחרים ---------- */
  send('cut me\x1b\rsecond');
  await settle((r) => r && r.rows.length === 2);
  await ctrlA(); await sleep(150);
  await key('x', 'KeyX', 88, 2);
  await sleep(300);
  t.check('Ctrl+X copies the typed text and deletes all of it', (await writes())[2] === 'cut me\nsecond' && (await settle((r) => r && r.empty === true)), JSON.stringify(await writes()));
  send('old text'); await settle((r) => r && r.rows[0] === 'old text');
  await ctrlA(); await sleep(150);
  await key('z', 'KeyZ', 90, 0, 'z');
  t.check('a printable key replaces the highlighted text', await settle((r) => r && r.text === 'z'), JSON.stringify(await region()));
  send('\x7f'); await settle((r) => r && r.empty);
  send('arrow test'); await settle((r) => r && r.rows[0] === 'arrow test');
  await ctrlA(); await sleep(150);
  await key('ArrowLeft', 'ArrowLeft', 37, 0);
  await sleep(250);
  t.check('an arrow key only clears the highlight and moves the cursor (the text stays)', (await sel()) === null && (await region()).text === 'arrow test' && logged(logA).includes('\u001b[D'));
  await ctrlA(); await sleep(150);
  await key('Escape', 'Escape', 27, 0);
  await sleep(250);
  t.check('Esc clears the highlight and acts normally', (await sel()) === null && (await region()).text === 'arrow test');
  await ctrlA(); await sleep(150);
  await key('Enter', 'Enter', 13, 0);
  t.check('Enter clears the highlight and submits as usual (the whole text arrives)', !!(await poll(async () => (await page.ev(`import('/js/state.js').then(({ state }) => { const b = state.panes.get('${ids.cl}').term.buffer.active; let s = ''; for (let y = 0; y < b.length; y++) s += b.getLine(y).translateToString(true) + ' '; return s; })`)).includes('SUBMITTED:"arrow test"'), 4000, 100)));
  const beforeClick = await region();
  send('click me'); await settle((r) => r && r.rows[0] === 'click me');
  await ctrlA(); await sleep(150);
  const box = await page.ev(`(() => { const b = document.querySelector('.pane[data-id="${ids.cl}"] .xterm-screen').getBoundingClientRect(); return { x: b.left + b.width - 40, y: b.top + 40 }; })()`);
  await page.mouse('mousePressed', box.x, box.y); await page.mouse('mouseReleased', box.x, box.y);
  await sleep(250);
  t.check('a mouse click clears the highlight (normal terminal behaviour)', (await sel()) === null);
  await key('Backspace', 'Backspace', 8, 0);
  await sleep(250);
  t.check('and after that Backspace is just a Backspace (only one character goes)', (await region()).text === 'click m', JSON.stringify(await region()));
  send('\x7f\x7f\x7f\x7f\x7f\x7f\x7f'); await settle((r) => r && r.empty);

  /* ---------- טקסט שנשבר, ועברית ---------- */
  const longText = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu again and again until it wraps';
  send(longText);
  t.check('a long line wraps into several rows in the buffer', await settle((r) => r && r.rows.length >= 2 && r.empty === false));
  await ctrlA();
  await poll(async () => (await sel()) !== null, 3000, 80);
  await key('c', 'KeyC', 67, 2);
  await sleep(200);
  const wrapped = (await writes())[3];
  t.check('a soft-wrapped line is copied as ONE line (the wrap is not a newline), words intact', wrapped === longText, JSON.stringify(wrapped));
  await ctrlA(); await sleep(150);
  await key('Backspace', 'Backspace', 8, 0);
  await settle((r) => r && r.empty);
  t.check('and deleting the wrapped text empties it', (await region()).empty === true);
  await page.ev(`import('/js/state.js').then(({ state }) => { state.panes.get('${ids.cl}').term.paste('שלום עולם, זו בדיקה של Terminal Grid'); return true; })`);
  await settle((r) => r && r.rows[0] && /[א-ת]/.test(r.rows[0]));
  t.check('Hebrew is drawn in visual order in the buffer (like Claude)', !(await region()).rows[0].startsWith('שלום'), JSON.stringify(await region()));
  await ctrlA(); await sleep(150);
  await key('c', 'KeyC', 67, 2);
  await sleep(200);
  t.check('Ctrl+C copies the Hebrew typed text in LOGICAL order (T67 conversion), English phrase intact', (await writes())[4] === 'שלום עולם, זו בדיקה של Terminal Grid', JSON.stringify(await writes()));
  await ctrlA(); await sleep(150);
  await key('Backspace', 'Backspace', 8, 0);
  await settle((r) => r && r.empty);

  /* ---------- T75 / T74: המקרים שדווחו (נבדקו גם מול Claude אמיתי עם tests/tools/real-claude-keys.js) ---------- */
  // מקלדת עברית: המקש הוא אות עברית, המקש הפיזי עדיין KeyA
  send('abc');
  await settle((r) => r && r.rows[0] === 'abc');
  await key('ש', 'KeyA', 65, 2);
  t.check('Hebrew keyboard layout: Ctrl+A (key ש, code KeyA) highlights the typed text', !!(await poll(async () => (await sel()) === 'abc', 3000, 80)), JSON.stringify(await sel()));
  await key('Backspace', 'Backspace', 8, 0);
  t.check('...and Backspace deletes it all', await settle((r) => r && r.empty === true));
  // מוצא מילוט: הטקסט השתנה בזמן שהוא מסומן: Backspace מוחק תו אחד כרגיל ולא את הטקסט החדש
  send('one two');
  await settle((r) => r && r.rows[0] === 'one two');
  await ctrlA();
  await poll(async () => (await sel()) !== null, 3000, 80);
  send('X');
  await settle((r) => r && r.rows[0] === 'one twoX');
  await key('Backspace', 'Backspace', 8, 0);
  await sleep(400);
  t.check('escape hatch: if the text changed under the highlight, Backspace is just one Backspace (nothing else is deleted) and the highlight is gone', (await region()).text === 'one two' && (await sel()) === null, JSON.stringify(await region()));
  send('\x05\x7f\x7f\x7f\x7f\x7f\x7f\x7f');
  await settle((r) => r && r.empty);
  // טוקן תמונה: נתיב של תמונה מודבק (כמו הדבקה/גרירה, T45), התיבה מציגה [Image #1]; Ctrl+A ו-Backspace מוחקים אותו, והרשימה של הפאן מתנקה
  const png = path.join(TMP, 'input-select-token.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await page.ev(`import('/js/state.js').then(({ state }) => { const p = state.panes.get('${ids.cl}'); p.images = [{ n: 1, path: ${JSON.stringify(png)}, name: 'x.png', size: 1, url: '' }, { n: 7, path: 'other', name: 'y.png', size: 1, url: '' }]; p.term.paste(${JSON.stringify('"' + png + '"')}); return true; })`);
  t.check('a pasted image path shows as a [Image #1] token in the input', await settle((r) => r && r.rows[0] === '[Image #1]'), JSON.stringify(await region()));
  await ctrlA();
  t.check('Ctrl+A with ONLY a token in the input highlights it', !!(await poll(async () => (await sel()) === '[Image #1]', 3000, 80)), JSON.stringify(await sel()));
  await key('Backspace', 'Backspace', 8, 0);
  t.check('Backspace deletes the token', await settle((r) => r && r.empty === true));
  t.check('and the pane image list drops that token (n=1) but keeps the other entry (n=7)', JSON.stringify(await page.ev(`import('/js/state.js').then(({ state }) => state.panes.get('${ids.cl}').images.map((i) => i.n))`)) === '[7]');
  send('hi ');
  await settle((r) => r && r.rows[0] === 'hi ');
  await page.ev(`import('/js/state.js').then(({ state }) => { state.panes.get('${ids.cl}').term.paste(${JSON.stringify('"' + png + '"')}); return true; })`);
  send(' there');
  await settle((r) => r && /^hi \[Image #\d+\] there$/.test(r.rows[0]));
  await ctrlA();
  await poll(async () => (await sel()) !== null, 3000, 80);
  await key('Backspace', 'Backspace', 8, 0);
  t.check('text + token + text: Ctrl+A and Backspace delete everything', await settle((r) => r && r.empty === true));
  // המיקוד מחוץ לטרמינל (לחיצה על לשונית): Ctrl+A לא בוחר את כל הדף, המיקוד חוזר לטרמינל וההקלדה מגיעה ל-Claude
  send('keep');
  await settle((r) => r && r.rows[0] === 'keep');
  const tab = await page.ev("(() => { const e = document.querySelector('.gtab'); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()");
  await page.mouse('mousePressed', tab.x, tab.y); await page.mouse('mouseReleased', tab.x, tab.y);
  await sleep(300);
  t.check('(setup) focus is on the tab row, outside the terminal', await page.ev("document.activeElement.classList.contains('gtab')"));
  await key('a', 'KeyA', 65, 2);
  await sleep(500);
  t.check('Ctrl+A outside the terminal does NOT select the whole page (that is what killed the typing line) and the focus returns to the terminal', (await page.ev("getSelection().toString().length")) === 0 && (await page.ev("document.activeElement.classList.contains('xterm-helper-textarea')")) === true);
  await key('k', 'KeyK', 75, 0, 'k');
  t.check('and the next typed key reaches Claude', await settle((r) => r && r.rows[0] === 'keepk'), JSON.stringify(await region()));
  send('\x7f\x7f\x7f\x7f\x7f');
  await settle((r) => r && r.empty);

  /* ---------- שומרים: דיאלוג אישור ופאן של מעטפת ---------- */
  send('typed while a permission prompt is open');
  await settle((r) => r && !r.empty);
  await page.ev(`import('/js/state.js').then(({ state }) => { const p = state.panes.get('${ids.cl}'); p.meta.agentSource = 'hooks'; p.meta.agentState = 'attention'; p.meta.agentSince = Date.now(); return true; })`);
  const before = ctrlAs(logA);
  await ctrlA();
  await sleep(300);
  t.check('while the agent waits for an approval (a dialog is open) Ctrl+A passes through untouched', (await sel()) === null && ctrlAs(logA) === before + 1);
  await page.ev(`import('/js/state.js').then(({ state }) => { const p = state.panes.get('${ids.cl}'); p.meta.agentState = 'idle'; return true; })`);
  await focus(ids.ps);
  await ctrlA();
  await sleep(300);
  t.check('a PowerShell pane is not touched by the feature (no highlight made by us)', !(await page.ev(`import('/js/state.js').then(({ state }) => { const t = state.panes.get('${ids.ps}').term; return t.hasSelection(); })`)));
  page.close(); keeper.close(); srv.stop();

  /* =============== הסגנון הישן, עם מסגרת =============== */
  srv = await startServer({ binDir: path.join(FIXTURES, 'bin-input'), env: { INPUT_BOXED: '1', INPUT_LOG: logB } });
  keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'cl' });
  await poll(() => keeper.sessions.size === 1, 15000);
  page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1100, height: 700 });
  await page.appReady(1);
  ids.cl = [...keeper.sessions.values()][0].id;
  await page.waitFor(`document.querySelector('.pane[data-id="${ids.cl}"] .pane-startup').hidden`, 15000);
  await poll(async () => !!(await region()), 15000, 100);
  await page.ev("import('/js/input-select.js').then((m) => { m.setInputSelectEnabled(true); return true; })"); // a new page starts with the emulation off
  await page.ev(`window.__clip = { writes: [] }; Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.resolve(''), writeText: (s) => { window.__clip.writes.push(s); return Promise.resolve(); } }, configurable: true }); true`);
  await focus(ids.cl);
  send('boxed text');
  await settle((r) => r && r.rows[0] === 'boxed text');
  await ctrlA();
  t.check('boxed style: Ctrl+A highlights the text without the borders and the marker', !!(await poll(async () => (await sel()) === 'boxed text', 3000, 80)), JSON.stringify(await sel()));
  await key('Backspace', 'Backspace', 8, 0);
  await settle((r) => r && r.empty);
  send('boxed text\x1b\rsecond row');
  t.check('boxed style: both rows found, borders and marker stripped', await settle((r) => r && r.rows.join('|') === 'boxed text|second row'), JSON.stringify(await region()));
  await ctrlA();
  await poll(async () => (await sel()) !== null, 3000, 80);
  await key('c', 'KeyC', 67, 2);
  await sleep(200);
  t.check('boxed style: Ctrl+C copies the typed text only (the highlight of a multi-row text in a box also covers the side borders between the rows; the copy does not)', (await writes())[0] === 'boxed text\nsecond row', JSON.stringify(await writes()));
  await ctrlA(); await sleep(150);
  await key('Backspace', 'Backspace', 8, 0);
  t.check('boxed style: Backspace empties it', await settle((r) => r && r.empty === true));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

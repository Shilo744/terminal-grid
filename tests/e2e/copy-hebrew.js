'use strict';
// T67: every copy path of a Claude terminal gives Hebrew in logical order (the buffer holds Claude's visual order); other panes copy as they are.
const path = require('path');
const { FIXTURES, sleep, checker, startServer, connect, openPage, poll } = require('../lib/harness');

const SENTENCE_1 = 'שרת V2 סגור, אבל יש חלון פתוח בלי שרת מחובר';
const SENTENCE_2 = 'אני מעביר אותו לחזית ומצלם מה שמוצג בפועל.';
const PHRASE = 'מחפש את חלון Terminal Grid כדי לצלם';

(async () => {
  const t = checker('copy Hebrew in logical order');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-heb'), env: { DEMO_COLS: '70' } });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'Kh' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'Ps' });
  await poll(() => keeper.sessions.size === 2, 20000);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1400, height: 800 });
  const { ev } = page;
  await page.appReady(2);
  const id = [...keeper.sessions.values()].find((s) => s.name === 'Kh').id;
  await page.waitFor(`import('/js/state.js').then(({ state }) => { const p = state.panes.get('${id}'); return !!p && p.term.buffer.active.baseY + p.term.buffer.active.cursorY > 15; })`, 30000);
  await ev(`window.__clip = { writes: [] }; Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.resolve(''), writeText: (s) => { window.__clip.writes.push(s); return Promise.resolve(); } }, configurable: true }); true`);
  const writes = () => ev('window.__clip.writes');
  const selectAll = () => ev(`import('/js/state.js').then(({ state }) => { const p = state.panes.get('${id}'); p.term.selectAll(); return p.term.getSelection().length; })`);
  const raw = await selectAll();
  t.check('the buffer really holds the visual (reversed) order: the logical sentence is NOT in the raw selection', raw > 200 && !(await ev(`import('/js/state.js').then(({ state }) => state.panes.get('${id}').term.getSelection().includes(${JSON.stringify(SENTENCE_1)}))`)));

  // Ctrl+C אמיתי עם בחירה
  await ev(`import('/js/state.js').then(({ state }) => { state.panes.get('${id}').term.focus(); return true; })`);
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 });
  await sleep(300);
  let w = await writes();
  const flat = (s) => String(s).replace(/\s+/g, ' ');
  t.check('Ctrl+C copies the first sentence in logical order (wrapped rows joined, "V2" intact)', w.length === 1 && flat(w[0]).includes(SENTENCE_1), JSON.stringify(w).slice(0, 600));
  t.check('...and the second sentence', w.length === 1 && flat(w[0]).includes(SENTENCE_2), JSON.stringify(w).slice(0, 600));
  t.check('...and an English phrase inside Hebrew keeps its word order ("Terminal Grid")', w.length === 1 && flat(w[0]).includes(PHRASE), JSON.stringify(w).slice(0, 600));
  t.check('...and the parenthesised file name row and the bullet rows are converted too', w.length === 1 && flat(w[0]).includes('הקובץ (app.js) נשמר בתיקייה') && w[0].includes('- פריט ראשון ברשימה'), JSON.stringify(w[0]).slice(0, 900));
  t.check('one line separator throughout (no mixed \\r\\n and \\n)', w.length === 1 && !/[^\r]\n/.test(w[0]) && w[0].includes('\r\n'), JSON.stringify(w[0]).slice(0, 200));
  t.check('the English row stays exactly as it is', w.length === 1 && w[0].includes('L  src/server.js (English only, must stay on the left)'));

  // תפריט הקליק הימני > העתקה
  await selectAll();
  const r = await ev(`(() => { const b = document.querySelector('.pane[data-id="${id}"] .pane-body').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + 80 }; })()`);
  await page.mouse('mouseMoved', r.x, r.y);
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'right', buttons: 2, clickCount: 1 });
  await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(300);
  await ev(`document.querySelector('.menu [data-id="copy"]').click(); true`);
  await sleep(300);
  w = await writes();
  t.check('the right-click menu "copy" gives the same logical text', w.length === 2 && flat(w[1]).includes(SENTENCE_1) && flat(w[1]).includes(PHRASE), JSON.stringify(w[1] || '').slice(0, 400));

  // אותו טקסט בפאן של מעטפת נשאר כמו שהוא (בחוצץ שלו הסדר לוגי)
  const sh = await ev(`import('/js/state.js').then(({ state }) => { const p = [...state.panes.values()].find((x) => x.meta.kind === 'powershell'); p.term.write('ןחבמ ףוס\\r\\n'); return new Promise((r) => setTimeout(() => { p.term.focus(); p.term.selectAll(); r(p.term.getSelection()); }, 300)); })`);
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 });
  await sleep(300);
  w = await writes();
  t.check('a shell pane copies its selection exactly as it is (the converter is for Claude panes only)', w.length === 3 && w[2] === sh && sh.includes('ןחבמ ףוס'), JSON.stringify(w[2] || '').slice(0, 200));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

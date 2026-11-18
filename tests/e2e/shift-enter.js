'use strict';
// @slow
/*
 * Shift+Enter = שורה חדשה בתיבת הקלט של Claude (T54). המשתמש לוחץ Shift+Enter; מה שנשלח לתוכנית הוא ESC+CR (1b 0d), כמו Alt+Enter.
 *  - בבתים אמיתיים (CDP, ConPTY, תוכנית מדומה שמדפיסה בהקסה מה שקיבלה): עברית, Shift+Enter, Enter, אות, Shift+Enter -> d7a9 d79c d795 d79d, 1b0d, 0d, 78, 1b0d;
 *  - ההיגיון עצמו (מקש אחר מקש): רק פאן Claude, רק Shift בלי Ctrl/Alt/Meta, לא בקלט IME, keydown שולח פעם אחת ו-keypress לא שולח כלום;
 *  - תיבת ההודעה בלוח הזוג: Shift+Enter לא נשלחת (נשארת שורה חדשה רגילה), Enter כן נשלחת.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, strip, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('Shift+Enter: new line in the Claude input');

  /* ---------- בתים אמיתיים ---------- */
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-keys') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'keys' });
  await poll(() => keeper.sessions.size === 1, 15000);
  const id = [...keeper.sessions.values()][0].id;
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1300, height: 700 });
  const { ev } = page;
  await page.appReady(1);
  await page.waitFor(`document.querySelector('.pane-startup').hidden`, 15000);
  await poll(() => /KEYS-FIXTURE ready/.test(strip(keeper.out.get(id) || '')), 15000);
  await ev(`document.querySelector('.pane .xterm-helper-textarea').focus(); true`);
  const enter = async (shift) => {
    const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: shift ? 8 : 0, text: '\r' };
    await page.call('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: shift ? 8 : 0 });
    await sleep(250);
  };
  await page.call('Input.insertText', { text: 'שלום' }); // מקלדת עברית: התווים מגיעים כטקסט, Enter מזוהה לפי e.key ולא לפי פריסה
  await sleep(250);
  await enter(true);
  await enter(false);
  await page.call('Input.insertText', { text: 'x' });
  await sleep(250);
  await enter(true);
  await sleep(500);
  const bytes = () => [...strip(keeper.out.get(id) || '').matchAll(/KEYS ((?:[0-9a-f]{2} ?)+)/g)].map((m) => m[1].trim()).join(' ');
  const got = bytes();
  t.check('Hebrew, Shift+Enter, Enter, x, Shift+Enter arrive as d7a9 d79c d795 d79d, 1b 0d, 0d, 78, 1b 0d (Shift+Enter once, never also a plain 0d)', got === 'd7 a9 d7 9c d7 95 d7 9d 1b 0d 0d 78 1b 0d', got);

  /* ---------- ההיגיון, מקש אחר מקש ---------- */
  const logic = await ev(`(async () => {
    const { wireClipboard } = await import('/js/pane-terminal.js');
    const run = (kind, ev) => {
      const pane = document.createElement('section'); pane.className = 'pane'; const host = document.createElement('div'); pane.appendChild(host);
      const term = { sent: [], h: null, attachCustomKeyEventHandler(h) { this.h = h; }, input(d) { this.sent.push(d); }, hasSelection: () => false };
      wireClipboard(term, host, { kind });
      let prevented = 0;
      const e = { type: 'keydown', key: 'Enter', code: 'Enter', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, preventDefault() { prevented++; }, ...ev };
      const r = term.h(e);
      return { r, sent: term.sent.join('|').replace(/\\x1b/g, 'ESC').replace(/\\r/g, 'CR'), prevented };
    };
    return {
      shift: run('claude', { shiftKey: true }),
      shiftPress: run('claude', { shiftKey: true, type: 'keypress' }),
      plain: run('claude', {}),
      ctrlShift: run('claude', { shiftKey: true, ctrlKey: true }),
      altShift: run('claude', { shiftKey: true, altKey: true }),
      metaShift: run('claude', { shiftKey: true, metaKey: true }),
      ime: run('claude', { shiftKey: true, isComposing: true }),
      shell: run('powershell', { shiftKey: true }),
      hebrewLayoutKey: run('claude', { shiftKey: true, code: 'Enter', key: 'Enter' }),
    };
  })()`);
  t.check('Shift+Enter in a Claude pane: handled (false), sends ESC+CR once, default prevented', logic.shift.r === false && logic.shift.sent === 'ESCCR' && logic.shift.prevented === 1, JSON.stringify(logic.shift));
  t.check('the keypress after it is swallowed without sending anything (nothing is sent twice)', logic.shiftPress.r === false && logic.shiftPress.sent === '' && logic.shiftPress.prevented === 0, JSON.stringify(logic.shiftPress));
  t.check('plain Enter, Ctrl+Shift+Enter, Alt+Shift+Enter and Meta+Shift+Enter are left to xterm as before', [logic.plain, logic.ctrlShift, logic.altShift, logic.metaShift].every((x) => x.r === true && x.sent === '' && x.prevented === 0), JSON.stringify([logic.plain, logic.ctrlShift, logic.altShift, logic.metaShift]));
  t.check('IME composition is never touched', logic.ime.r === true && logic.ime.sent === '', JSON.stringify(logic.ime));
  t.check('a shell pane keeps Shift+Enter exactly as it was', logic.shell.r === true && logic.shell.sent === '' && logic.shell.prevented === 0, JSON.stringify(logic.shell));
  t.check('the key is matched by e.key, so it works with the Hebrew layout too', logic.hebrewLayoutKey.r === false && logic.hebrewLayoutKey.sent === 'ESCCR');
  t.check('the start screen tells where to find it (shortcut hint)', await ev(`/Shift/.test(document.querySelector('#empty .hint').textContent) && /שורה חדשה/.test(document.querySelector('#empty .hint').textContent)`));
  t.check('no JavaScript errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();
  await sleep(500);

  /* ---------- תיבת ההודעה בלוח הזוג ---------- */
  const srv2 = await startServer({ binDir: path.join(FIXTURES, 'bin-duo') });
  const k2 = await connect(srv2.port);
  const project = path.join(TMP, 'shift-enter-duo');
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n');
  fs.writeFileSync(path.join(project, '.duo', 'CHAT.md'), '\n### architect · 09:00\nHi.\n');
  k2.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 's1' });
  const created = await poll(() => k2.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  k2.send({ t: 'duo', op: 'pause', duoId: created.duoId });
  const page2 = await openPage(`http://127.0.0.1:${srv2.port}/`, { width: 1300, height: 700 });
  await page2.appReady(0);
  await page2.ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await page2.waitFor(`!!document.querySelector('.db-compose textarea')`, 20000);
  const box = await page2.ev(`(() => { const ta = document.querySelector('.db-compose textarea'); ta.value = 'שורה אחת';
    const mk = (shiftKey) => { const e = new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true }); ta.dispatchEvent(e); return e.defaultPrevented; };
    return { shift: mk(true), kept: ta.value === 'שורה אחת', plain: mk(false) }; })()`);
  t.check('pair message box: Shift+Enter is not handled (the browser inserts a new line), Enter sends', box.shift === false && box.kept === true && box.plain === true, JSON.stringify(box));
  t.check('and Enter really sent the message to the shared chat', !!(await poll(() => /שורה אחת/.test(fs.readFileSync(path.join(project, '.duo', 'CHAT.md'), 'utf8')), 8000)));
  t.check('no JavaScript errors on the pairs screen', page2.errors.length === 0, page2.errors.slice(0, 3).join(' | '));
  page2.close(); k2.close(); srv2.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

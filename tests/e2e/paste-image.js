'use strict';
// @slow
/*
 * הדבקה וגרירה של תמונות לטרמינל Claude (T45), עם claude מדומה שמפעיל הדבקה מסוגרת ומדפיס מה שקיבל (tests/fixtures/img.js):
 *  - Ctrl+V עם תמונה בלוח: האירוע נבלע, צ'יפ "מצרף תמונה…" מופיע באותו רגע, והנתיב של קובץ זמני (תיקייה עם רווח, לכן בגרשיים) מגיע כהדבקה מסוגרת;
 *  - טקסט בלוח גובר (הדבקה רגילה, בלי העלאה); טרמינל PowerShell לא מושפע;
 *  - כשההעלאה נכשלת: חוזרים ל-Alt+V (ESC v) עם הודעה;
 *  - גרירה: כיתוב "שחררו להדבקת נתיב התמונה", עד 5 תמונות מודבקות (מופרדות ברווח), שאר הקבצים מתעלמים מהם עם הודעה, ורשימת התמונות של הפאן נשמרת.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const t = checker('instant image paste and drag-drop');
  const tmp = path.join(TMP, 'paste tmp e2e');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-img'), env: { TEMP: tmp, TMP: tmp } });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'cl' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'ps' });
  await poll(() => keeper.sessions.size === 2, 15000);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  const { ev } = page;
  await page.appReady(2);
  const ids = { cl: [...keeper.sessions.values()].find((s) => s.name === 'cl').id, ps: [...keeper.sessions.values()].find((s) => s.name === 'ps').id };
  const screen = (id) => ev(`(async () => { const { state } = await import('/js/state.js'); const p = state.panes.get('${id}'); const b = p.term.buffer.active; let t = ''; for (let y = 0; y < b.length; y++) { const l = b.getLine(y), nx = b.getLine(y + 1), cont = !!(nx && nx.isWrapped); if (l) t += l.translateToString(!cont) + (cont ? '' : '\\n'); } return t; })()`);
  await page.waitFor(`!!document.querySelector('.pane[data-id="${ids.cl}"] .term-host') && document.querySelector('.pane[data-id="${ids.cl}"] .pane-startup').hidden`, 15000);
  await poll(async () => /for shortcuts/.test(await screen(ids.cl)), 10000, 100);

  // סדרת עזרים בתוך הדף: קובץ תמונה מדומה, אירוע הדבקה, אירועי גרירה, ועטיפה של fetch שמודדת מתי ההעלאה נענתה
  await ev(`(() => {
    window.__png = (name, type = 'image/png') => new File([Uint8Array.from(atob('${PNG_B64}'), (c) => c.charCodeAt(0))], name, { type });
    window.__uploads = []; const orig = window.fetch.bind(window);
    window.__failUpload = false;
    window.fetch = async (...a) => { const u = String(a[0]); if (u.includes('/api/paste-image')) { window.__uploads.push(performance.now()); if (window.__failUpload) throw new Error('stubbed failure'); const r = await orig(...a); window.__upDone = performance.now(); return r; } return orig(...a); };
    window.__paste = (id, items) => { const dt = new DataTransfer(); for (const it of items) { if (typeof it === 'string') dt.setData('text/plain', it); else dt.items.add(it); } const host = document.querySelector('.pane[data-id="' + id + '"] .term-host'); const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); window.__t0 = performance.now(); host.dispatchEvent(e); return { prevented: e.defaultPrevented, chip: !!document.querySelector('.pane[data-id="' + id + '"] .paste-chip') }; };
    window.__drag = (id, type, files) => { const dt = new DataTransfer(); for (const f of files) dt.items.add(f); const el = document.querySelector('.pane[data-id="' + id + '"]'); const e = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }); el.dispatchEvent(e); return { prevented: e.defaultPrevented, hint: !!el.querySelector('.drop-hint') }; };
    return true; })()`);

  /* ---------- א. Ctrl+V עם צילום מסך ---------- */
  const first = await ev(`window.__paste('${ids.cl}', [window.__png('Screenshot 2026.png')])`);
  t.check('image in the clipboard: the paste event is swallowed and the chip "מצרף תמונה…" exists in the same tick', first.prevented === true && first.chip === true, JSON.stringify(first));
  t.check('the path reaches the program as a bracketed paste, quoted (the temp folder has a space), and the program sees an image file', await poll(async () => { const s = await screen(ids.cl); return /GOT:"\\u001b\[200~\\"[^"]*paste tmp e2e[^"]*tg-paste[^"]*\.png\\"\\u001b\[201~"/.test(s) && /\[Image #1\]/.test(s); }, 8000, 50), (await screen(ids.cl)).slice(-400));
  const s1 = await screen(ids.cl);
  const m1 = /\[Image #1\] (\S+) \((\d+) bytes\)/.exec(s1);
  t.check('the saved file is exactly the pasted image (70 bytes) and its name keeps the original name safely', !!m1 && m1[2] === '70' && /-Screenshot-2026\.png$/.test(m1[1]), m1 && m1.join(' | '));
  const timing = await ev(`({ upload: Math.round(window.__upDone - window.__t0) })`);
  t.check(`upload answered fast (${timing.upload} ms for a 70-byte image; the 2 MB target is measured by tests/tools/paste-image.js)`, timing.upload < 1500, JSON.stringify(timing));
  t.check('the chip disappears when the path was pasted', await poll(() => ev(`!document.querySelector('.paste-chip')`), 3000, 50));
  t.check('no ESC v (Alt+V) was sent on the normal route (Claude never has to read the clipboard itself)', !/GOT:"\\u001bv"/.test(s1));
  t.check('the pane keeps the list of pasted images (number, path, name, size, blob url)', await ev(`(async () => { const { state } = await import('/js/state.js'); const l = state.panes.get('${ids.cl}').images; return l.length === 1 && l[0].n === 1 && /tg-paste/.test(l[0].path) && l[0].name === 'Screenshot 2026.png' && l[0].size === 70 && /^blob:/.test(l[0].url); })()`));

  /* ---------- ב. טקסט בלוח גובר, ו-PowerShell לא מושפע ---------- */
  const before = await ev(`window.__uploads.length`);
  const withText = await ev(`window.__paste('${ids.cl}', ['hello', window.__png('x.png')])`);
  t.check('text in the clipboard wins: a normal paste, no upload', withText.prevented === false && (await ev(`window.__uploads.length`)) === before);
  const inShell = await ev(`window.__paste('${ids.ps}', [window.__png('x.png')])`);
  t.check('a PowerShell pane is untouched: the event is not swallowed and nothing is uploaded', inShell.prevented === false && (await ev(`window.__uploads.length`)) === before);

  /* ---------- ג. ההעלאה נכשלת: חוזרים ל-Alt+V ---------- */
  await ev(`window.__failUpload = true; true`);
  await ev(`window.__paste('${ids.cl}', [window.__png('y.png')])`);
  t.check('when the upload fails the old route is the fallback (ESC v arrives) and a message explains it', await poll(async () => /GOT:"\\u001bv"/.test(await screen(ids.cl)) && /העלאת התמונה נכשלה/.test(await ev(`document.querySelector('#toasts').textContent`)), 6000, 100));
  await ev(`window.__failUpload = false; true`);

  /* ---------- ד. גרירה ---------- */
  const over = await ev(`window.__drag('${ids.cl}', 'dragenter', [window.__png('a.png')])`);
  t.check('dragging an image over a Claude pane shows "שחררו להדבקת נתיב התמונה" and allows the drop', over.prevented === true && over.hint === true && (await ev(`document.querySelector('.drop-hint').textContent`)) === 'שחררו להדבקת נתיב התמונה');
  const dropped = await ev(`window.__drag('${ids.cl}', 'drop', [window.__png('first one.png'), window.__png('second.jpg', 'image/jpeg'), new File(['txt'], 'notes.txt', { type: 'text/plain' })])`);
  const toastText = await ev(`document.querySelector('#toasts').textContent`);
  t.check('dropping two images and a text file: the overlay is gone', dropped.prevented === true && dropped.hint === false);
  t.check('the text file was ignored with a message', /רק קבצי התמונה/.test(toastText), toastText);
  t.check('both image paths were pasted in one bracketed paste, separated by a space, each quoted', await poll(async () => { const s = await screen(ids.cl); return /GOT:"\\u001b\[200~\\"[^"]*first-one\.png\\" \\"[^"]*second\.jpg\\"\\u001b\[201~"/.test(s) && /\[Image #2\]/.test(s) && /\[Image #3\]/.test(s); }, 8000, 50), (await screen(ids.cl)).slice(-1500) + ' uploads=' + (await ev('window.__uploads.length')));
  const upBefore = await ev(`window.__uploads.length`);
  await ev(`window.__drag('${ids.cl}', 'drop', [new File(['txt'], 'only.txt', { type: 'text/plain' })])`);
  t.check('dropping only a non-image: a message and no upload', (await ev(`window.__uploads.length`)) === upBefore && /רק קבצי תמונה/.test(await ev(`document.querySelector('#toasts').textContent`)));
  await ev(`window.__drag('${ids.cl}', 'drop', [1, 2, 3, 4, 5, 6, 7].map((n) => window.__png('m' + n + '.png')))`);
  t.check('dropping 7 images pastes at most 5', await poll(async () => (await ev(`window.__uploads.length`)) === upBefore + 5, 6000, 100) && (await sleep(500), (await ev(`window.__uploads.length`)) === upBefore + 5));
  const shellDrop = await ev(`window.__drag('${ids.ps}', 'dragenter', [window.__png('a.png')])`);
  t.check('a PowerShell pane shows no drop hint (but the browser does not open the file either)', shellDrop.hint === false && shellDrop.prevented === true);
  t.check('no JavaScript errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

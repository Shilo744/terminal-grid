'use strict';
// @slow
/*
 * Long text paste becomes a file (T53). A paste above 4000 characters or 50 lines into a Claude pane never travels through ConPTY (15-20 KB/s): the page saves it
 * through POST /api/paste-text and pastes ONE reference line `[text file: "<path>" (N lines)]`. Measured with fixtures that report what the program receives:
 *   bin-paste (counts bytes and times), bin-img (prints every received chunk). Smaller pastes, shell panes and Ctrl+Shift+V are unchanged.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

const LINE = 'שורה מספר N עם קצת עברית ו-English words, numbers 12345 and a path C:\\x\\y.js ';
const makeText = (chars) => { let s = '', i = 0; while (s.length < chars) s += LINE.replace('N', String(++i)) + '\n'; return s.slice(0, chars); };

const IN_PAGE = `(() => {
  window.__uploads = []; window.__failText = false; const orig = window.fetch.bind(window);
  window.fetch = async (...a) => { const u = String(a[0]); if (u.includes('/api/paste-text')) { window.__uploads.push(performance.now()); if (window.__failText) throw new Error('stubbed'); } return orig(...a); };
  window.__paste = (id, text) => { const dt = new DataTransfer(); dt.setData('text/plain', text); const host = document.querySelector('.pane[data-id="' + id + '"] .term-host'); const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); window.__t0 = Date.now(); host.dispatchEvent(e);
    const chip = document.querySelector('.pane[data-id="' + id + '"] .paste-chip'); return { prevented: e.defaultPrevented, chip: !!chip, chipInHead: !!(chip && chip.closest('.pane-head')), chipInBody: !!document.querySelector('.pane[data-id="' + id + '"] .pane-body .paste-chip'), chipText: chip ? chip.textContent : '', t0: window.__t0 }; };
  return true; })()`;

(async () => {
  const t = checker('long text paste as a file');
  const tmp = path.join(TMP, 'paste text e2e');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const dir = path.join(tmp, 'tg-paste');
  const shots = path.join(__dirname, '..', '..', 'docs', 'screens');
  const revealLog = path.join(tmp, 'reveal.log');

  /* =============== שרת 1: bin-paste (מודד בתים וזמנים) =============== */
  let srv = await startServer({ binDir: path.join(FIXTURES, 'bin-paste'), env: { TEMP: tmp, TMP: tmp } });
  let keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'cl' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'ps' });
  await poll(() => keeper.sessions.size === 2, 15000);
  let page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.appReady(2);
  let ids = { cl: [...keeper.sessions.values()].find((s) => s.name === 'cl').id, ps: [...keeper.sessions.values()].find((s) => s.name === 'ps').id };
  const screen = (id) => page.ev(`import('/js/state.js').then(({ state }) => { const p = state.panes.get('${id}'); const b = p.term.buffer.active; let t = ''; for (let y = 0; y < b.length; y++) { const l = b.getLine(y); if (l) t += l.translateToString(true) + String.fromCharCode(10); } return t; })`);
  await page.waitFor(`document.querySelector('.pane[data-id="${ids.cl}"] .pane-startup').hidden`, 15000);
  await poll(async () => /PASTE-ECHO ready/.test(await screen(ids.cl)), 15000, 100);
  await page.ev(IN_PAGE);
  const pd = async (id, nth = 1) => { const m = [...(await screen(id)).matchAll(/PD (\d+) (\d+) (\d+) ([0-9a-f]{40})/g)]; return m[nth - 1] ? { bytes: Number(m[nth - 1][1]), first: Number(m[nth - 1][2]), last: Number(m[nth - 1][3]) } : null; };
  const uploads = () => page.ev('window.__uploads.length');
  const key = (k, code, vk, modifiers) => page.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers }).then(() => page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }));
  const focus = (id) => page.ev(`import('/js/state.js').then(({ state }) => { state.panes.get('${id}').term.focus(); return true; })`);

  /* ---------- 200 KB: שורה אחת, תוך פחות מ-300ms ---------- */
  const big = makeText(200000);
  const first = await page.ev(`window.__paste('${ids.cl}', ${JSON.stringify(big)})`);
  t.check('a 200 KB paste is swallowed and the chip "שומר את הטקסט כקובץ…" exists in the same tick', first.prevented === true && first.chip === true && first.chipText.includes('שומר את הטקסט כקובץ'), JSON.stringify({ ...first, t0: undefined }));
  t.check('the chip is in the pane HEADER strip, never over the terminal text', first.chipInHead === true && first.chipInBody === false);
  const got = await poll(() => pd(ids.cl, 1), 15000, 50);
  const afterMs = got ? got.first - first.t0 : -1;
  t.check('the program receives ONE short reference (a few hundred bytes, not 200 KB) in under 300 ms', !!got && got.bytes < 600 && afterMs >= 0 && afterMs < 300, `${got && got.bytes} bytes, first byte ${afterMs} ms after the paste`);
  console.log(`NUMBERS after (file): ${got && got.bytes} bytes, ${afterMs} ms until the program has the reference`);
  const files = fs.readdirSync(dir).filter((f) => /^text-.*\.txt$/.test(f));
  t.check('exactly one text file was written', files.length === 1, files.join(','));
  t.check('the file on disk equals the pasted text, byte for byte (Hebrew, English, backslashes)', files.length === 1 && fs.readFileSync(path.join(dir, files[0]), 'utf8') === big);
  t.check('the chip turns into "הטקסט נשמר כקובץ (N שורות)" with two actions, still in the header', !!(await poll(() => page.ev(`(() => { const c = document.querySelector('.pane[data-id="${ids.cl}"] .pane-head .paste-chip.done'); return !!c && /הטקסט נשמר כקובץ \\(\\d+ שורות\\)/.test(c.textContent) && c.querySelectorAll('.pc-act').length === 2; })()`), 8000, 100)));
  await sleep(300);
  fs.mkdirSync(shots, { recursive: true });
  await page.resize(1100, 700);
  await sleep(300);
  fs.writeFileSync(path.join(shots, 'T53-chip.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await page.resize(1500, 900);

  /* ---------- Ctrl+Shift+V: הטקסט עצמו (לפני: שניות) ---------- */
  await page.waitFor(`!document.querySelector('.paste-chip')`, 12000); // הצ'יפ של ההדבקה הקודמת נעלם לבד, אחרת הבדיקות "בלי צ'יפ" רואות אותו
  await focus(ids.cl);
  const mid = makeText(100000);
  const before = await uploads();
  await key('V', 'KeyV', 86, 10); // Ctrl+Shift+V
  const inl = await page.ev(`window.__paste('${ids.cl}', ${JSON.stringify(mid)})`);
  t.check('Ctrl+Shift+V pastes the text itself: not swallowed, no upload, no chip', inl.prevented === false && inl.chip === false && (await uploads()) === before, JSON.stringify({ ...inl, t0: undefined }));
  // הדבקה רגילה של xterm קורית באירוע ה-paste שלנו? האירוע המדומה לא עובר דרך שדה הקלט של xterm, לכן מדביקים בפועל דרך term.paste כמו שהדפדפן היה עושה
  await page.ev(`import('/js/state.js').then(({ state }) => { window.__t1 = Date.now(); state.panes.get('${ids.cl}').term.paste(${JSON.stringify(mid)}); return true; })`);
  const t1 = await page.ev('window.__t1');
  const slow = await poll(async () => { const g = await pd(ids.cl, 2); return g && g.bytes > 90000 ? g : null; }, 60000, 200);
  console.log(`NUMBERS before (inline, the old behaviour, 100 KB): ${slow ? slow.bytes : '?'} bytes, ${slow ? slow.last - t1 : '?'} ms until the program has all of it`);
  t.check('the inline path still delivers the whole text (and it is the slow one: seconds, not milliseconds)', !!slow && slow.bytes > 90000 && slow.last - t1 > 1000, `${slow && slow.bytes} bytes in ${slow && slow.last - t1} ms`);

  /* ---------- קצר, ושורות מעל הסף, ושמעטפת לא מושפעת ---------- */
  const u0 = await uploads();
  await page.waitFor(`!document.querySelector('.paste-chip')`, 12000);
  const small = makeText(1000);
  const sm = await page.ev(`window.__paste('${ids.cl}', ${JSON.stringify(small)})`);
  t.check('a 1 KB paste is left to the normal paste (not swallowed, no upload, no chip)', sm.prevented === false && sm.chip === false && (await uploads()) === u0);
  const lines60 = Array.from({ length: 60 }, (_, i) => 'x' + i).join('\n'); // 60 שורות קצרות (~250 תווים): מעל סף השורות
  const ln = await page.ev(`window.__paste('${ids.cl}', ${JSON.stringify(lines60)})`);
  t.check('60 short lines (under 4000 characters) are over the LINE threshold: saved as a file', ln.prevented === true && ln.chip === true);
  const fifty = Array.from({ length: 50 }, (_, i) => 'x' + i).join('\n');
  const f50 = await page.ev(`window.__paste('${ids.cl}', ${JSON.stringify(fifty)})`);
  t.check('exactly 50 lines is NOT over the threshold ("more than 50"): normal paste', f50.prevented === false);
  const ps = await page.ev(`window.__paste('${ids.ps}', ${JSON.stringify(makeText(6000))})`);
  t.check('a PowerShell pane is not affected, however long the paste: not swallowed, no chip', ps.prevented === false && ps.chip === false);
  await page.waitFor(`!document.querySelector('.paste-chip')`, 12000);
  t.check('the chip disappears by itself after about 8 seconds', !(await page.ev(`!!document.querySelector('.paste-chip')`)));
  page.close(); keeper.close(); srv.stop();

  /* =============== שרת 2: bin-img (מדפיס כל מה שהתקבל) =============== */
  srv = await startServer({ binDir: path.join(FIXTURES, 'bin-img'), env: { TEMP: tmp, TMP: tmp, TG_TEST_REVEAL_LOG: revealLog } });
  keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'cl2' });
  await poll(() => keeper.sessions.size === 1, 15000);
  page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.appReady(1);
  ids = { cl: [...keeper.sessions.values()][0].id };
  await page.waitFor(`document.querySelector('.pane[data-id="${ids.cl}"] .pane-startup').hidden`, 15000);
  await poll(async () => /for shortcuts/.test(await screen(ids.cl)), 15000, 100);
  await page.ev(IN_PAGE);
  const got2 = async () => { const m = [...(await screen(ids.cl)).replace(/\n/g, '').matchAll(/GOT:("(?:[^"\\]|\\.)*")/g)].map((x) => { try { return JSON.parse(x[1]); } catch { return ''; } }); return m.join(''); };
  const text2 = makeText(4100);
  const r1 = await page.ev(`window.__paste('${ids.cl}', ${JSON.stringify(text2)})`);
  const received = await poll(async () => { const g = await got2(); return /\[text file: "[^"]+" \(\d+ lines\)\]/.test(g) ? g : null; }, 10000, 100);
  const ref = received && /\[text file: "([^"]+)" \((\d+) lines\)\]/.exec(received);
  t.check('the program received exactly the reference line shape, as a bracketed paste: [text file: "<full path>" (N lines)]', !!ref && received.startsWith('\u001b[200~[text file: "') && received.endsWith(']\u001b[201~') && ref[1].startsWith(dir) && /\.txt$/.test(ref[1]), JSON.stringify(received).slice(0, 300));
  t.check('the line count in the reference is the real number of lines', !!ref && Number(ref[2]) === text2.split('\n').length, ref && ref[2]);
  await page.waitFor(`!!document.querySelector('.pane[data-id="${ids.cl}"] .paste-chip.done')`, 8000);

  // "הצגה בסייר"
  await page.ev(`document.querySelector('.paste-chip [data-act="reveal"]').click(); true`);
  const rev = await poll(() => { try { return fs.readFileSync(revealLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.file); } catch { return null; } }, 5000, 100);
  t.check('"הצגה בסייר" asks the server to select THAT file (the explorer itself is not started in tests)', !!rev && rev.length === 1 && !!ref && rev[0].file === ref[1], JSON.stringify(rev));

  // "הדבקת הטקסט עצמו": מחיקת ההפניה ב-Backspace מדויק, ואז הטקסט המלא
  const refLen = [...ref[0]].length;
  await page.ev(`document.querySelector('.paste-chip [data-act="inline"]').click(); true`);
  const swapped = await poll(async () => { const g = await got2(); const tail = g.slice(received.length); return tail.includes('\u001b[200~') && tail.includes('\u001b[201~') ? tail : null; }, 20000, 150);
  const dels = swapped ? (/^(?:\u007f)*/.exec(swapped) || [''])[0].length : -1;
  t.check('the inline action sends exactly as many Backspaces as the reference has characters, then the full text (bracketed)', !!swapped && dels === refLen && swapped.slice(dels).replace(/\r\n?|\n/g, '\n').includes(text2.slice(0, 200)), `${dels} vs ${refLen}`);
  t.check('and the chip is gone', !(await page.ev(`!!document.querySelector('.paste-chip')`)));

  // הקלדה אחרי ההפניה: הפעולה נעלמת (לא מנחשים מה יש בתיבה)
  const r2 = await page.ev(`window.__paste('${ids.cl}', ${JSON.stringify(makeText(4100))})`);
  await page.waitFor(`!!document.querySelector('.paste-chip.done')`, 8000);
  await page.ev(`import('/js/state.js').then(({ state }) => { state.panes.get('${ids.cl}').term.focus(); return true; })`);
  await key('a', 'KeyA', 65, 0);
  t.check('typing after the reference hides "הדבקת הטקסט עצמו" (the reference can no longer be removed safely)', !!(await poll(() => page.ev(`(() => { const b = document.querySelector('.paste-chip [data-act="inline"]'); return !!b && b.hidden; })()`), 3000, 100)));
  t.check('"הצגה בסייר" stays available', await page.ev(`!document.querySelector('.paste-chip [data-act="reveal"]').hidden`));
  await page.waitFor(`!document.querySelector('.paste-chip')`, 12000);

  // שרת לא זמין: חוזרים להדבקה הרגילה עם הודעה
  await page.ev('window.__failText = true; true');
  const before3 = (await got2()).length;
  await page.ev(`window.__paste('${ids.cl}', ${JSON.stringify(makeText(4200))})`);
  const fb = await poll(async () => { const g = (await got2()).slice(before3); return g.includes('\u001b[201~') ? g : null; }, 20000, 150);
  t.check('when the save fails the text itself is pasted (the old behaviour) and an error toast says so', !!fb && fb.includes('עם קצת עברית') && !fb.includes('[text file:') && !!(await page.ev(`[...document.querySelectorAll('.toast')].some((e) => /הודבק כמו שהוא/.test(e.textContent))`)));
  t.check('the chip does not stay behind after a failure', !(await page.ev(`!!document.querySelector('.paste-chip')`)));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

'use strict';
// @slow
/*
 * גרירת מחוון בהגדרות (T38; הסרטון של המשתמש: הערך קפץ 1.00, 1.20, 1.10, 1.15, 1.05, 1.10, 1.00 והידית לא הייתה מתחת למצביע).
 * גרירה אמיתית עם עשרות תנועות עכבר דרך CDP, כשהשרת מחזיר את ההד של כל שינוי באיחור של 350ms (הד ישן של ערך קודם מגיע באמצע הגרירה):
 *  - הערך לא זז נגד כיוון הגרירה אף פעם, והוא תואם את מיקום המצביע (עד שני צעדים: הידית מתחת למצביע);
 *  - המסלול לא זז ולא משנה רוחב באמצע הגרירה (אין אייקון איפוס שמופיע ומקצר אותו);
 *  - אחרי השחרור, כשההדים המאוחרים מגיעים, הערך נשאר, והשרת שמר אותו;
 *  - אותו דבר לגובה שורה (קבוצת "מתקדם"), ושהטרמינלים קיבלו את הערך הסופי.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('settings sliders: dragging with late server echoes');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args'), env: { TG_TEST_SETTINGS_ECHO_MS: '350' } });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'A' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'B' });
  await poll(() => keeper.sessions.size === 2, 15000);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  const { ev } = page;
  await page.appReady(2);
  const saved = () => JSON.parse(fs.readFileSync(srv.settingsFile, 'utf8'));
  await ev(`document.querySelector('#settingsBtn').click(); true`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  await sleep(400);

  const THUMB = 20; // רוחב הידית כולל מסגרת (settings.css)
  const geom = (row) => ev(`(() => { const i = document.querySelector('[data-row="${row}"] input[type=range]'); i.scrollIntoView({ block: 'center' }); const r = i.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, min: Number(i.min), max: Number(i.max), step: Number(i.step) }; })()`);
  const valueOf = (row) => ev(`Number(document.querySelector('[data-row="${row}"] input[type=range]').value)`);

  async function drag(row, from, to, label, termCheck) {
    const g0 = await geom(row);
    const y = g0.t + g0.h / 2;
    const xAt = (f) => g0.l + THUMB / 2 + f * (g0.w - THUMB);
    const expected = (x) => g0.min + ((x - g0.l - THUMB / 2) / (g0.w - THUMB)) * (g0.max - g0.min);
    await page.mouse('mouseMoved', xAt(from), y);
    await page.mouse('mousePressed', xAt(from), y, { buttons: 1 });
    const dir = Math.sign(to - from);
    const vals = [], widths = [], off = [];
    const N = 40;
    for (let i = 1; i <= N; i++) {
      const x = xAt(from + ((to - from) * i) / N);
      await page.mouse('mouseMoved', x, y, { buttons: 1 });
      await sleep(30);
      const [v, g] = [await valueOf(row), await geom(row)];
      vals.push(v); widths.push([Math.round(g.l * 10) / 10, Math.round(g.w * 10) / 10]);
      off.push(Math.abs(v - expected(x)));
    }
    await page.mouse('mouseReleased', xAt(to), y);
    const atRelease = await valueOf(row);
    await sleep(1200); // ההדים המאוחרים (350ms) מגיעים עכשיו
    const after = await valueOf(row);
    const against = vals.filter((v, i) => i > 0 && (v - vals[i - 1]) * dir < -1e-9).length;
    t.check(`${label}: the value never moves against the drag direction (${vals.length} samples, ${vals[0]} -> ${vals[vals.length - 1]})`, against === 0, JSON.stringify(vals));
    t.check(`${label}: the knob stays under the pointer (value within two steps of the pointer position; worst ${Math.max(...off).toFixed(2)})`, Math.max(...off) <= 2 * g0.step + 1e-9, Math.max(...off).toFixed(3));
    t.check(`${label}: the track does not move or change width during the drag`, widths.every((w) => w[0] === widths[0][0] && w[1] === widths[0][1]) && widths[0][1] === Math.round(g0.w * 10) / 10, JSON.stringify(widths.slice(0, 3)));
    t.check(`${label}: the drag really changed the value`, Math.abs(vals[vals.length - 1] - vals[0]) >= 3 * g0.step);
    t.check(`${label}: after the release and the late echoes the value stays (${atRelease} -> ${after})`, after === atRelease);
    return { final: after, expectedPath: row };
  }

  /* ---------- גודל גופן: ימינה ואז שמאלה ---------- */
  let r = await drag('fontSize', 0.1, 0.9, 'font size, rightwards');
  t.check('font size: the server saved the final value', await poll(() => { try { return saved().terminal.fontSize === r.final; } catch { return false; } }, 6000, 150));
  t.check('font size: every terminal got the final size', await poll(async () => (await ev(`(async () => { const { state } = await import('/js/state.js'); return [...state.panes.values()].map((p) => p.term.options.fontSize); })()`)).every((s) => s === r.final), 4000, 100));
  r = await drag('fontSize', 0.9, 0.3, 'font size, leftwards');
  t.check('font size after the second drag: saved', await poll(() => { try { return saved().terminal.fontSize === r.final; } catch { return false; } }, 6000, 150));

  /* ---------- גובה שורה (מתקדם) ---------- */
  await ev(`document.querySelector('.st-adv-toggle').click(); true`);
  await sleep(300);
  r = await drag('lineHeight', 0.1, 0.9, 'line height, rightwards');
  t.check('line height: the server saved the final value', await poll(() => { try { return Math.abs(saved().terminal.lineHeight - r.final) < 1e-9; } catch { return false; } }, 6000, 150));
  t.check('line height: every terminal got it (applied once per frame, final value wins)', await poll(async () => (await ev(`(async () => { const { state } = await import('/js/state.js'); return [...state.panes.values()].map((p) => p.term.options.lineHeight); })()`)).every((s) => Math.abs(s - r.final) < 1e-9), 4000, 100));

  t.check('no JavaScript errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

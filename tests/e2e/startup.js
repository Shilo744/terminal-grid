'use strict';
// @slow
/*
 * שלב ההפעלה בדפדפן (T41): טרמינל Claude חדש מכוסה בשכבה אטומה "מכין את Claude…" מרגע שהוא נוצר, ושאלת האמון, החץ וה-Enter קורים מתחתיה בלי שיראו אותם.
 * claude מדומה (tests/fixtures/trust.js) שמשחזר את הדיאלוג האמיתי ואז את המסך הראשי. דוגמים את הדף כל כמה עשרות מילישניות:
 *  - השכבה מכסה את גוף הטרמינל (elementFromPoint במרכזו) בכל דגימה שבה היא גלויה, ובשלב מסוים הדיאלוג באמת מצויר מתחתיה (הבדיקה לא ריקה);
 *  - אחרי שהשכבה יורדת המסך כבר הראשי של Claude, ושאלת האמון לא נראית בו;
 *  - דיאלוג אחר שדורש אדם: השכבה יורדת מיד והדיאלוג גלוי וניתן למענה;
 *  - טרמינל שקט: השכבה יורדת בסוף ההמתנה, וברור בכותרת "הטעינה לוקחת יותר מהרגיל".
 */
const path = require('path');
const { FIXTURES, sleep, poll, checker, startServer, openPage } = require('../lib/harness');

const bin = path.join(FIXTURES, 'bin-trust');
const BASE = { TG_STARTUP_QUIET_MS: '0', TG_STARTUP_TIMEOUT_MS: '30000' };

// דגימות מתוך הדף עד שהשכבה יורדת (או max מילישניות): כל דגימה = האם השכבה גלויה, האם היא מכסה את מרכז הטרמינל, והאם טקסט הדיאלוג נמצא במאגר הטרמינל
const SAMPLE = (max) => `(async () => {
  const { state } = await import('/js/state.js');
  const t0 = performance.now(); const out = { n: 0, shown: 0, covered: 0, dialogUnder: 0, dialogUncovered: 0, firstShownAt: null, hiddenAt: null };
  while (performance.now() - t0 < ${max}) {
    const p = [...state.panes.values()][0];
    if (p) {
      const su = p.el.querySelector('.pane-startup');
      const shown = !su.hidden && !su.classList.contains('lifting');
      const host = p.el.querySelector('.term-host').getBoundingClientRect();
      const top = document.elementFromPoint(host.left + host.width / 2, host.top + host.height / 2);
      const sized = host.width > 50 && host.height > 50; // לפני שהפריסה הציבה את הפאן אין מה למדוד
      const covered = !!top && !!top.closest('.pane-startup');
      const b = p.term.buffer.active; let text = ''; for (let y = 0; y < b.length; y++) { const l = b.getLine(y); if (l) text += l.translateToString(true) + '\\n'; }
      const dialog = /Quick safety check|Choose the text style/.test(text);
      out.n++;
      if (shown && sized) { out.shown++; if (covered) out.covered++; if (out.firstShownAt == null) out.firstShownAt = Math.round(performance.now() - t0); }
      if (dialog && sized) { out.dialogUnder++; if (!covered || !shown) out.dialogUncovered++; }
      if (!shown && out.firstShownAt != null) { out.hiddenAt = Math.round(performance.now() - t0); out.finalText = text; out.finalCovered = covered; break; }
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return out;
})()`;

async function run(env, name, fn) {
  const srv = await startServer({ binDir: bin, env: { ...BASE, ...env } });
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.appReady(0);
  try { await fn(page, srv); } finally { page.close(); srv.stop(); await sleep(700); }
}

(async () => {
  const t = checker('hidden start-up: the cover over a new Claude terminal');

  /* ---------- א. שאלת האמון האמיתית: מתחת לשכבה, בלי שרואים ---------- */
  await run({}, 'real', async (page) => {
    await page.ev(`document.querySelector('#addClaude').click(); true`);
    const s = await page.ev(SAMPLE(20000));
    t.check('the cover is up from the moment the terminal appears', s.shown >= 5 && s.firstShownAt != null, JSON.stringify(s));
    t.check('in every sample where it is shown it really covers the terminal body (nothing behind it can be seen)', s.shown > 0 && s.covered === s.shown, `${s.covered}/${s.shown}`);
    t.check('the trust dialog really was drawn underneath at some point (the test is not empty)', s.dialogUnder > 0, JSON.stringify(s));
    t.check('and the dialog text was never visible: whenever it was in the buffer the cover was up', s.dialogUncovered === 0, JSON.stringify(s));
    t.check('the cover lifts by itself (the main prompt appeared, so no 12 s wait)', s.hiddenAt != null && s.hiddenAt < 15000, JSON.stringify(s));
    t.check('after it lifts the pane already shows Claude ready: the main prompt, and no trust dialog on screen', await page.ev(`(async () => { const { state } = await import('/js/state.js'); const p = [...state.panes.values()][0]; const b = p.term.buffer.active; let t = ''; for (let y = b.baseY; y < b.baseY + p.term.rows; y++) { const l = b.getLine(y); if (l) t += l.translateToString(true) + '\\n'; } return /for shortcuts/.test(t) && !/Quick safety check|Yes, I trust/.test(t); })()`));
    t.check('the key presses happened (Down then Enter on Yes) and the process is alive', await page.ev(`(async () => { const { state } = await import('/js/state.js'); const p = [...state.panes.values()][0]; return !p.meta.exited; })()`));
    t.check('the header does not show the "slow start" hint', await page.ev(`!/לוקחת יותר/.test(document.querySelector('.pane .pstatus').textContent)`));
  });

  /* ---------- ב. דיאלוג אחר שדורש אדם: אסור להסתיר ---------- */
  await run({ STARTUP_DIALOG: '1' }, 'dialog', async (page) => {
    await page.ev(`document.querySelector('#addClaude').click(); true`);
    await page.waitFor(`document.querySelectorAll('.pane').length === 1`, 8000);
    // מחכים שהדיאלוג באמת הודפס (תלוי בעומס המחשב: PowerShell + node), ואז נותנים לשרת רגע להגיב
    await page.waitFor(`(async () => { const { state } = await import('/js/state.js'); const p = [...state.panes.values()][0]; const b = p.term.buffer.active; let t = ''; for (let y = 0; y < b.length; y++) { const l = b.getLine(y); if (l) t += l.translateToString(true); } return /Choose the text style/.test(t); })()`, 20000);
    await sleep(900);
    const st = await page.ev(`(async () => { const { state } = await import('/js/state.js'); const p = [...state.panes.values()][0]; const su = p.el.querySelector('.pane-startup'); const host = p.el.querySelector('.term-host').getBoundingClientRect(); const top = document.elementFromPoint(host.left + host.width / 2, host.top + host.height / 2); const b = p.term.buffer.active; let t = ''; for (let y = 0; y < b.length; y++) { const l = b.getLine(y); if (l) t += l.translateToString(true) + '\\n'; } return { hidden: su.hidden, covered: !!top && !!top.closest('.pane-startup'), dialog: /Choose the text style/.test(t), startup: p.meta.startup }; })()`);
    t.check('a login/theme-style dialog that needs a human: the cover is gone, the dialog is in the buffer and nothing covers it', st.hidden && !st.covered && st.dialog && !st.startup, JSON.stringify(st));
  });

  /* ---------- ג. טרמינל שקט: ההמתנה נגמרת, ויש רמז בכותרת ---------- */
  await run({ STARTUP_SILENT: '1', TG_STARTUP_TIMEOUT_MS: '2500' }, 'silent', async (page) => {
    await page.ev(`document.querySelector('#addClaude').click(); true`);
    await page.waitFor(`document.querySelectorAll('.pane').length === 1`, 8000);
    await sleep(900);
    t.check('a silent terminal is still covered after about a second', await page.ev(`!document.querySelector('.pane-startup').hidden`));
    const lifted = await page.waitFor(`document.querySelector('.pane-startup').hidden`, 8000);
    t.check('the cover lifts at the safety timeout', lifted);
    t.check('and the header says that the start is slower than usual', await page.ev(`/הטעינה לוקחת יותר מהרגיל/.test(document.querySelector('.pane .pstatus').textContent) && !document.querySelector('.pane .pstatus').hidden`));
  });

  /* ---------- ד. המשכיות: הכרטיס "פותח את..." והשכבה ---------- */
  await run({ TG_TEST_CREATE_DELAY_MS: '1200' }, 'continuity', async (page) => {
    await page.ev(`document.querySelector('#addClaude').click(); true`);
    // בכל רגע מהלחיצה ועד שהשכבה יורדת יש משהו על המסך במקום הטרמינל: כרטיס, או פאן עם שכבה; לעולם לא תא ריק
    const gaps = await page.ev(`(async () => { let gaps = 0, seen = 0; const t0 = performance.now(); while (performance.now() - t0 < 12000) {
      const card = document.querySelector('.pending-card'); const pane = document.querySelector('.pane'); const su = pane && pane.querySelector('.pane-startup');
      const state = card ? 'card' : pane && su && !su.hidden ? 'cover' : pane ? 'pane' : 'none';
      if (state === 'none') gaps++; else seen++;
      if (state === 'pane' && seen > 5) break;
      await new Promise((r) => setTimeout(r, 20)); }
      return { gaps, seen }; })()`);
    t.check('card -> pane with the cover -> ready pane: no empty frame at any moment', gaps.gaps <= 1 && gaps.seen > 20, JSON.stringify(gaps));
  });

  /* ---------- ה. טרמינל שנפתח ברקע (לא ממוקד): בהפעלה ואחריה הוא לא "ממתין לך" ולא נספר בסיכום ---------- */
  {
    const srv = await startServer({ binDir: bin, env: { ...BASE, STARTUP_PROMPT_DELAY_MS: '2500' } });
    const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
    await page.appReady(0);
    const { connect } = require('../lib/harness');
    const c = await connect(srv.port);
    c.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'bg-one' });
    await page.waitFor(`document.querySelectorAll('.pane').length === 1`, 10000);
    // בזמן ההפעלה: אין תווית "ממתין לך" ואין "ממתינים לך" בסיכום, גם אחרי שהפלט הראשוני נרגע (מעבר ל-1.5 שניות)
    await sleep(2000);
    const during = await page.ev(`(() => ({ startup: !document.querySelector('.pane-startup').hidden, label: document.querySelector('.pane .pstatus').textContent, hidden: document.querySelector('.pane .pstatus').hidden, waitingStat: !!document.querySelector('#summary .stat-wait') }))()`);
    t.check('a pane that is still starting shows no "waiting for you" label and is not counted in the summary', during.startup && (during.hidden || !/ממתין/.test(during.label)) && !during.waitingStat, JSON.stringify(during));
    await page.waitFor(`document.querySelector('.pane-startup').hidden`, 15000);
    await sleep(2500);
    const after = await page.ev(`(() => ({ label: document.querySelector('.pane .pstatus').textContent, hidden: document.querySelector('.pane .pstatus').hidden, waitingStat: !!document.querySelector('#summary .stat-wait'), cls: document.querySelector('.pane').className }))()`);
    t.check('after the start-up, an unfocused pane that only printed its start-up screen is not "waiting for you" either (nothing new happened)', (after.hidden || !/ממתין/.test(after.label)) && !after.waitingStat && !/k-done/.test(after.cls), JSON.stringify(after));
    c.close(); page.close(); srv.stop();
  }

  t.check('(done)', true);
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

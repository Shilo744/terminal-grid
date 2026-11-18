'use strict';
// @slow
/*
 * אישור אוטומטי של שאלת האמון בתיקייה (T32, מתוקן ב-T40), עם claude מדומה שמשחזר את הדיאלוג האמיתי (tests/fixtures/trust.js):
 * "No, exit" מסומן ראשון, חיצים מזיזים את הסימון, Enter על No סוגר את התהליך, Enter על Yes מדפיס TRUSTED.
 * תמיד פעיל (פתיחת סוכן בתיקייה היא כבר ההחלטה לסמוך עליה; אין הגדרה ואין ממשק). רק משתנה הסביבה TG_AUTOTRUST=0 מכבה, ורק בשביל הבדיקות:
 *  - הפריסה האמיתית: חץ למטה אחד ואז Enter אחד, TRUSTED, והתהליך חי; לעולם לא Enter על No;
 *  - הפריסה הישנה (Yes מסומן ראשון): רק Enter. אפשרויות ממוספרות: אותו דבר כמו האמיתית;
 *  - מסך בלי סימון, או מסך שלא מגיב לחץ: לא נשלח Enter בכלל;
 *  - TG_AUTOTRUST=0, שאלה אחרי חלון הזמן, PowerShell: לא נשלח כלום;
 *  - טרמינל של זוג סוכנים מקבל את האישור, ובגלל זה אין את ההתראה "עוד לא התחיל" (ובקרה חיובית: בלי אישור אוטומטי ההתראה כן מופיעה).
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, strip } = require('../lib/harness');

const outOf = (c, id) => strip(c.out.get(id) || '');
const countOf = (c, id, re) => (outOf(c, id).match(re) || []).length;
const dir = (n) => { const d = path.join(TMP, 'trust-work', n); fs.mkdirSync(d, { recursive: true }); return d; };
const latestDuo = (c, id) => { for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'state' && (!id || m.duo.id === id)) return m.duo; } return null; };

async function pairRun(binDir, env, project) {
  const srv = await startServer({ binDir, env });
  const c = await connect(srv.port);
  c.send({ t: 'duo', op: 'create', project, goal: 'Anything', reqId: 'd1' });
  const created = await poll(() => c.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  await poll(() => [...c.sessions.values()].filter((s) => s.duo).length === 2, 20000);
  const pair = [...c.sessions.values()].filter((s) => s.duo);
  return { srv, c, pair, duoId: created && created.duoId };
}

// שרת אחד, טרמינל Claude אחד: מחכה waitMs אחרי שהטרמינל נפתח ומחזיר מה שהוא הדפיס
async function one(binDir, env, name, until, waitMs) {
  const srv = await startServer({ binDir, env });
  const c = await connect(srv.port);
  c.send({ t: 'create', kind: 'claude', cwd: dir(name), name });
  await poll(() => c.sessions.size === 1, 15000);
  const id = [...c.sessions.values()][0].id;
  if (until) await poll(() => until(outOf(c, id)), 20000, 150);
  await sleep(waitMs);
  return { srv, c, id, out: outOf(c, id), exited: c.messages.some((m) => m.t === 'exit' && m.id === id) };
}
const done = (r) => { r.c.close(); r.srv.stop(); return sleep(800); };

(async () => {
  const t = checker('auto-accept the folder trust prompt (navigates to Yes, never confirms No)');
  const binDir = path.join(FIXTURES, 'bin-trust');

  /* ---------- א. הפריסה האמיתית: No מסומן ראשון ---------- */
  let r = await one(binDir, { TRUST_REPEAT: '1' }, 'real', (o) => /TRUSTED/.test(o), 4500);
  const A = r.id;
  t.check('real layout: TRUSTED appears within a few seconds, with no setting at all', /TRUSTED/.test(r.out), r.out.slice(-200));
  t.check('exactly one Down and then exactly one Enter (in that order), and the Enter landed on "Yes"', countOf(r.c, A, /KEY:DOWN/g) === 1 && countOf(r.c, A, /KEY:ENTER/g) === 1 && /KEY:DOWN[\s\S]*KEY:ENTER ENTERS=1 ON=Yes/.test(r.out), r.out.slice(-300));
  t.check('"No, exit" is never confirmed (no EXITING_NO, no Enter on No) and the terminal is still alive', !/EXITING_NO|ON=No/.test(r.out) && !r.exited);
  t.check('the prompt printed again later does not get any further key (once per terminal)', countOf(r.c, A, /KEY:/g) === 2, String(countOf(r.c, A, /KEY:/g)));
  const log = fs.readFileSync(path.join(__dirname, '..', '..', 'server.log'), 'utf8');
  t.check('the accept is written to server.log (terminal id, folder, number of Down presses)', new RegExp('auto-trust accepted ' + A + ' ').test(log) && log.includes(dir('real')) && log.includes('(after 1 down)'));
  t.check('nothing about it is broadcast to the UI (no toast, no setting)', !r.c.messages.some((m) => m.t === 'trusted') && !('autoTrust' in ((r.c.settings && r.c.settings.claude) || {})));

  // ---------- PowerShell: אף פעם ----------
  r.c.send({ t: 'create', kind: 'powershell', cwd: dir('ps'), name: 'plain-shell' });
  await poll(() => r.c.sessions.size === 2, 15000);
  const P = [...r.c.sessions.values()].find((s) => s.name === 'plain-shell').id;
  await sleep(1500);
  r.c.send({ t: 'input', id: P, d: 'Write-Output "Quick safety check: trust this folder? Enter to confirm"; Write-Output "> Yes, I trust this folder"\r' });
  await sleep(4000);
  const psOut = outOf(r.c, P);
  t.check('a PowerShell terminal is never answered, even with the phrases on its screen (nothing extra typed)', (psOut.match(/Write-Output "Quick safety/g) || []).length === 1 && !/KEY:/.test(psOut));
  await done(r);

  /* ---------- ב. הפריסה הישנה ואפשרויות ממוספרות ---------- */
  r = await one(binDir, { TRUST_LAYOUT: 'legacy' }, 'legacy', (o) => /TRUSTED/.test(o), 1500);
  t.check('legacy layout (Yes highlighted first): only Enter, no Down, TRUSTED', /TRUSTED/.test(r.out) && countOf(r.c, r.id, /KEY:DOWN/g) === 0 && countOf(r.c, r.id, /KEY:ENTER/g) === 1 && /ON=Yes/.test(r.out), r.out.slice(-200));
  await done(r);
  r = await one(binDir, { TRUST_NUMBERED: '1' }, 'numbered', (o) => /TRUSTED/.test(o), 1500);
  t.check('numbered options ("1. No, exit"): one Down, one Enter, TRUSTED', /TRUSTED/.test(r.out) && countOf(r.c, r.id, /KEY:DOWN/g) === 1 && /ON=Yes/.test(r.out) && !/EXITING_NO/.test(r.out), r.out.slice(-200));
  await done(r);

  /* ---------- ג. מצבים שבהם אסור ללחוץ כלום ---------- */
  r = await one(binDir, { TRUST_NOMARKER: '1' }, 'nomarker', (o) => /Enter to confirm/.test(o), 4500);
  t.check('a screen with no selection marker: no key at all (the manual click stays possible)', countOf(r.c, r.id, /KEY:/g) === 0 && !/TRUSTED|EXITING_NO/.test(r.out), r.out.slice(-200));
  await done(r);
  r = await one(binDir, { TRUST_STUCK: '1' }, 'stuck', (o) => /Enter to confirm/.test(o), 5000);
  t.check('a screen that does not react to Down: at most one Down, never an Enter, never "No"', countOf(r.c, r.id, /KEY:DOWN/g) <= 1 && countOf(r.c, r.id, /KEY:ENTER/g) === 0 && !/EXITING_NO|TRUSTED/.test(r.out) && !r.exited, r.out.slice(-200));
  await done(r);
  r = await one(binDir, { TG_AUTOTRUST: '0' }, 'off', (o) => /Enter to confirm/.test(o), 4500);
  t.check('TG_AUTOTRUST=0: the terminal stays on the prompt (no key, no TRUSTED)', countOf(r.c, r.id, /KEY:/g) === 0 && !/TRUSTED/.test(r.out));
  await done(r);
  r = await one(binDir, { TG_TRUST_WINDOW_MS: '1500', TRUST_DELAY_MS: '4500' }, 'late', (o) => /Enter to confirm/.test(o), 3500);
  t.check('a prompt that shows up after the time window is not answered', countOf(r.c, r.id, /KEY:/g) === 0 && !/TRUSTED/.test(r.out));
  await done(r);

  /* ---------- ד. זוג סוכנים ---------- */
  const mk = (n) => { const p = path.join(TMP, `trust-pair-${n}-${Date.now()}`); fs.mkdirSync(p, { recursive: true }); return p; };
  let run = await pairRun(binDir, {}, mk('on'));
  t.check('both pair agents get the trust prompt answered (Down, then Enter on Yes)', await poll(() => run.pair.every((s) => /TRUSTED/.test(outOf(run.c, s.id))), 25000, 200));
  t.check('and neither of them was ever sent Enter on "No"', run.pair.every((s) => !/EXITING_NO|ON=No/.test(outOf(run.c, s.id))));
  await sleep(28000); // ההתראה "עוד לא התחיל" הייתה אמורה להופיע אחרי 25 שניות
  const dOn = latestDuo(run.c, run.duoId);
  t.check('the pair alert "did not start, approve trust" is NOT raised when the trust was accepted automatically', !!dOn && !dOn.alerts.some((a) => /עוד לא התחיל/.test(a.text)), JSON.stringify(dOn && dOn.alerts));
  run.c.close(); run.srv.stop();
  await sleep(800);

  // בקרה חיובית: בלי אישור אוטומטי אותו זוג כן מתריע (אחרת הבדיקה למעלה לא מוכיחה כלום)
  run = await pairRun(binDir, { TG_AUTOTRUST: '0' }, mk('off'));
  await sleep(28500);
  const dOff = latestDuo(run.c, run.duoId);
  t.check('control: without auto-accept the same pair does raise "did not start, maybe approve trust"', !!dOff && dOff.alerts.some((a) => /עוד לא התחיל/.test(a.text)), JSON.stringify(dOff && dOff.alerts));
  run.c.close(); run.srv.stop();

  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

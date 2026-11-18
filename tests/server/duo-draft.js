'use strict';
// @slow
/*
 * הוראת wake של זוג לא נדחפת לתוך הודעה שהמשתמש כותב (T62), מקצה לקצה עם סוכנים מדומים שמציירים תיבת קלט כמו Claude (FAKE_UI=1, כולל Ctrl+S = stash):
 *   א. בלי טיוטה: ההוראה מוזרקת כרגיל;
 *   ב. עם טיוטה והפסקה: החלפת טיוטה (stash, שליחה, והטיוטה חוזרת בדיוק, גם בעברית); ההוראה לא מכילה אף תו מהטיוטה;
 *   ג. הקשה בזמן ההחלפה (מנעול אדם): מופיעה אחרי הטיוטה המוחזרת, לא בתוך ההוראה;
 *   ד. הקלדה מתמשכת: ההוראה מחכה להפסקה;
 *   ה. stash שלא אושר (FAKE_NO_STASH): לא שולחים כלום, ההוראה ממתינה (הסוכן נשאר פנוי, מסומן ממתין), שתי הוראות מתמזגות לאחת, ונשלחת כשהתיבה מתרוקנת;
 *   ו. טיוטה נטושה: אחרי הזמן שנקבע ההוראה עוברת כמו פעם, ונרשם בפעילות.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect } = require('../lib/harness');

const latest = (c) => { for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'state') return m.duo; } return null; };

async function pair(name, env) {
  const project = path.join(TMP, `duo-draft-${name}-${Date.now()}`);
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [x] T1 — done\n  Result: ok\n');
  const logPrefix = path.join(project, 'fake-log');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-duo'), env: { FAKE_UI: '1', FAKE_LOG: logPrefix, TG_TEST_PENDING_SHOW_MS: '300', ...env } });
  const c = await connect(srv.port);
  c.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'd' });
  const created = await poll(() => c.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  const duoId = created.duoId;
  await poll(() => { const d = latest(c); return d && d.agents.architect.state === 'idle' && d.agents.worker.state === 'idle'; }, 30000);
  const arch = () => [...c.sessions.values()].find((s) => s.duo && s.duo.role === 'architect');
  const logLines = () => { try { return fs.readFileSync(logPrefix + '.architect', 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  const submits = () => logLines().filter((l) => l.startsWith('SUBMIT ')).map((l) => l.slice(7));
  const wakes = () => submits().filter((x) => x.includes('[duo]'));
  const human = (d) => c.send({ t: 'input', id: arch().id, d });
  const say = (text) => c.send({ t: 'duo', op: 'say', duoId, text: text + ' NOTASKS' }); // NOTASKS: הארכיטקט המדומה לא מתכנן משימות (אחרת העובד היה מקבל עבודה והארכיטקט הייתה סקירה)
  const lastDraft = () => { const l = logLines().filter((x) => x.startsWith('DRAFT ')).pop(); return l ? l.slice(6) : null; };
  const idle = () => poll(() => { const d = latest(c); return d && d.agents.architect.state === 'idle'; }, 20000, 100);
  const stop = () => { c.close(); srv.stop(); };
  return { c, srv, duoId, arch, logLines, submits, wakes, human, say, lastDraft, idle, stop, duo: () => latest(c) };
}

(async () => {
  const t = checker('the wake never submits the user draft');

  /* ---------- שרת עם stash ---------- */
  const p = await pair('swap', {});
  // א. בלי טיוטה
  p.say('first ping');
  t.check('a. no draft: the wake is injected as before (one [duo] submit), and what the user sees is just the short marker (T64)', !!(await poll(() => p.wakes().length === 1, 15000)) && p.wakes()[0] === '[duo] user', JSON.stringify(p.submits()));
  await p.idle();
  await sleep(500);

  // ב. טיוטה + החלפה
  p.human('טיוטה abc');
  await sleep(2300); // הפסקה בהקלדה (1.5 שניות) ותום חלון ההד (2 שניות)
  const before = p.wakes().length;
  p.say('second ping');
  const swapped = await poll(() => p.wakes().length === before + 1, 15000);
  t.check('b. a draft and a pause: the wake IS delivered (stash, send, the draft comes back)', !!swapped, JSON.stringify(p.logLines().slice(-6)));
  const wake2 = p.wakes()[before] || '';
  t.check('b. the wake text contains nothing of the draft (not merged), and the draft was stashed whole', !/טיוטה|abc/.test(wake2) && p.logLines().some((l) => l === 'STASH טיוטה abc'), JSON.stringify(p.logLines().slice(-6)));
  await sleep(600);
  t.check('b. the draft is restored exactly (Hebrew included)', p.lastDraft() === 'טיוטה abc', String(p.lastDraft()));
  t.check('b. the technical details say so (not the activity list)', (p.duo().tech || []).some((e) => /הטיוטה של המשתמש נשמרה והוחזרה/.test(e.text)), JSON.stringify((p.duo().tech || []).slice(-4)));
  await p.idle();

  // ג. הקשה בזמן ההחלפה: אחרי הטיוטה המוחזרת
  const stashesBefore = p.logLines().filter((l) => l.startsWith('STASH ')).length;
  const wakesBefore = p.wakes().length;
  p.say('third ping');
  await poll(() => p.logLines().filter((l) => l.startsWith('STASH ')).length === stashesBefore + 1, 15000, 20);
  p.human('Z'); // מגיע בזמן שהמנעול סגור
  await poll(() => p.wakes().length === wakesBefore + 1, 15000);
  await sleep(1500);
  t.check('c. a key pressed during the swap is held and typed AFTER the restored draft (never inside the wake)', p.lastDraft() === 'טיוטה abcZ' && !/Z/.test(p.wakes()[wakesBefore] || ''), `${p.lastDraft()} | ${p.wakes()[wakesBefore]}`);
  await p.idle();
  p.human('\x03'); // ניקוי הטיוטה
  await sleep(400);

  // ד. הקלדה מתמשכת: ההוראה מחכה להפסקה
  const wakesBeforeTyping = p.wakes().length;
  let typed = '';
  const typing = (async () => { for (let i = 0; i < 12; i++) { typed += 'k'; p.human('k'); await sleep(300); } })();
  await sleep(500);
  p.say('fourth ping');
  await sleep(2800); // הבדיקה מחכה לסריקת ההוראות הממתינות (כל 2 שניות) שמציגה "הודעה ממתינה"
  t.check('d. while the user keeps typing, nothing is injected (the wake waits for the pause)', p.wakes().length === wakesBeforeTyping && p.duo().agents.architect.pending === true && p.duo().agents.architect.state === 'idle', `${p.wakes().length} vs ${wakesBeforeTyping} pending=${p.duo().agents.architect.pending}`);
  await typing;
  const delivered = await poll(() => p.wakes().length === wakesBeforeTyping + 1, 15000);
  t.check('d. after the last key and the pause the wake is delivered and the typed text is untouched', !!delivered && !/k/.test((p.wakes()[wakesBeforeTyping] || '').replace(/\[duo\].*/, '')) && p.lastDraft() === typed, `${p.lastDraft()} vs ${typed}`);
  p.stop();
  await sleep(600);

  /* ---------- שרת בלי stash: ממתינים ולא מערבבים ---------- */
  const q = await pair('nostash', { FAKE_NO_STASH: '1', TG_TEST_PENDING_SHOW_MS: '1500' });
  q.human('xyz');
  await sleep(2300);
  q.say('ping one');
  q.say('ping two');
  await sleep(500);
  t.check('e. a wake held back for only half a second is NOT announced yet (the label appears after the delay, T65)', q.wakes().length === 0 && q.duo().agents.architect.pending === false, JSON.stringify(q.duo().agents.architect));
  await sleep(4000);
  t.check('e. no stash confirmation: nothing is sent, the draft is untouched, the agent stays idle and is marked as having a pending message', q.wakes().length === 0 && q.lastDraft() === 'xyz' && q.duo().agents.architect.state === 'idle' && q.duo().agents.architect.pending === true, JSON.stringify({ w: q.wakes(), d: q.lastDraft(), s: q.duo().agents.architect.state, p: q.duo().agents.architect.pending }));
  q.human('\x03');
  const one = await poll(() => q.wakes().length >= 1, 10000);
  await sleep(2500);
  t.check('e. when the user clears the box the pending wake is delivered at once, once (two pings coalesced)', !!one && q.wakes().length === 1 && q.duo().agents.architect.pending === false, JSON.stringify(q.submits()));
  q.stop();
  await sleep(600);

  /* ---------- טיוטה נטושה ---------- */
  const r = await pair('abandoned', { FAKE_NO_STASH: '1', TG_TEST_DRAFT_ABANDONED_MS: '3000' });
  r.human('old words ');
  await sleep(1000);
  r.say('late ping');
  const merged = await poll(() => r.wakes().length >= 1, 15000);
  const text = r.wakes()[0] || '';
  t.check('f. an abandoned draft (no key for the limit) no longer blocks the pair: the wake goes through like before', !!merged && /old words/.test(text) && /\[duo\]/.test(text), text);
  t.check('f. and the feed records "sent together with an old draft"', (r.duo().events || []).some((e) => /נשלחה יחד עם טיוטה ישנה/.test(e.detail || '') || /נשלחה יחד עם טיוטה ישנה/.test(e.text || '')), JSON.stringify((r.duo().events || []).slice(-3)));
  r.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

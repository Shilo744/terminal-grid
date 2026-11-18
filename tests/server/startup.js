'use strict';
// @slow
/*
 * שלב ההפעלה של טרמינל Claude (T41): הטרמינל נוצר עם startup:true, והשרת משדר {t:'startup', phase:'ready', why} כשהוא באמת מוכן.
 * claude מדומה (tests/fixtures/trust.js) שמשחזר את שאלת האמון האמיתית ואז את המסך הראשי:
 *  - אחרי שאלת האמון שנענתה (חץ + Enter) והמסך הראשי מופיע: why=prompt, וה-ready מגיע רק אחרי ש-TRUSTED כבר הודפס (השכבה לא יורדת באמצע);
 *  - תיקייה שכבר אושרה (אין שאלה): prompt מיד;
 *  - דיאלוג אחר שדורש אדם (ערכת נושא, "Enter to confirm"): why=dialog מיד, ולא נשלח אליו כלום (אף פעם לא עונים על דבר שאינו שאלת האמון);
 *  - TG_AUTOTRUST=0: שאלת האמון עצמה דורשת אדם, ולכן why=dialog;
 *  - hook (SessionStart) מסיים את השלב: why=hook; טרמינל שקט לגמרי: why=timeout אחרי המגבלה (TG_STARTUP_TIMEOUT_MS);
 *  - PowerShell לא עובר שלב הפעלה; שני סוכני הזוג כן, ושניהם מסיימים.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, strip } = require('../lib/harness');

const binDir = path.join(FIXTURES, 'bin-trust');
const dir = (n) => { const d = path.join(TMP, 'startup-work', n); fs.mkdirSync(d, { recursive: true }); return d; };
// דיווח hook כמו שה-hook-cli שולח (רק מתהליך מקומי: Origin ו-x-tg)
const hook = (port, body) => new Promise((resolve) => {
  const data = JSON.stringify(body);
  const rq = http.request({ host: '127.0.0.1', port, path: '/api/agent/event', method: 'POST', headers: { Origin: `http://127.0.0.1:${port}`, 'x-tg': '1', 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
  rq.on('error', () => resolve(0)); rq.end(data);
});
const ready = (c, id) => c.messages.find((m) => m.t === 'startup' && m.id === id);

async function open(env, name, opts = {}) {
  const srv = await startServer({ binDir, env: { TG_STARTUP_TIMEOUT_MS: '30000', TG_STARTUP_QUIET_MS: '0', ...env } }); // ברירות המחדל של הבדיקות (1.2 שניות, שקט של 0.6) קצרות מדי כאן
  const c = await connect(srv.port);
  const t0 = Date.now();
  c.send({ t: 'create', kind: opts.kind || 'claude', cwd: dir(name), name });
  const created = await poll(() => c.messages.find((m) => m.t === 'created' && m.session.name === name), 15000, 30);
  return { srv, c, t0, created, id: created && created.session.id, meta: created && created.session };
}
const close = (r) => { r.c.close(); r.srv.stop(); return sleep(800); };

(async () => {
  const t = checker('Claude start-up phase (hidden start-up)');

  /* ---------- א. שאלת האמון (חץ + Enter), ואז המסך הראשי ---------- */
  let r = await open({}, 'real');
  t.check('the created terminal is marked startup:true from the first message', r.meta && r.meta.startup === true, JSON.stringify(r.meta));
  const m1 = await poll(() => ready(r.c, r.id), 20000, 50);
  const dt = Date.now() - r.t0;
  t.check('"ready" arrives (why=prompt: the main prompt is on screen)', !!m1 && m1.why === 'prompt' && m1.phase === 'ready', JSON.stringify(m1));
  const out = strip(r.c.out.get(r.id) || '');
  t.check('it arrives only AFTER the trust prompt was answered (Down, Enter on Yes, TRUSTED were already printed)', /KEY:DOWN[\s\S]*KEY:ENTER ENTERS=1 ON=Yes[\s\S]*TRUSTED/.test(out) && /for shortcuts/.test(out), out.slice(-200));
  t.check('it did not wait for the 12 s timeout', dt < 8000, dt + ' ms');
  t.check('a new client that connects after the phase gets the terminal without startup', await (async () => { const c2 = await connect(r.srv.port); await poll(() => c2.sessions.size === 1, 5000); const x = [...c2.sessions.values()][0]; c2.close(); return !x.startup; })());
  const log = fs.readFileSync(path.join(__dirname, '..', '..', 'server.log'), 'utf8');
  t.check('server.log has the start-up line with the reason and the duration', new RegExp('startup ready ' + r.id + ' prompt \\d+ms').test(log));
  r.c.send({ t: 'create', kind: 'powershell', cwd: dir('ps'), name: 'plain' });
  const ps = await poll(() => r.c.messages.find((m) => m.t === 'created' && m.session.name === 'plain'), 10000, 50);
  await sleep(1500);
  t.check('a PowerShell terminal has no start-up phase at all', !!ps && !ps.session.startup && !r.c.messages.some((m) => m.t === 'startup' && m.id === ps.session.id));
  await close(r);

  /* ---------- ב. תיקייה שכבר אושרה ---------- */
  r = await open({ STARTUP_SKIP_TRUST: '1' }, 'skip');
  const m2 = await poll(() => ready(r.c, r.id), 10000, 50);
  t.check('a folder that was already trusted: ready (prompt) within a couple of seconds, no keys were sent', !!m2 && m2.why === 'prompt' && Date.now() - r.t0 < 5000 && !/KEY:/.test(strip(r.c.out.get(r.id) || '')), JSON.stringify(m2));
  await close(r);

  /* ---------- ג. דיאלוג אחר שדורש אדם ---------- */
  r = await open({ STARTUP_DIALOG: '1' }, 'dialog');
  const m3 = await poll(() => ready(r.c, r.id), 10000, 50);
  await sleep(1500);
  const out3 = strip(r.c.out.get(r.id) || '');
  t.check('another dialog that needs a human (theme choice): lifted at once (why=dialog)', !!m3 && m3.why === 'dialog', JSON.stringify(m3));
  t.check('and nothing was ever typed into it', /Choose the text style/.test(out3) && !/KEY:/.test(out3));
  await close(r);

  /* ---------- ד. שאלת האמון כשהאישור האוטומטי כבוי ---------- */
  r = await open({ TG_AUTOTRUST: '0' }, 'noauto');
  const m4 = await poll(() => ready(r.c, r.id), 10000, 50);
  t.check('TG_AUTOTRUST=0: the trust prompt needs a human, so the cover lifts (why=dialog)', !!m4 && m4.why === 'dialog', JSON.stringify(m4));
  await close(r);

  /* ---------- ה. hook ---------- */
  r = await open({ STARTUP_SILENT: '1', TG_STARTUP_TIMEOUT_MS: '30000' }, 'hook');
  await sleep(1500);
  t.check('a silent terminal is still covered after 1.5 s', !ready(r.c, r.id));
  const posted = await hook(r.srv.port, { paneId: r.id, event: 'start' });
  const m5 = await poll(() => ready(r.c, r.id), 5000, 50);
  t.check('the SessionStart hook of that terminal lifts it at once (why=hook)', posted === 200 && !!m5 && m5.why === 'hook', JSON.stringify({ posted, m5 }));
  await close(r);

  /* ---------- ו. טרמינל שקט: timeout ---------- */
  r = await open({ STARTUP_SILENT: '1', TG_STARTUP_TIMEOUT_MS: '1800' }, 'timeout');
  const m6 = await poll(() => ready(r.c, r.id), 10000, 50);
  const dt6 = Date.now() - r.t0;
  t.check('nothing at all on screen: lifted by the safety timeout (why=timeout), not earlier', !!m6 && m6.why === 'timeout' && dt6 >= 1700 && dt6 < 5000, JSON.stringify(m6) + ' ' + dt6);
  await close(r);

  /* ---------- ז. זוג סוכנים: שני הסוכנים ---------- */
  const srv = await startServer({ binDir, env: { TG_STARTUP_TIMEOUT_MS: '30000', TG_STARTUP_QUIET_MS: '0' } });
  const c = await connect(srv.port);
  c.send({ t: 'duo', op: 'create', project: dir('pair'), goal: 'Anything', reqId: 'p1' });
  await poll(() => [...c.sessions.values()].filter((s) => s.duo).length === 2, 20000);
  const pair = [...c.sessions.values()].filter((s) => s.duo);
  t.check('both pair agents start in the start-up phase', pair.length === 2 && pair.every((s) => s.startup === true), JSON.stringify(pair.map((s) => s.startup)));
  t.check('and both get "ready" after their trust prompt was answered', await poll(() => pair.every((s) => ready(c, s.id)), 25000, 100) && pair.every((s) => /TRUSTED/.test(strip(c.out.get(s.id) || ''))));
  c.close(); srv.stop();

  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

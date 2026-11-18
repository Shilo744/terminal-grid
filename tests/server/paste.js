'use strict';
// @slow
/*
 * הדבקה גדולה (T33): 200KB (כמו הדבקה של קובץ שלם) מגיעים לתוכנית שלמים ובסדר (sha1 מצטבר בפיקסצ'ר tests/fixtures/paste-echo.js),
 * בלי לחנוק את השרת: בזמן שההדבקה נמסרת השרת ממשיך לענות (/api/health) והמסוף השני מגיב להקלדה. הגבול נדיב בכוונה:
 * ConPTY מוסר קלט לתוכנית בקצב של כ-20KB לשנייה (נמדד: docs/performance.md "Paste"), כלומר 200KB לוקחים כ-10 שניות, והשרת לא יכול להאיץ את זה.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, getJson, strip } = require('../lib/harness');

(async () => {
  const t = checker('big paste arrives complete and in order, the server stays responsive');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-paste') });
  const c = await connect(srv.port);
  const work = path.join(TMP, 'paste-test-work');
  fs.mkdirSync(work, { recursive: true });
  c.send({ t: 'create', kind: 'claude', cwd: work, name: 'paste' });
  c.send({ t: 'create', kind: 'powershell', cwd: work, name: 'other' });
  await poll(() => c.sessions.size === 2, 20000);
  const id = [...c.sessions.values()].find((s) => s.name === 'paste').id;
  const other = [...c.sessions.values()].find((s) => s.name === 'other').id;
  await poll(() => /PASTE-ECHO ready/.test(strip(c.out.get(id) || '')), 30000);
  await sleep(500);

  // 200KB שאינם חוזרים על עצמם (מספרים רצים), כדי ששינוי סדר או אובדן ישנו את ה-hash
  let text = '';
  for (let i = 0; text.length < 200 * 1024; i++) text += `line ${i} ${(i * 2654435761 % 1e9).toString(36)}\n`.replace(/\n/, ' ');
  text = text.slice(0, 200 * 1024);
  const expected = crypto.createHash('sha1').update(text).digest('hex');

  await getJson(`http://127.0.0.1:${srv.port}/api/health?reset=1`);
  const pings = [];
  let running = true;
  const pinger = (async () => { while (running) { const t0 = Date.now(); await getJson(`http://127.0.0.1:${srv.port}/api/health`); pings.push(Date.now() - t0); await sleep(25); } })();
  const t0 = Date.now();
  c.send({ t: 'input', id, d: text });
  // הקלדה בטרמינל האחר בזמן ההדבקה: צריכה להתקבל כרגיל
  await sleep(300);
  c.send({ t: 'input', id: other, d: 'echo typed-during-paste\r' });
  const typed = await poll(() => /typed-during-paste/.test(strip(c.out.get(other) || '').replace(/echo typed-during-paste/, '')), 30000, 100);
  const typedAfter = Date.now() - t0;
  const reports = () => (strip(c.out.get(id) || '').match(/PD \d+ \d+ \d+ [0-9a-f]{40}/g) || []).map((l) => l.split(' '));
  const done = await poll(() => { const r = reports(); return r.length && r.reduce((n, p) => n + Number(p[1]), 0) >= text.length; }, 120000, 200);
  const ms = Date.now() - t0;
  running = false;
  await pinger;
  const r = reports();
  const sum = r.reduce((n, p) => n + Number(p[1]), 0);
  t.check('all 200 KB reached the program', !!done && sum === text.length, `${sum} of ${text.length} bytes in ${r.length} report(s), ${ms} ms`);
  t.check('complete AND in order (running sha1 equals the pasted text)', !!r.length && r[r.length - 1][4] === expected);
  t.check('delivered within a generous limit (60 s; ConPTY feeds the program at about 20 KB/s)', ms < 60000, `${ms} ms`);
  const worst = Math.max(...pings);
  t.check('the server kept answering while the paste was delivered (worst /api/health ping under 500 ms)', worst < 500, `worst=${worst}ms over ${pings.length} pings`);
  t.check('a keystroke in another terminal was echoed while the big paste was still going in', !!typed && typedAfter < ms + 5000, `echoed after ${typedAfter} ms, paste finished after ${ms} ms`);
  const log = fs.readFileSync(path.join(__dirname, '..', '..', 'server.log'), 'utf8');
  t.check('the server logs how long pty.write took for the big input (and it is not the slow part)', (() => { const m = [...log.matchAll(new RegExp('big input ' + id + ' (\\d+) chars, pty.write returned after ([\\d.]+) ms', 'g'))].pop(); return !!m && Number(m[1]) >= 200 * 1024 && Number(m[2]) < 500; })());
  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

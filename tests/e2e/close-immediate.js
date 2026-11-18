'use strict';
// @slow
/*
 * הסגירה מיידית (T55): לחיצה אחת על ה-X סוגרת (פאן Claude, PowerShell, אריח), בלי "לסגור?". וההנחה שמאחורי זה נכונה: שיחת Claude שנסגרה נשארת בהיסטוריה של תפריט הצד
 * (גם כשנכתבה רגע לפני הסגירה) וניתנת להמשך עם אותו claudeId.
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { FIXTURES, TEST_HOME, sleep, poll, checker, startServer, connect, openPage, seedHistory, post } = require('../lib/harness');

(async () => {
  const t = checker('close with one click, the conversation stays in the history');
  const seeded = seedHistory(TEST_HOME, { projects: 1, perProject: 2 });
  const conv = seeded[0];
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: conv.cwd, name: 'conv', resume: conv.id });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'shell' });
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'other' });
  await poll(() => keeper.sessions.size === 3, 20000);
  const byName = (n) => [...keeper.sessions.values()].find((s) => s.name === n);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 800 });
  await page.appReady(3);
  const { ev } = page;
  await page.ev(`document.querySelector('#sideBtn').click(); true`);
  await page.waitFor(`!!document.querySelector('.ses')`, 20000);
  const pane = (n) => `document.querySelector('.pane[data-id="${byName(n).id}"]')`;
  const rowOpen = () => ev(`(() => { const r = [...document.querySelectorAll('.ses')].find((x) => /${conv.title}/.test(x.textContent)); return r ? { present: true, open: r.classList.contains('open') } : { present: false }; })()`);

  t.check('the close button of a Claude pane says the conversation is kept; a shell pane just says "סגירה"', (await ev(`${pane('conv')}.querySelector('[data-act="close"]').title`)) === 'סגירה (השיחה נשמרת בהיסטוריה)' && (await ev(`${pane('shell')}.querySelector('[data-act="close"]').title`)) === 'סגירה');
  t.check('(before) the conversation is listed as open in the side menu', (await rowOpen()).open === true, JSON.stringify(await rowOpen()));

  // לחיצה אמיתית אחת על ה-X של פאן ה-Claude
  const rect = await ev(`(() => { const r = ${pane('conv')}.querySelector('[data-act="close"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const t0 = Date.now();
  await page.mouse('mouseMoved', rect.x, rect.y);
  await page.mouse('mousePressed', rect.x, rect.y);
  await page.mouse('mouseReleased', rect.x, rect.y);
  const gone = await poll(() => !keeper.sessions.has(byName('conv') ? byName('conv').id : '') && !byName('conv'), 8000, 50);
  t.check('ONE real click on × closes the Claude terminal (no armed state, no "לסגור?")', !!gone && !(await ev(`!!document.querySelector('.ph-btn.armed') || document.body.textContent.includes('לסגור?')`)), `closed after ${Date.now() - t0} ms`);
  const hist = await post(srv.port, '/api/history', {});
  const found = hist.projects.flatMap((p) => p.sessions).find((s) => s.id === conv.id);
  t.check('the conversation is in the history right after the close, not open any more', !!found && found.open === null, JSON.stringify(found));
  const row = await poll(async () => { const r = await rowOpen(); return r.present && !r.open ? r : null; }, 8000, 100);
  t.check('the side menu shows the conversation as a closed (resumable) row', !!row, JSON.stringify(await rowOpen()));

  // והיא ממשיכה עם אותו claudeId
  const before = new Set(keeper.sessions.keys());
  keeper.send({ t: 'create', kind: 'claude', cwd: conv.cwd, name: 'again', resume: conv.id });
  const again = await poll(() => [...keeper.sessions.values()].find((s) => !before.has(s.id) && s.name === 'again'), 10000);
  t.check('resuming it works (no "already open" error) and runs with the same conversation id', !!again && keeper.errors.length === 0, JSON.stringify(keeper.errors));
  const hist2 = await post(srv.port, '/api/history', {});
  t.check('...and the history shows it as open again under the same id', hist2.projects.flatMap((p) => p.sessions).some((s) => s.id === conv.id && s.open === again.id));

  // שיחה שנכתבה רגע לפני הסגירה (המטמון של 3 שניות מלפני שנכתבה): חייבת להופיע מיד אחרי הסגירה
  const fresh = require('crypto').randomUUID();
  const beforeF = new Set(keeper.sessions.keys());
  keeper.send({ t: 'create', kind: 'claude', cwd: conv.cwd, name: 'fresh', sessionId: fresh });
  const freshS = await poll(() => [...keeper.sessions.values()].find((s) => !beforeF.has(s.id) && s.name === 'fresh'), 10000);
  await post(srv.port, '/api/history', {}); // ממלא את המטמון עכשיו (בלי השיחה החדשה)
  const dir = path.join(TEST_HOME, '.claude', 'projects', conv.cwd.replace(/[:\\/]/g, '-'));
  fs.writeFileSync(path.join(dir, fresh + '.jsonl'), JSON.stringify({ type: 'user', cwd: conv.cwd, message: { content: 'written just before closing' } }) + '\n');
  keeper.send({ t: 'close', id: freshS.id });
  await poll(() => !keeper.sessions.has(freshS.id), 8000, 50);
  const hist3 = await post(srv.port, '/api/history', {});
  t.check('a conversation written moments before the close (inside the 3 s cache) is in the history immediately', hist3.projects.flatMap((p) => p.sessions).some((x) => x.id === fresh && x.title === 'written just before closing'), JSON.stringify(hist3.projects.flatMap((p) => p.sessions).map((x) => x.title)));

  // PowerShell
  await ev(`${pane('shell')}.querySelector('[data-act="close"]').click(); true`);
  t.check('one click closes a shell terminal too', !!(await poll(() => !byName('shell'), 8000, 50)));

  // אריח: מגדילים פאן, האחרים הופכים לאריחים, ולחיצה אחת על ה-X של אריח סוגרת
  const keep = byName('other');
  await ev(`import('/js/layout.js').then((m) => { m.setExpanded('${again.id}'); return true; })`);
  await page.waitFor(`document.querySelectorAll('.pane.tile').length >= 1`, 8000);
  const tileX = `document.querySelector('.pane.tile[data-id="${keep.id}"] [data-act="close"]')`;
  t.check('a tile has a close button', await ev(`!!${tileX}`));
  await ev(`${tileX}.click(); true`);
  t.check('one click on the × of a tile closes it', !!(await poll(() => !byName('other'), 8000, 50)));
  t.check('no JavaScript errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

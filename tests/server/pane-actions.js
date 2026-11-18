'use strict';
// @slow
/*
 * פעולות על טרמינל מצד השרת (T9): restart (רק טרמינל שיצא; נשאר במקומו בסדר; Claude ממשיך את אותו מזהה שיחה; PowerShell באותה תיקייה),
 * clear (מכריז cleared לכל החלונות), ו-POST /api/reveal (רק מזהה קיים, תמיד בתיקייה של הטרמינל, אף פעם לא נתיב מהלקוח; בבדיקות
 * לא מפעילים את Explorer אלא כותבים שורה לקובץ, TG_TEST_REVEAL_LOG).
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, strip } = require('../lib/harness');

function postReveal(port, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const rq = http.request({ host: '127.0.0.1', port, path: '/api/reveal', method: 'POST', headers: { Origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { /* not json */ } resolve({ status: r.statusCode, json: j }); });
    });
    rq.on('error', reject); rq.end(data);
  });
}

(async () => {
  const t = checker('pane actions (restart, clear, reveal)');
  const work = path.join(TMP, 'pane-actions-work');
  const dirs = ['a', 'b', 'c'].map((n) => { const d = path.join(work, n); fs.mkdirSync(d, { recursive: true }); return d; });
  const revealLog = path.join(TMP, 'reveal-log.txt');
  try { fs.unlinkSync(revealLog); } catch { /* none */ }
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args'), env: { TG_TEST_REVEAL_LOG: revealLog } });
  const c = await connect(srv.port);
  c.send({ t: 'create', kind: 'powershell', cwd: dirs[0], name: 'A' });
  c.send({ t: 'create', kind: 'claude', cwd: dirs[1], name: 'B' });
  c.send({ t: 'create', kind: 'powershell', cwd: dirs[2], name: 'C' });
  await poll(() => c.sessions.size === 3, 20000);
  const id = (n) => [...c.sessions.values()].find((s) => s.name === n).id;
  const [A, B, Cc] = [id('A'), id('B'), id('C')];
  c.send({ t: 'view', order: [A, B, Cc], expanded: B, focus: B });
  await sleep(500);
  await poll(() => /--session-id [0-9a-f-]{36}/.test(strip(c.out.get(B) || '')), 20000);
  const convo = /--session-id ([0-9a-f-]{36})/.exec(strip(c.out.get(B)))[1];
  const exited = (x) => c.messages.some((m) => m.t === 'exit' && m.id === x);

  // ---------- restart ----------
  const before = c.messages.length;
  c.send({ t: 'restart', id: B });
  await sleep(1200);
  t.check('restart of a RUNNING terminal is ignored', c.sessions.size === 3 && !c.messages.slice(before).some((m) => m.t === 'created' || m.t === 'closed'));

  c.send({ t: 'input', id: B, d: String.fromCharCode(3) });
  await sleep(1500);
  c.send({ t: 'input', id: B, d: 'y\r' }); // cmd שואל "Terminate batch job (Y/N)?" כשעוצרים קובץ .cmd (ה-claude המדומה)
  await sleep(1500);
  c.send({ t: 'input', id: B, d: 'exit\r' });
  t.check('the Claude terminal exits (typed exit after Ctrl+C)', await poll(() => exited(B), 25000, 200));
  const mark = c.messages.length;
  c.send({ t: 'restart', id: B });
  t.check('restart of the exited terminal creates a new one and closes the old one', await poll(() => c.messages.slice(mark).some((m) => m.t === 'created') && c.messages.slice(mark).some((m) => m.t === 'closed' && m.id === B), 20000, 200));
  const fresh = c.messages.slice(mark).find((m) => m.t === 'created').session;
  t.check('the new terminal is a Claude terminal with the same name and folder', fresh.kind === 'claude' && fresh.name === 'B' && fresh.cwd === dirs[1] && !fresh.exited, JSON.stringify([fresh.kind, fresh.name, fresh.cwd]));
  const view = c.messages.slice(mark).filter((m) => m.t === 'view').pop();
  t.check('it takes the old terminal place in the order (and keeps the expanded/focus mark)', !!view && JSON.stringify(view.view.order) === JSON.stringify([A, fresh.id, Cc]) && view.view.expanded === fresh.id && view.view.focus === fresh.id, JSON.stringify(view && view.view));
  t.check('the old session is gone', !c.sessions.has(B) || c.messages.slice(mark).some((m) => m.t === 'closed' && m.id === B));
  await poll(() => /--session-id/.test(strip(c.out.get(fresh.id) || '')), 20000);
  const args = strip(c.out.get(fresh.id) || '');
  t.check('the conversation id is reused (no transcript yet, so the same --session-id)', args.includes('--session-id ' + convo), args.slice(0, 160));

  // PowerShell: באותה תיקייה
  c.send({ t: 'input', id: A, d: 'exit\r' });
  t.check('the PowerShell terminal exits', await poll(() => exited(A), 20000, 200));
  const mark2 = c.messages.length;
  c.send({ t: 'restart', id: A });
  t.check('restarting a PowerShell terminal reopens it in the same folder, in the same place', await poll(() => c.messages.slice(mark2).some((m) => m.t === 'created'), 20000, 200)
    && c.messages.slice(mark2).find((m) => m.t === 'created').session.cwd === dirs[0]
    && JSON.stringify(c.messages.slice(mark2).filter((m) => m.t === 'view').pop().view.order) === JSON.stringify([c.messages.slice(mark2).find((m) => m.t === 'created').session.id, fresh.id, Cc]));

  // ---------- clear ----------
  const mark3 = c.messages.length;
  c.send({ t: 'clear', id: Cc });
  t.check('clear is broadcast to every window', await poll(() => c.messages.slice(mark3).some((m) => m.t === 'cleared' && m.id === Cc), 5000, 100));
  c.send({ t: 'clear', id: '9999' });
  await sleep(300);
  t.check('clear of an unknown id does nothing', !c.messages.slice(mark3).some((m) => m.t === 'cleared' && m.id === '9999'));

  // ---------- reveal ----------
  let r = await postReveal(srv.port, { id: '9999' });
  t.check('reveal rejects an unknown id (404)', r.status === 404, String(r.status));
  r = await postReveal(srv.port, { id: Cc, path: 'C:' + String.fromCharCode(92) + 'Windows', cwd: 'C:' + String.fromCharCode(92) + 'Windows' });
  t.check('reveal of a known id succeeds', r.status === 200 && r.json && r.json.ok === true, String(r.status));
  const logged = fs.existsSync(revealLog) ? fs.readFileSync(revealLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  t.check('it opens that terminal folder, never a path sent by the client (and in tests never starts Explorer)', logged.length === 1 && logged[0].id === Cc && logged[0].cwd === dirs[2], JSON.stringify(logged));
  r = await new Promise((resolve, reject) => {
    const data = JSON.stringify({ id: Cc });
    const rq = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/reveal', method: 'POST', headers: { Origin: 'http://evil.example', 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
    rq.on('error', reject); rq.end(data);
  });
  t.check('a request from another origin is refused (403)', r.status === 403, String(r.status));

  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

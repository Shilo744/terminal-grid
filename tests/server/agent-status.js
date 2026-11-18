'use strict';
// @slow
/*
 * סטטוס סוכן מ-hooks של Claude (T11), מצד השרת, עם claude מזויף שמדפיס את הארגומנטים והסביבה שלו (tests/fixtures/bin-agent):
 *  - טרמינל Claude רגיל נפתח עם --settings <קובץ קיים עם ארבעת ה-hooks> ועם TG_PANE_ID / TG_PORT; PowerShell לא;
 *  - POST /api/agent/event: עם x-tg מתקבל ומשודר {t:'agent'}, בלי x-tg נדחה, פאן לא מוכר נדחה, גוף גדול נדחה;
 *  - רשימה שמגיעה אחרי רענון כוללת את המצב; שחזור אחרי הפעלה מחדש של השרת מחזיר את ה-hooks;
 *  - אם אי אפשר לכתוב את קובץ ההגדרות הטרמינל נפתח בלי --settings (ובלי hooks) ולא נעצר.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, strip } = require('../lib/harness');

function postTg(port, urlPath, body, { tg = true, raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw != null ? raw : JSON.stringify(body || {});
    const headers = { Origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) };
    if (tg) headers['x-tg'] = '1';
    const rq = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'POST', headers }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { /* not json */ } resolve({ status: r.statusCode, json: j }); });
    });
    rq.on('error', reject);
    rq.end(data);
  });
}

const agentMsgs = (c, id) => c.messages.filter((m) => m.t === 'agent' && m.id === id);
const argsOf = (c, id) => { const m = /AGENTARGS: ([^|]*)/.exec(strip(c.out.get(id) || '')); return m ? m[1].trim() : ''; };
const envOf = (c, id) => { const m = /AGENTENV PANE=(\S*) PORT=(\S*) DUO=(\S*) END/.exec(strip(c.out.get(id) || '')); return m ? { pane: m[1], port: m[2], duo: m[3] } : null; };

(async () => {
  const t = checker('agent status from hooks (server)');
  const binDir = path.join(FIXTURES, 'bin-agent');
  const stateFile = path.join(TMP, 'agent-status-state.json');
  try { fs.unlinkSync(stateFile); } catch { /* none */ }
  const work = path.join(TMP, 'agent-status-work');
  fs.mkdirSync(work, { recursive: true });

  let srv = await startServer({ stateFile, binDir });
  let c = await connect(srv.port);
  c.send({ t: 'create', kind: 'claude', cwd: work, name: 'agent-a', reqId: 'a' });
  c.send({ t: 'create', kind: 'powershell', cwd: work, name: 'plain', reqId: 'p' });
  await poll(() => c.sessions.size === 2, 20000);
  const byName = (n) => [...c.sessions.values()].find((s) => s.name === n);
  const A = byName('agent-a'), P = byName('plain');
  t.check('both terminals created', !!A && !!P);
  t.check('a new Claude terminal starts as "starting" with source heuristic (no hook event yet)', A.agentState === 'starting' && A.agentSource === 'heuristic', JSON.stringify([A.agentState, A.agentSource]));
  t.check('a PowerShell terminal has no agent state', P.agentState === undefined && P.agentSource === undefined);

  await poll(() => /AGENTENV/.test(strip(c.out.get(A.id) || '')), 20000);
  const args = argsOf(c, A.id);
  const m = /--settings "?([^" ]+)"? --session-id ([0-9a-f-]{36})/.exec(args); // PowerShell מחזיר מרכאות רק לנתיב עם רווחים
  t.check('claude is launched with --settings <file> before --session-id <uuid>', !!m, args);
  const file = m && m[1];
  t.check('the settings file exists under tg-agents and is named after the conversation id', !!file && fs.existsSync(file) && /tg-agents/.test(file) && file.includes(m[2]));
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* checked below */ }
  t.check('it defines the four hooks', ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification'].every((k) => cfg.hooks && cfg.hooks[k] && /^node ".*hook-cli.js" (start|submit|stop|notify)$/.test(cfg.hooks[k][0].hooks[0].command)));
  const env = envOf(c, A.id);
  t.check('the environment carries TG_PANE_ID (the terminal id) and TG_PORT, and no duo id', !!env && env.pane === A.id && env.port === String(srv.port) && !env.duo, JSON.stringify(env));
  t.check('the plain PowerShell terminal did not get --settings', !/--settings/.test(argsOf(c, P.id)));

  // ---------- /api/agent/event ----------
  const ev = (body, opts) => postTg(srv.port, '/api/agent/event', body, opts);
  let r = await ev({ paneId: A.id, event: 'start' }, { tg: false });
  t.check('without the x-tg header the event is rejected (403)', r.status === 403);
  r = await ev({ paneId: '9999', event: 'start' });
  t.check('an unknown pane is rejected', r.status === 404, String(r.status));
  r = await ev({ paneId: P.id, event: 'start' });
  t.check('a terminal without hooks (PowerShell) is rejected', r.status === 404, String(r.status));
  // הגוף חורג מהמגבלה: השרת מנתק את החיבור (או עונה בשגיאה), ובכל מקרה כלום לא משתנה
  r = await ev(null, { raw: JSON.stringify({ paneId: A.id, event: 'start', message: 'x'.repeat(40000) }) }).catch(() => ({ status: 0 }));
  t.check('a body over 16 KB is rejected and changes nothing', (r.status === 0 || r.status >= 400) && agentMsgs(c, A.id).length === 0, String(r.status));

  const send = (body) => ev({ paneId: A.id, ...body });
  r = await send({ event: 'start', source: 'startup', transcriptPath: 'C:/x/y.jsonl' });
  t.check('SessionStart is accepted (200) and broadcast as idle', r.status === 200 && (await poll(() => agentMsgs(c, A.id).some((x) => x.state === 'idle'), 5000)));
  await send({ event: 'submit' });
  await send({ event: 'notify', notificationType: 'idle_prompt', message: 'Claude is waiting for your input' });
  await send({ event: 'notify', notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  await send({ event: 'stop' });
  await send({ event: 'submit' });
  await send({ event: 'stop' });
  await poll(() => agentMsgs(c, A.id).length >= 6, 8000);
  const seq = agentMsgs(c, A.id).map((x) => x.state);
  t.check('UserPromptSubmit / permission Notification / Stop produce working, attention, done, working, done (idle_prompt changes nothing)', seq.join() === 'idle,working,attention,done,working,done', seq.join());
  t.check('every message carries id, state, since and the hooks source', agentMsgs(c, A.id).every((x) => x.id === A.id && typeof x.since === 'number' && x.source === 'hooks'));

  // רענון: חיבור חדש מקבל את המצב ברשימה
  const c2 = await connect(srv.port);
  await poll(() => c2.sessions.size === 2, 10000);
  const A2 = c2.sessions.get(A.id);
  t.check('a window opened later gets the current state in the session list', A2.agentState === 'done' && A2.agentSource === 'hooks' && typeof A2.agentSince === 'number', JSON.stringify([A2.agentState, A2.agentSource]));
  c2.close();

  // ---------- שחזור ----------
  await sleep(700); // שמירת המצב (400ms)
  c.close(); srv.stop();
  await sleep(800);
  const oldId = m[2];
  srv = await startServer({ stateFile, binDir, keepState: true });
  c = await connect(srv.port);
  await poll(() => c.sessions.size === 2, 20000);
  const A3 = [...c.sessions.values()].find((s) => s.name === 'agent-a');
  t.check('after a server restart the restored Claude terminal is tracked again (starting)', !!A3 && A3.agentState === 'starting' && A3.agentSource === 'heuristic', A3 && JSON.stringify([A3.agentState, A3.agentSource]));
  await poll(() => /AGENTENV/.test(strip(c.out.get(A3.id) || '')), 20000);
  const args3 = argsOf(c, A3.id);
  const m3 = /--settings "?([^" ]+)"? (--session-id|--resume) ([0-9a-f-]{36})/.exec(args3);
  t.check('restore keeps hooks on: --settings <file> then the same conversation id', !!m3 && m3[3] === oldId && fs.existsSync(m3[1]), args3);
  c.close(); srv.stop();

  // ---------- אי אפשר לכתוב את קובץ ההגדרות ----------
  await sleep(500);
  try { fs.unlinkSync(stateFile); } catch { /* none */ }
  // TEMP שמצביע על קובץ (לא תיקייה): mkdir של tg-agents בתוכו נכשל
  srv = await startServer({ stateFile, binDir, env: { TEMP: __filename, TMP: __filename } });
  c = await connect(srv.port);
  c.send({ t: 'create', kind: 'claude', cwd: work, name: 'no-hooks', reqId: 'n' });
  await poll(() => c.sessions.size === 1, 20000);
  const N = [...c.sessions.values()][0];
  t.check('when the settings file cannot be written the terminal still opens (heuristic, no hooks)', !!N && N.agentSource === 'heuristic' && N.agentState === undefined && !N.exited);
  await poll(() => /AGENTARGS/.test(strip(c.out.get(N.id) || '')), 20000);
  const argsN = argsOf(c, N.id);
  t.check('and claude starts without --settings (still with --session-id)', !/--settings/.test(argsN) && /--session-id [0-9a-f-]{36}/.test(argsN), argsN);
  r = await postTg(srv.port, '/api/agent/event', { paneId: N.id, event: 'start' });
  t.check('events for such a terminal are rejected', r.status === 404);
  c.close(); srv.stop();

  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

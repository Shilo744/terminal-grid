'use strict';
// server/duo/hook-cli.js (מופעל על ידי ה-hooks של Claude Code): לאן הוא שולח, מה הוא שולח, ושהוא אף פעם לא מדפיס ולא נכשל.
//   TG_PANE_ID  -> POST /api/agent/event (טרמינל Claude רגיל);  TG_DUO_ID -> POST /api/duo/event (סוכן בזוג);  בלי אף אחד -> לא שולח כלום.
//   שני המסלולים מעבירים גם transcript_path ו-source (משימות עתידיות), ותמיד מוסיפים x-tg.
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { checker } = require('../lib/harness');

const CLI = path.join(__dirname, '..', '..', 'server', 'duo', 'hook-cli.js');

(async () => {
  const t = checker('hook-cli (unit)');
  const got = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => { got.push({ url: req.url, tg: req.headers['x-tg'], body: JSON.parse(b) }); res.end('{}'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const run = (env, event, input, { port: p = port } = {}) => new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI, event], { env: { PATH: process.env.PATH, TG_PORT: String(p), ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('exit', (code) => resolve({ code, out }));
    c.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });

  const r1 = await run({ TG_PANE_ID: '7' }, 'start', { session_id: 's1', transcript_path: 'C:/t.jsonl', source: 'resume' });
  t.check('terminal mode: exits 0 and prints nothing', r1.code === 0 && r1.out === '');
  t.check('terminal mode posts to /api/agent/event with x-tg', got.length === 1 && got[0].url === '/api/agent/event' && got[0].tg === '1');
  t.check('it sends paneId, event, sessionId, transcriptPath and source', JSON.stringify(got[0].body) === JSON.stringify({ paneId: '7', event: 'start', sessionId: 's1', transcriptPath: 'C:/t.jsonl', source: 'resume' }), JSON.stringify(got[0].body));

  await run({ TG_PANE_ID: '7' }, 'notify', { notification_type: 'permission_prompt', message: 'x'.repeat(1000) });
  t.check('notification type is forwarded and the message is cut to 300 chars', got[1].body.notificationType === 'permission_prompt' && got[1].body.message.length === 300);

  await run({ TG_DUO_ID: 'd1', TG_DUO_ROLE: 'worker' }, 'stop', { session_id: 's2', transcript_path: 'C:/u.jsonl', last_assistant_message: 'done' });
  t.check('duo mode still posts to /api/duo/event', got[2].url === '/api/duo/event' && got[2].body.duoId === 'd1' && got[2].body.role === 'worker' && got[2].body.last === 'done');
  t.check('duo mode forwards transcript_path too (for later features)', got[2].body.transcriptPath === 'C:/u.jsonl');

  await run({ TG_DUO_ID: 'd1', TG_DUO_ROLE: 'architect', TG_PANE_ID: '9' }, 'start', {});
  t.check('a duo agent that also has a pane id still reports as a duo agent', got[3].url === '/api/duo/event');

  const before = got.length;
  const r4 = await run({}, 'notify', { notification_type: 'permission_prompt' });
  t.check('without TG_PANE_ID and TG_DUO_ID nothing is sent (Claude started outside Terminal Grid)', r4.code === 0 && r4.out === '' && got.length === before);

  const r5 = await run({ TG_PANE_ID: '7' }, 'stop', 'this is not json');
  t.check('garbage on stdin: still exits 0, silently, and reports the event', r5.code === 0 && r5.out === '' && got[got.length - 1].body.event === 'stop');

  const BOM = String.fromCharCode(0xFEFF); // PowerShell מוסיף BOM כשמעבירים טקסט בצינור
  await run({ TG_PANE_ID: '7' }, 'notify', BOM + JSON.stringify({ notification_type: 'permission_prompt', session_id: 'sbom' }));
  t.check('a UTF-8 BOM at the start of stdin does not break parsing', got[got.length - 1].body.notificationType === 'permission_prompt' && got[got.length - 1].body.sessionId === 'sbom', JSON.stringify(got[got.length - 1].body));

  const r6 = await run({ TG_PANE_ID: '7' }, 'stop', {}, { port: 1 });
  t.check('server not reachable: exits 0 and prints nothing (never blocks Claude)', r6.code === 0 && r6.out === '');

  srv.close();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

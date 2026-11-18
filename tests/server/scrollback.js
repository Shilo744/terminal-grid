'use strict';
// The scrollback setting reaches NEW terminals on the server (the headless terminal that restores the screen after a reload):
// with 1000 lines allowed, a terminal that printed 2500 lines keeps only the last ~1000 (+ the visible screen).
const { sleep, poll, checker, startServer, connect } = require('../lib/harness');

(async () => {
  const t = checker('scrollback follows the setting for new terminals');
  const srv = await startServer({});
  const c = await connect(srv.port);
  await poll(() => c.settings, 8000);
  c.send({ t: 'settings:set', patch: { terminal: { scrollback: 1000 } } });
  await poll(() => c.settings && c.settings.terminal.scrollback === 1000, 8000);
  c.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'S', reqId: 'a' });
  await poll(() => c.sessions.size === 1, 10000);
  const id = [...c.sessions.keys()][0];
  await poll(() => (c.out.get(id) || '').includes('PS '), 15000); // ה-prompt של PowerShell הופיע: אפשר להקליד
  c.send({ t: 'input', id, d: '1..2500 | % { "LINE$_" }\r' });
  await poll(() => /LINE2500/.test(c.out.get(id) || ''), 30000);
  await sleep(500);

  const c2 = await connect(srv.port); // a fresh window gets the serialized screen + history
  await poll(() => c2.sessions.get(id) && /LINE2500/.test(c2.sessions.get(id).snapshot), 8000);
  const snap = c2.sessions.get(id).snapshot;
  const nums = [...snap.matchAll(/LINE(\d+)/g)].map((m) => Number(m[1]));
  const lo = Math.min(...nums), hi = Math.max(...nums);
  t.check('the newest output is there', hi === 2500, 'max ' + hi);
  t.check('the history was cut to about 1000 lines + the screen', lo > 2500 - 1000 - 150 && lo < 2500 - 900, `oldest kept LINE${lo}`);

  c.close(); c2.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });

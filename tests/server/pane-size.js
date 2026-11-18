'use strict';
// @slow
/*
 * An agent of a pair starts at the size its pane had last time. A Claude that draws its screen at the default 120 columns and is then resized to the
 * pane's width while it works leaves torn, overlapping lines in the terminal. The size is kept in state.json, per role, and a terminal is never made smaller than 20x4.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect } = require('../lib/harness');

(async () => {
  const t = checker('duo: agents start at the size of their last pane');
  const project = path.join(TMP, `pane-size-${Date.now()}`);
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  const stateFile = path.join(TMP, `pane-size-state-${Date.now()}.json`);
  const env = { binDir: path.join(FIXTURES, 'bin-duo'), stateFile };
  const roleOf = (c, role) => [...c.sessions.values()].find((s) => s.duo && s.duo.role === role);

  let srv = await startServer(env);
  let c = await connect(srv.port);
  c.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'r' });
  await poll(() => c.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  const arch = await poll(() => roleOf(c, 'architect'), 20000);
  const work = await poll(() => roleOf(c, 'worker'), 20000);
  t.check('a new pair starts at the default size (nothing known yet)', arch.cols === 120 && arch.rows === 32, JSON.stringify({ cols: arch.cols, rows: arch.rows }));
  c.send({ t: 'resize', id: arch.id, cols: 90, rows: 30 });
  c.send({ t: 'resize', id: work.id, cols: 70, rows: 41 });
  c.send({ t: 'resize', id: work.id, cols: 3, rows: 2 }); // a pane that is momentarily tiny
  await sleep(1800);
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')).paneSize;
  t.check('the sizes are kept in state.json per role, and the tiny size was refused (clamped to 20x4)', saved && saved.architect.cols === 90 && saved.architect.rows === 30 && saved.worker.cols === 20 && saved.worker.rows === 4, JSON.stringify(saved));
  c.send({ t: 'resize', id: work.id, cols: 70, rows: 41 });
  await sleep(1800);
  c.close(); srv.stop(); await sleep(500);

  srv = await startServer({ ...env, keepState: true });
  c = await connect(srv.port);
  const a2 = await poll(() => roleOf(c, 'architect'), 20000);
  const w2 = await poll(() => roleOf(c, 'worker'), 20000);
  t.check('after a restart the pair\'s terminals start at those sizes', a2.cols === 90 && a2.rows === 30 && w2.cols === 70 && w2.rows === 41, JSON.stringify({ a: [a2.cols, a2.rows], w: [w2.cols, w2.rows] }));
  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

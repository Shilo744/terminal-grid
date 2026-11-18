'use strict';
// @slow
/*
 * A closed pair can be brought back: closing it puts it in the "closed" list (kept in state.json, so it survives a server restart),
 * "reopen" creates the pair again with the same id, the same agent conversations (resume) and the tasks that are in its .duo folder, paused.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect } = require('../lib/harness');

const latest = (c) => { for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'state') return m.duo; } return null; };
const closedList = (c) => { for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'closed') return m.list; if (m.t === 'list') return m.duosClosed || []; } return null; };

(async () => {
  const t = checker('duo: a closed pair can be reopened');
  const project = path.join(TMP, `duo-reopen-${Date.now()}`);
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  const stateFile = path.join(TMP, `duo-reopen-state-${Date.now()}.json`);
  const env = { binDir: path.join(FIXTURES, 'bin-duo'), stateFile };

  let srv = await startServer(env);
  let c = await connect(srv.port);
  c.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'r' });
  const created = await poll(() => c.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  const id = created.duoId;
  await poll(() => { const d = latest(c); return d && d.agents.worker.state === 'idle' && d.agents.architect.state === 'idle'; }, 30000);
  fs.appendFileSync(path.join(project, '.duo', 'TASKS.md'), '\n- [ ] T1 — first\n  do it\n- [ ] T2 — second\n  do it too\n');
  await poll(() => { const d = latest(c); return d && d.tasks.counts.done === 2 ? d : null; }, 60000, 300);

  c.send({ t: 'duo', op: 'close', duoId: id });
  const list = await poll(() => { const l = closedList(c); return l && l.length ? l : null; }, 15000);
  t.check('closing a pair puts it in the closed list (with its folder and progress)', !!list && list[0].id === id && list[0].project === project && list[0].total >= 2, JSON.stringify(list));
  await sleep(1500); // the state file is written a moment after the change
  const ids = (list) => (list && list[0] ? Object.values(list[0].agents).map((a) => a.claudeId).filter(Boolean).sort() : []);
  const savedClosed = JSON.parse(fs.readFileSync(stateFile, 'utf8')).closedDuos;
  const claudeIds = ids(savedClosed);
  c.close(); srv.stop(); await sleep(500);

  srv = await startServer({ ...env, keepState: true }); // the closed pair survives a server restart (state.json)
  c = await connect(srv.port);
  const l2 = await poll(() => { const l = closedList(c); return l && l.length ? l : null; }, 15000);
  t.check('the closed list survives a server restart', !!l2 && l2[0].id === id, JSON.stringify(l2));

  c.send({ t: 'duo', op: 'reopen', closedId: id, reqId: 'ro' });
  const back = await poll(() => c.messages.find((m) => m.t === 'duo' && m.op === 'created' && m.reqId === 'ro'), 20000);
  t.check('reopen brings the pair back with the same id', !!back && back.duoId === id, JSON.stringify(back));
  const d = await poll(() => { const x = latest(c); return x && x.id === id && x.agents.worker.state === 'idle' ? x : null; }, 30000);
  t.check('it comes back paused (nothing starts on its own) with the tasks of its .duo folder', !!d && d.paused === true && d.tasks.counts.done === 2, JSON.stringify(d && { paused: d.paused, tasks: d.tasks.counts }));
  t.check('it is no longer in the closed list', (closedList(c) || []).every((x) => x.id !== id), JSON.stringify(closedList(c)));
  await sleep(1500);
  const after = ids(JSON.parse(fs.readFileSync(stateFile, 'utf8')).duos);
  t.check('the agents resumed their old conversations (same Claude conversation ids)', claudeIds.length === 2 && JSON.stringify(after) === JSON.stringify(claudeIds), JSON.stringify({ before: claudeIds, after }));

  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

'use strict';
// Manual: run one fake duo and print its timeline (events, alerts, files). Usage: node tests/tools/duo-debug.js [seconds]
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, startServer, connect } = require('../lib/harness');

(async () => {
  const seconds = Number(process.argv[2]) || 20;
  const project = path.join(TMP, 'duo-debug-' + Date.now());
  fs.mkdirSync(project, { recursive: true });
  const srv = await startServer({ stateFile: path.join(TMP, 'duo-debug-state.json'), binDir: path.join(FIXTURES, 'bin-duo') });
  const c = await connect(srv.port);
  c.send({ t: 'duo', op: 'create', project, goal: 'Build the thing', reqId: 'x' });
  const t0 = Date.now();
  let lastEvents = 0;
  while (Date.now() - t0 < seconds * 1000) {
    await sleep(1000);
    let d = null;
    for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'state') { d = m.duo; break; } }
    if (!d) continue;
    for (const e of d.events.slice(lastEvents)) console.log(`${((e.t - t0) / 1000).toFixed(1).padStart(5)}s  ${(e.role || '-').padEnd(9)} ${e.text}${e.detail ? ' — ' + e.detail : ''}`);
    lastEvents = d.events.length;
  }
  let d = null;
  for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'state') { d = m.duo; break; } }
  console.log('\nstates:', d && JSON.stringify({ a: d.agents.architect.state, w: d.agents.worker.state, wakes: [d.agents.architect.wakes, d.agents.worker.wakes], tasks: d.tasks.counts }));
  console.log('alerts:', d && JSON.stringify(d.alerts.map((a) => a.text)));
  console.log('\n--- TASKS.md ---\n' + fs.readFileSync(path.join(project, '.duo', 'TASKS.md'), 'utf8'));
  console.log('--- STATUS.json (feed) ---\n' + fs.readFileSync(path.join(project, '.duo', 'STATUS.json'), 'utf8'));
  c.close(); srv.stop();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });

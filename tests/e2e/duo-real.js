'use strict';
// OPT-IN (spends a little model usage, not part of `npm test`): a duo of REAL Claude agents builds a tiny page in THREE tasks (protocol v3: the worker gets one goal, the Stop hook carries it on).
// Usage: node tests/e2e/duo-real.js [minutes=6]
// Confirms with real models what the fake agents cannot: the role prompts are followed, the hooks fire, the injected
// [duo] prompts are accepted, and the file protocol works. Prints the timeline, the files and a verdict.
const path = require('path');
const fs = require('fs');
const { TMP, REAL_HOME, sleep, strip, checker, startServer, connect } = require('../lib/harness');

(async () => {
  const minutes = Number(process.argv[2]) || 6;
  const t = checker('real Claude duo (tiny task)');
  // תיקייה קבועה (כך Claude שומר אמון פעם אחת בלבד); מנקים רק את הקבצים שהבדיקה עצמה יוצרת
  const project = path.join(TMP, 'duo-real-sandbox');
  fs.mkdirSync(project, { recursive: true });
  for (const f of ['index.html', 'style.css', 'app.js']) { try { fs.unlinkSync(path.join(project, f)); } catch { /* אין */ } }
  try { fs.rmSync(path.join(project, '.duo'), { recursive: true, force: true }); } catch { /* נעול */ } // כל קבצי הזוג (תור, ארכיון, תיבות, STATUS) מתחילים נקיים
  // real claude on PATH, and the REAL home (its login and settings live there; the harness gives tests a throw-away home, where Claude would stop at its first-run screens)
  const drive = path.parse(REAL_HOME).root.replace(/[\/]+$/, '');
  const srv = await startServer({ stateFile: path.join(TMP, 'duo-real-state.json'), env: { USERPROFILE: REAL_HOME, HOME: REAL_HOME, HOMEDRIVE: drive, HOMEPATH: REAL_HOME.slice(drive.length), LOCALAPPDATA: process.env.TG_REAL_LOCALAPPDATA, APPDATA: process.env.TG_REAL_APPDATA } });
  const c = await connect(srv.port);
  c.send({ t: 'duo', op: 'create', project, permissionMode: 'acceptEdits',
    goal: 'Tiny test of the two-agent workflow. Build a tiny web page in the project root as exactly THREE separate small tasks, in this order: (1) index.html with an h1 saying Hello Duo and a link to style.css and a script tag for app.js; (2) style.css that makes the h1 blue; (3) app.js that sets document.title to Hello Duo. Plain files, no tools, no installs. Write the three tasks at once, then finish your turn.', reqId: 'r' });
  const t0 = Date.now();
  const latest = () => { for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'state') return m.duo; } return null; };
  let shown = 0;
  let done = false;
  const trusted = new Set();
  // תיקייה חדשה ל-Claude עוצרת בשאלת אמון. הבדיקה עונה "כן" רק בתיקיית ארגז החול שלה (חץ למטה + Enter)
  const answerTrust = () => { for (const [id, out] of c.out) { if (!trusted.has(id) && /trust this folder/i.test(strip(out))) { trusted.add(id); c.send({ t: 'input', id, d: '\x1b[B' }); setTimeout(() => c.send({ t: 'input', id, d: '\r' }), 300); console.log('answered the folder-trust question for terminal', id); } } };
  while (Date.now() - t0 < minutes * 60 * 1000 && !done) {
    await sleep(2000);
    answerTrust();
    const d = latest();
    if (!d) continue;
    for (const e of d.events.slice(shown)) console.log(`${((e.t - t0) / 1000).toFixed(0).padStart(4)}s  ${(e.role || '-').padEnd(9)} ${e.text}${e.detail ? ' — ' + e.detail.replace(/\s+/g, ' ').slice(0, 120) : ''}`);
    shown = d.events.length;
    done = ['index.html', 'style.css', 'app.js'].every((f) => fs.existsSync(path.join(project, f))) && d.tasks.open === 0 && d.tasks.counts.done >= 3 && d.agents.architect.state === 'idle' && d.agents.worker.state === 'idle'
      && Date.now() - Math.max(d.agents.architect.lastStopAt, d.agents.worker.lastStopAt) > 8000;
  }
  const d = latest();
  console.log('\nfinal:', d && JSON.stringify({ architect: d.agents.architect.state, worker: d.agents.worker.state, wakes: [d.agents.architect.wakes, d.agents.worker.wakes], tasks: d.tasks.counts }));
  console.log('alerts:', d && JSON.stringify(d.alerts.map((a) => a.text)));
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '(missing)');
  console.log('\n--- TASKS.md ---\n' + read(path.join(project, '.duo', 'TASKS.md')).replace(/<!--[\s\S]*?-->/g, '').trim());
  console.log('\n--- archive/TASKS-done-1.md ---\n' + read(path.join(project, '.duo', 'archive', 'TASKS-done-1.md')).trim());
  console.log('\n--- technical log ---\n' + (d ? d.tech.map((e) => `${e.role || '-'}: ${e.text}`).join('\n') : ''));
  console.log('\n--- INBOX-architect.md ---\n' + read(path.join(project, '.duo', 'INBOX-architect.md')).trim());
  console.log('\n--- board feed ---\n' + (d ? d.feed.map((e) => `[${e.time}] ${e.author}: ${e.body.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n') : ''));
  t.check('the three files exist and look right', ['index.html', 'style.css', 'app.js'].every((f) => fs.existsSync(path.join(project, f))) && /Hello Duo/.test(read(path.join(project, 'index.html'))) && /blue/i.test(read(path.join(project, 'style.css'))) && /title/.test(read(path.join(project, 'app.js'))));
  t.check('the architect wrote at least three tasks', !!d && d.tasks.counts.done >= 3);
  t.check('every task is done (archived, counted) and TASKS.md holds no finished task', !!d && d.tasks.open === 0 && d.tasks.counts.done >= 3 && !/^- \[x\]/m.test(read(path.join(project, '.duo', 'TASKS.md'))));
  t.check('the finished task was archived with a Result line', /Result:/.test(read(path.join(project, '.duo', 'archive', 'TASKS-done-1.md'))));
  t.check('the worker was given its goal (few wakes for three tasks, not one per task) and the architect was not woken for reviews', !!d && d.agents.worker.wakes >= 1 && d.agents.worker.wakes <= 2 && d.agents.architect.wakes === 1, `wakes ${d && d.agents.architect.wakes}/${d && d.agents.worker.wakes}`);
  t.check('the Stop hook sent the worker back to work between tasks at least once', !!d && d.tech.some((e) => /ה-hook של Stop מחזיר/.test(e.text)), JSON.stringify(d && d.tech.map((e) => e.text).slice(-8)));
  t.check('both agents were woken by the system (not by hand)', !!d && d.agents.architect.wakes >= 1 && d.agents.worker.wakes >= 1, `wakes ${d && d.agents.architect.wakes}/${d && d.agents.worker.wakes}`);
  t.check('no warnings were raised', !!d && d.alerts.length === 0, d ? JSON.stringify(d.alerts.map((a) => a.text)) : '');
  const arch = [...c.sessions.values()].find((s) => s.duo && s.duo.role === 'architect');
  if (arch) console.log('\narchitect screen tail:', strip(c.out.get(arch.id) || '').slice(-300));
  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

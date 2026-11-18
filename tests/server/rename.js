'use strict';
// @slow
/*
 * שינוי שם בצד השרת (T56): שם לזוג (duo op rename) ושם מותאם לפרויקט בתפריט הצד (ws projectName), עם אימות, שידור, ושמירה אחרי הפעלה מחדש של השרת.
 * (שם של טרמינל, ההודעה rename, נבדק ב-restore.js.)
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect } = require('../lib/harness');

const latest = (c) => { for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'state') return m.duo; } return null; };
const lastNames = (c) => { for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'projectNames') return m.names; } return null; };

(async () => {
  const t = checker('rename: pairs and side-menu projects (server)');
  const project = path.join(TMP, 'rename-pair-' + Date.now());
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [x] T1 — done\n  Result: ok\n');
  fs.writeFileSync(path.join(project, '.duo', 'CHAT.md'), '\n### architect · 09:00\nHi.\n');
  const stateFile = path.join(TMP, 'rename-state.json');
  let srv = await startServer({ stateFile, binDir: path.join(FIXTURES, 'bin-duo') });
  let c = await connect(srv.port);
  c.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'r' });
  const created = await poll(() => c.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  const duoId = created.duoId;
  c.send({ t: 'duo', op: 'pause', duoId });
  await poll(() => latest(c) && latest(c).agents.architect.state === 'idle', 30000);
  const name = () => latest(c).name;
  const send = async (n) => { c.send({ t: 'duo', op: 'rename', duoId, name: n }); await sleep(450); };

  t.check('a pair starts with the project folder name', name() === path.basename(project), name());
  await send('הזוג של האתר');
  t.check('rename: the new (Hebrew) name is in the broadcast state', name() === 'הזוג של האתר', name());
  await send('   ');
  t.check('an empty or blank name changes nothing', name() === 'הזוג של האתר');
  await send('x'.repeat(200));
  t.check('a long name is cut to 60 characters', name() === 'x'.repeat(60), String(name() && name().length));
  await send('a\u0000b\u0007c\n\td   e');
  t.check('control characters and runs of spaces are cleaned', name() === 'a b c d e', JSON.stringify(name()));
  c.send({ t: 'duo', op: 'rename', duoId, name: 12345 }); c.send({ t: 'duo', op: 'rename', duoId, name: null }); c.send({ t: 'duo', op: 'rename', duoId: 'nope', name: 'zzz' });
  await sleep(450);
  t.check('a non-string name, null and an unknown pair are ignored', name() === 'a b c d e');
  await send('השם השמור');
  t.check('the agent roles stay fixed (the snapshot has no role names to change, the sessions keep their tags)', [...c.sessions.values()].filter((s) => s.duo).map((s) => s.duo.role).sort().join() === 'architect,worker');

  /* ---------- שמות פרויקטים בתפריט הצד ---------- */
  const proj = 'C:\\work\\My Project';
  c.send({ t: 'projectName', path: proj, name: 'הפרויקט שלי' });
  await poll(() => lastNames(c) && lastNames(c)['c:\\work\\my project'] === 'הפרויקט שלי', 5000, 50);
  t.check('a project name is stored by the normalized path (case-insensitive)', !!lastNames(c) && lastNames(c)['c:\\work\\my project'] === 'הפרויקט שלי', JSON.stringify(lastNames(c)));
  const c2 = await connect(srv.port);
  await poll(() => c2.messages.find((m) => m.t === 'list'), 10000, 50);
  const list = c2.messages.find((m) => m.t === 'list');
  t.check('a new window gets the names with the list', !!list && list.projectNames && list.projectNames['c:\\work\\my project'] === 'הפרויקט שלי', JSON.stringify(list && list.projectNames));
  c2.send({ t: 'projectName', path: 'c:/WORK/my project/', name: 'שם אחר' });
  await sleep(400);
  t.check('the same folder written with other case and slashes is the same project (and the other window sees the broadcast)', lastNames(c)['c:\\work\\my project'] === 'שם אחר' && Object.keys(lastNames(c)).length === 1, JSON.stringify(lastNames(c)));
  c.send({ t: 'projectName', path: proj, name: 'y'.repeat(100) });
  await sleep(400);
  t.check('a long project name is cut to 60', lastNames(c)['c:\\work\\my project'] === 'y'.repeat(60));
  c.send({ t: 'projectName', path: 5, name: 'bad' }); c.send({ t: 'projectName', name: 'no path' }); c.send({ t: 'projectName', path: 'z'.repeat(500), name: 'too long path' });
  await sleep(400);
  t.check('a bad path (not a string, missing, over 400 characters) is ignored', Object.keys(lastNames(c)).length === 1);
  c.send({ t: 'projectName', path: proj, name: 'שם שנשמר' });
  await sleep(400);
  c2.close();
  c.send({ t: 'projectName', path: 'D:\\other', name: 'will be removed' });
  await sleep(300);
  c.send({ t: 'projectName', path: 'D:\\other', name: '' });
  await sleep(400);
  t.check('an empty name removes the custom name (back to the folder name)', !('d:\\other' in lastNames(c)) && lastNames(c)['c:\\work\\my project'] === 'שם שנשמר');

  /* ---------- שמירה אחרי הפעלה מחדש ---------- */
  await sleep(600);
  c.close(); srv.stop();
  await sleep(1500);
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  t.check('state.json holds the pair name and the project names', saved.duos.some((d) => d.name === 'השם השמור') && saved.projectNames['c:\\work\\my project'] === 'שם שנשמר', JSON.stringify({ duos: saved.duos.map((d) => d.name), p: saved.projectNames }));
  srv = await startServer({ stateFile, binDir: path.join(FIXTURES, 'bin-duo'), keepState: true });
  c = await connect(srv.port);
  const back = await poll(() => latest(c) || (c.messages.find((m) => m.t === 'list' && m.duos && m.duos.length) || {}).duos, 20000, 100);
  const again = (c.messages.find((m) => m.t === 'list') || {});
  t.check('after a server restart the pair keeps its name', !!back && (latest(c) ? latest(c).name : back[0].name) === 'השם השמור', JSON.stringify(back && (back.name || back[0].name)));
  t.check('...and the project names come back with the list', !!again.projectNames && again.projectNames['c:\\work\\my project'] === 'שם שנשמר', JSON.stringify(again.projectNames));
  c.close(); srv.stop();

  /* ---------- שמות פרויקטים נטענים גם כשאין טרמינלים ---------- */
  const empty = path.join(TMP, 'rename-empty-state.json');
  fs.writeFileSync(empty, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), sessions: [], expanded: null, focus: null, duos: [], projectNames: { 'c:\\a\\b': 'לבד' } }));
  srv = await startServer({ stateFile: empty, keepState: true });
  c = await connect(srv.port);
  const l2 = await poll(() => c.messages.find((m) => m.t === 'list'), 10000, 50);
  t.check('project names load even when no terminal or pair is saved', !!l2 && l2.projectNames && l2.projectNames['c:\\a\\b'] === 'לבד', JSON.stringify(l2 && l2.projectNames));
  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

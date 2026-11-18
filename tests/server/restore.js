'use strict';
// @slow: לא רץ ב-npm run test:quick (ארוך, תלוי בסוכנים/טרמינלים אמיתיים)
// Save & restore: create terminals, rename/reorder/expand, close the window, the server must save and exit,
// and a fresh server must bring back the same terminals. Uses a fake `claude` that prints its arguments.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, fakeTranscript } = require('../lib/harness');

// a saved conversation so the "--resume" branch is exercised: a FAKE one in the temporary test home (the harness points USERPROFILE there), never the real ~/.claude
const anyTranscriptId = () => fakeTranscript();

(async () => {
  const t = checker('save / restore');
  const binDir = path.join(FIXTURES, 'bin-args');
  const stateFile = path.join(TMP, 'restore-state.json');
  try { fs.unlinkSync(stateFile); } catch { /* none */ }
  const KNOWN = anyTranscriptId();
  const HOME = os.homedir();
  const DOWNLOADS = path.join(HOME, 'Downloads');

  let srv = await startServer({ stateFile, binDir });
  let c = await connect(srv.port);
  await sleep(500);
  c.send({ t: 'create', kind: 'powershell', cwd: DOWNLOADS, reqId: 'a' });
  c.send({ t: 'create', kind: 'claude', cwd: HOME, reqId: 'b' });
  c.send({ t: 'create', kind: 'claude', cwd: HOME, resume: KNOWN, reqId: 'c' });
  await poll(() => c.sessions.size === 3, 15000);
  const ids = [...c.sessions.keys()];
  t.check('3 terminals created', ids.length === 3, ids.join(','));
  const [a, b, cc] = ids;
  c.send({ t: 'rename', id: b, name: 'שם בדיקה' });
  c.send({ t: 'view', order: [cc, b, a], expanded: b, focus: cc });
  // הפלט של claude המזויף (שורת הפקודה שלו) מגיע רגע אחרי היצירה
  await poll(() => /--session-id [0-9a-f-]{36}/.test(c.out.get(b) || '') && (c.out.get(cc) || '').includes('--resume'), 15000);
  const outB = c.out.get(b) || '', outC = c.out.get(cc) || '';
  const newId = /--session-id ([0-9a-f-]{36})/.exec(outB);
  t.check('new claude launched with --session-id <uuid>', !!newId, newId ? newId[1] : outB.slice(-100));
  t.check('opened conversation launched with --resume <id>', outC.includes('--resume ' + KNOWN), outC.slice(-100));
  c.send({ t: 'create', kind: 'claude', cwd: HOME, resume: KNOWN, reqId: 'dup' });
  t.check('same conversation cannot be opened twice', !!(await poll(() => c.errors.some((e) => e.reqId === 'dup'), 8000)));

  c.close();
  for (let i = 0; i < 40 && !srv.child.exited; i++) await sleep(500);
  t.check('server exited after the window closed', srv.child.exited);
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  t.check('state file kept the 3 terminals', st.sessions.length === 3);
  t.check('state keeps order', st.sessions[0].claudeId === KNOWN && st.sessions[1].name === 'שם בדיקה' && st.sessions[2].kind === 'powershell');
  t.check('state keeps expanded/focus', st.expanded === 1 && st.focus === 0, `expanded=${st.expanded} focus=${st.focus}`);

  srv = await startServer({ stateFile, binDir, keepState: true });
  c = await connect(srv.port);
  await poll(() => c.sessions.size === 3 && c.view && c.view.order && c.view.order.length === 3, 30000);
  await poll(() => [...c.sessions.values()].every((s) => /--(resume|session-id)/.test(c.out.get(s.id) || '') || s.kind === 'powershell'), 20000);
  const list = [...c.sessions.values()];
  t.check('3 terminals came back by themselves', list.length === 3, list.map((s) => `${s.kind}:${s.name}`).join(' | '));
  const renamed = list.find((s) => s.name === 'שם בדיקה');
  const resumed = list.find((s) => s.kind === 'claude' && s.name !== 'שם בדיקה');
  const ps = list.find((s) => s.kind === 'powershell');
  t.check('renamed terminal keeps its name', !!renamed);
  t.check('powershell back in the same folder', !!ps && ps.cwd.endsWith('Downloads'));
  t.check('known conversation re-opened with --resume', !!resumed && (c.out.get(resumed.id) || '').includes('--resume ' + KNOWN));
  t.check('unsent conversation re-opened with the SAME --session-id', !!newId && !!renamed && (c.out.get(renamed.id) || '').includes('--session-id ' + newId[1]));
  t.check('order + expanded + focus restored', !!c.view && c.view.order[0] === resumed.id && c.view.order[1] === renamed.id && c.view.expanded === renamed.id && c.view.focus === resumed.id, JSON.stringify(c.view));

  c.send({ t: 'close', id: ps.id });
  await sleep(1200); // השרת שומר את המצב אחרי 400ms (persist); ממתינים שהסגירה תישמר לפני שסוגרים את החלון
  c.close();
  for (let i = 0; i < 40 && !srv.child.exited; i++) await sleep(500);
  const st2 = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  t.check('explicitly closed terminal is not restored', st2.sessions.length === 2 && !st2.sessions.some((s) => s.kind === 'powershell'));
  srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

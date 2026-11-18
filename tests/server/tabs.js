'use strict';
// T60: grid tabs on the server: the view is { tabs, active }, validated, persisted (indices in state.json), restored after a restart,
// the old single-view message edits the active tab, closing a terminal removes it from its tab, and an old state file becomes one tab.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect } = require('../lib/harness');

(async () => {
  const t = checker('grid tabs (server)');
  const binDir = path.join(FIXTURES, 'bin-args');
  const stateFile = path.join(TMP, 'tabs-state.json');
  try { fs.unlinkSync(stateFile); } catch { /* none */ }
  const HOME = os.homedir();

  let srv = await startServer({ stateFile, binDir });
  let c = await connect(srv.port);
  await sleep(300);
  for (const n of ['n1', 'n2', 'n3', 'n4']) { c.send({ t: 'create', kind: 'claude', cwd: HOME, name: n }); await sleep(120); }
  await poll(() => c.sessions.size === 4, 20000);
  const idOf = (name) => [...c.sessions.values()].find((s) => s.name === name).id;
  const [a, b, cc, d] = ['n1', 'n2', 'n3', 'n4'].map(idOf);
  const names = (cl, ids) => ids.map((id) => (cl.sessions.get(id) || {}).name).join(',');
  const fresh = async () => { const x = await connect(srv.port); await poll(() => x.view && x.sessions.size >= 1, 10000); return x; };

  const one = await fresh();
  t.check('a new server has ONE tab holding every terminal (nothing lost) and the old fields mirror it', one.view.tabs.length === 1 && one.view.tabs[0].order.length === 4 && one.view.active === one.view.tabs[0].id && one.view.order.length === 4, JSON.stringify(one.view));
  one.close();

  c.send({ t: 'view', tabs: [{ id: 'tA', name: 'עבודה א', order: [a, b], expanded: null, focus: b }, { id: 'tB', name: 'עבודה ב', order: [d, cc], expanded: d, focus: cc }], active: 'tB' });
  await sleep(300);
  let x = await fresh();
  t.check('two tabs: ids, names, order, expanded and focus are kept; active tab kept', JSON.stringify(x.view.tabs.map((q) => [q.id, q.name, names(x, q.order), q.expanded && x.sessions.get(q.expanded).name, q.focus && x.sessions.get(q.focus).name])) === JSON.stringify([['tA', 'עבודה א', 'n1,n2', null, 'n2'], ['tB', 'עבודה ב', 'n4,n3', 'n4', 'n3']]) && x.view.active === 'tB', JSON.stringify(x.view));
  t.check('the old fields (order/expanded/focus) mirror the ACTIVE tab, for older clients', names(x, x.view.order) === 'n4,n3' && x.view.expanded === d && x.view.focus === cc);
  x.close();

  // קלט פגום: מזהים לא קיימים, כפילויות, טרמינל שמופיע בשתי לשוניות, שם ארוך עם תווי בקרה
  c.send({ t: 'view', tabs: [{ id: 'tA', name: '  שם\u0000   ארוך  ' + 'x'.repeat(100), order: [a, '999', a, b], expanded: '999', focus: cc }, { id: 'tA', order: [b, cc] }, 'junk', null], active: 'nope' });
  await sleep(300);
  x = await fresh();
  t.check('garbage is cleaned: unknown ids dropped, each terminal in ONE tab, duplicate tab id renamed, a terminal nobody lists joins the active tab', x.view.tabs.length === 2 && new Set(x.view.tabs.map((q) => q.id)).size === 2 && names(x, x.view.tabs[0].order) === 'n1,n2,n4' && names(x, x.view.tabs[1].order) === 'n3' && x.view.active === x.view.tabs[0].id, JSON.stringify(x.view));
  t.check('names are cleaned and cut to 60; expanded/focus of another tab are dropped', x.view.tabs[0].name.length <= 60 && !/[\u0000-\u001f]/.test(x.view.tabs[0].name) && x.view.tabs[0].expanded === null && x.view.tabs[0].focus === null, JSON.stringify(x.view.tabs[0]));
  x.close();

  // התבנית הישנה עורכת רק את הלשונית הפעילה
  c.send({ t: 'view', tabs: [{ id: 'tA', name: 'עבודה א', order: [a, b], expanded: null, focus: b }, { id: 'tB', name: 'עבודה ב', order: [d, cc], expanded: d, focus: cc }], active: 'tB' });
  await sleep(200);
  c.send({ t: 'view', order: [cc, d], expanded: null, focus: d });
  await sleep(300);
  x = await fresh();
  t.check('an old-style view message edits the active tab only (the other tab is untouched)', names(x, x.view.tabs[0].order) === 'n1,n2' && names(x, x.view.tabs[1].order) === 'n3,n4' && x.view.tabs[1].expanded === null && x.view.tabs[1].focus === d, JSON.stringify(x.view));
  x.close();

  c.send({ t: 'view', tabs: [{ id: 'tA', name: 'עבודה א', order: [a, b], expanded: null, focus: b }, { id: 'tB', name: 'עבודה ב', order: [d, cc], expanded: d, focus: cc }], active: 'tB' });
  await sleep(200);
  c.send({ t: 'close', id: cc });
  await poll(() => !c.sessions.has(cc), 10000);
  x = await fresh();
  t.check('closing a terminal removes it from its tab (and the focus mark with it)', names(x, x.view.tabs[1].order) === 'n4' && x.view.tabs[1].focus === null && x.view.tabs[1].expanded === d, JSON.stringify(x.view));
  x.close();

  // כיבוי ופתיחה מחדש: הקובץ שומר אינדקסים, והלשוניות חוזרות עם השמות, הסדר, ההגדלה והלשונית הפעילה
  c.close();
  for (let i = 0; i < 40 && !srv.child.exited; i++) await sleep(500);
  t.check('the server exited after the last window closed', srv.child.exited);
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  t.check('state.json keeps tabs as indices, the active tab, and the old fields of the active tab', Array.isArray(st.tabs) && st.tabs.length === 2 && st.active === 'tB' && JSON.stringify(st.tabs.map((q) => q.order)) === '[[0,1],[2]]' && st.tabs[1].expanded === 2 && st.expanded === 2, JSON.stringify(st.tabs) + ' ' + st.expanded);

  srv = await startServer({ stateFile, binDir, keepState: true });
  c = await connect(srv.port);
  await poll(() => c.sessions.size === 3 && c.view && c.view.tabs && c.view.tabs.length === 2 && c.view.tabs.every((q) => q.order.length), 30000);
  t.check('after a restart: both tabs are back with their names, terminals, expanded mark and the active tab', JSON.stringify(c.view.tabs.map((q) => [q.id, q.name, names(c, q.order)])) === JSON.stringify([['tA', 'עבודה א', 'n1,n2'], ['tB', 'עבודה ב', 'n4']]) && c.view.active === 'tB' && c.sessions.get(c.view.tabs[1].expanded).name === 'n4', JSON.stringify(c.view));
  c.close();
  for (let i = 0; i < 40 && !srv.child.exited; i++) await sleep(500);

  // קובץ שמור מלפני הלשוניות: הכול בלשונית אחת
  fs.writeFileSync(stateFile, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), sessions: [{ kind: 'claude', cwd: HOME, name: 'o1', claudeId: null }, { kind: 'claude', cwd: HOME, name: 'o2', claudeId: null }], expanded: 1, focus: 0, duos: [], projectNames: {} }));
  srv = await startServer({ stateFile, binDir, keepState: true });
  c = await connect(srv.port);
  await poll(() => c.sessions.size === 2 && c.view && c.view.tabs && c.view.tabs[0].order.length === 2, 30000);
  t.check('an OLD state file (no tabs) becomes one tab with its order, expanded and focus', c.view.tabs.length === 1 && names(c, c.view.tabs[0].order) === 'o1,o2' && c.sessions.get(c.view.tabs[0].expanded).name === 'o2' && c.sessions.get(c.view.tabs[0].focus).name === 'o1', JSON.stringify(c.view));
  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });

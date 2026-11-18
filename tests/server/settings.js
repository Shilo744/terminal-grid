'use strict';
// Server-side settings store: schema/normalize/patch/migration in-process, then over HTTP + WebSocket with two clients.
const path = require('path');
const fs = require('fs');
const http = require('http');
const { APP, TMP, poll, checker, startServer, connect, getJson } = require('../lib/harness');
const S = require('../../server/settings');

const flat = (o, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, p, out); else out[p] = v;
  }
  return out;
};
const fresh = (name) => {
  const f = path.join(TMP, `settings-unit-${name}.json`);
  for (const x of [f, f + '.tmp', f + '.bak']) { try { fs.unlinkSync(x); } catch { /* none */ } }
  return f;
};
const rawGet = (port, urlPath, host) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: urlPath, headers: { Host: host } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); }).on('error', reject);
});

(async () => {
  const t = checker('settings store');

  /* ---------- in-process: schema, normalize, patch ---------- */
  const d = S.defaults();
  t.check('defaults: versioned, not migrated, every schema key present', d.v === 1 && d.migrated === false && S.SCHEMA.every((e) => flat(d)[e.path] !== undefined));
  t.check('defaults match the documented initial keys', d.terminal.lineHeight === 1 && d.terminal.cursorStyle === 'block' && d.terminal.cursorBlink === true && d.terminal.scrollback === 5000 && d.terminal.fontSize === 14 && d.terminal.fontFamily === 'TG Cascadia' && d.appearance.rtlLayer === true && d.ui.sideOpen === false && d.ui.cwd === '' && Array.isArray(d.ui.recents));

  const n = S.normalize({ evil: 1, terminal: { fontSize: 999, fontFamily: 'x'.repeat(500), bogus: true }, appearance: { rtlLayer: 'yes' }, ui: { recents: ['a', 'a', 5, '', ...'bcdefghijk'.split('')], cwd: 7 } });
  t.check('normalize drops unknown keys', n.evil === undefined && n.terminal.bogus === undefined);
  t.check('normalize clamps numbers', n.terminal.fontSize === 24 && S.normalize({ terminal: { fontSize: 1 } }).terminal.fontSize === 9 && S.normalize({ terminal: { fontSize: 13.6 } }).terminal.fontSize === 14);
  t.check('normalize limits string length and falls back on wrong types', n.terminal.fontFamily.length === 80 && n.appearance.rtlLayer === true && n.ui.cwd === '');
  t.check('recents: strings only, deduplicated, max 8', n.ui.recents.length === 8 && n.ui.recents[0] === 'a' && n.ui.recents.every((s) => typeof s === 'string' && s));
  const nt = S.normalize({ terminal: { lineHeight: 1.23, cursorStyle: 'wavy', cursorBlink: 'no', scrollback: 5003 } }).terminal;
  t.check('number step: line height snaps to 0.05 without float noise', nt.lineHeight === 1.25 && S.normalize({ terminal: { lineHeight: 9 } }).terminal.lineHeight === 1.6 && S.normalize({ terminal: { lineHeight: 0 } }).terminal.lineHeight === 1);
  t.check('enum: an unknown cursor style falls back to the default; a boolean must be a boolean', nt.cursorStyle === 'block' && nt.cursorBlink === true && S.normalize({ terminal: { cursorStyle: 'bar' } }).terminal.cursorStyle === 'bar');
  t.check('int with step: scrollback snaps to 500 and is clamped to 1000..50000', nt.scrollback === 5000 && S.normalize({ terminal: { scrollback: 1 } }).terminal.scrollback === 1000 && S.normalize({ terminal: { scrollback: 1e9 } }).terminal.scrollback === 50000);
  // T49: שלושה סגנונות (ide, classic, paper); הערכים הישנים vscode ו-intellij (שני מראות כמעט זהים) הופכים ל-ide, בקריאה, בשמירה ובעדכון חלקי
  const styleOf = (v) => S.normalize({ appearance: { style: v } }).appearance.style;
  t.check('appearance.style: default is ide; ide, classic and paper are kept', S.defaults().appearance.style === 'ide' && styleOf('ide') === 'ide' && styleOf('classic') === 'classic' && styleOf('paper') === 'paper', JSON.stringify([S.defaults().appearance.style, styleOf('classic'), styleOf('paper')]));
  t.check('migration: a stored vscode or intellij becomes ide (and garbage falls back to the default)', styleOf('vscode') === 'ide' && styleOf('intellij') === 'ide' && styleOf('zzz') === 'ide' && styleOf(7) === 'ide', JSON.stringify([styleOf('vscode'), styleOf('intellij'), styleOf('zzz')]));
  t.check('migration also works for a partial update from an old client (merge)', S.merge(S.defaults(), { appearance: { style: 'paper' } }).appearance.style === 'paper' && S.merge({ appearance: { style: 'paper' } }, { appearance: { style: 'vscode' } }).appearance.style === 'ide');
  const oldFile = fresh('old-style');
  fs.writeFileSync(oldFile, JSON.stringify({ v: 1, migrated: true, appearance: { style: 'intellij', accent: 'violet' } }));
  const oldStore = S.createSettings({ file: oldFile }); oldStore.load();
  t.check('a settings.json written by the previous version (style intellij) loads as ide and keeps the accent', oldStore.get().appearance.style === 'ide' && oldStore.get().appearance.accent === 'violet', JSON.stringify(oldStore.get().appearance));

  t.check('normalize of garbage input gives defaults', JSON.stringify(S.normalize(null)) === JSON.stringify(d) && JSON.stringify(S.normalize('x')) === JSON.stringify(d));

  const file = fresh('main');
  const logs = [];
  const st = S.createSettings({ file, log: (...a) => logs.push(a.join(' ')) });
  st.load();
  t.check('no file yet: load gives defaults', st.get().terminal.fontSize === 14);
  const seen = [];
  st.onChange((s) => seen.push(s));
  const p1 = st.patch({ terminal: { fontSize: 18 }, nope: 1, appearance: { rtlLayer: 'bad' } });
  t.check('patch returns the full normalized settings', p1.terminal.fontSize === 18 && p1.appearance.rtlLayer === true && p1.nope === undefined && p1.ui.cwd === '');
  t.check('onChange receives the new settings', seen.length === 1 && seen[0].terminal.fontSize === 18);
  t.check('save is atomic: file written, no .tmp left', JSON.parse(fs.readFileSync(file, 'utf8')).terminal.fontSize === 18 && !fs.existsSync(file + '.tmp'));
  const again = S.createSettings({ file }); again.load();
  t.check('a new instance reads the saved file', again.get().terminal.fontSize === 18);
  st.patch({ terminal: { fontSize: 'big' } });
  t.check('an invalid value keeps the previous one', st.get().terminal.fontSize === 18);
  t.check('a patch of one key leaves the others', st.patch({ ui: { cwd: 'C:\\x' } }).terminal.fontSize === 18);

  const mig = S.createSettings({ file: fresh('mig') }); mig.load();
  const m1 = mig.patch({ ui: { cwd: 'C:\\old' } }, { migrate: true });
  const m2 = mig.patch({ ui: { cwd: 'C:\\other' } }, { migrate: true });
  t.check('migration applies once and sets migrated', m1.migrated === true && m1.ui.cwd === 'C:\\old' && m2.ui.cwd === 'C:\\old');

  const bad = fresh('corrupt');
  fs.writeFileSync(bad, '{ this is not json');
  const cs = S.createSettings({ file: bad, log: (...a) => logs.push(a.join(' ')) });
  const loaded = cs.load();
  t.check('corrupt file: defaults, copy kept as .bak, logged', loaded.terminal.fontSize === 14 && fs.readFileSync(bad + '.bak', 'utf8') === '{ this is not json' && logs.some((l) => l.includes('corrupt')));

  // constants.js הוא מודול ES בלי imports; טוענים אותו כ-data URL (package.json הוא CommonJS ולכן import ישיר מדפיס אזהרה)
  const client = await import('data:text/javascript;base64,' + fs.readFileSync(path.join(APP, 'public', 'js', 'constants.js')).toString('base64'));
  t.check('client fallback defaults equal the server defaults', JSON.stringify(client.SETTINGS_FALLBACK) === JSON.stringify(Object.fromEntries(S.SCHEMA.map((e) => [e.path, e.def]))));

  /* ---------- over the wire ---------- */
  const srv = await startServer({});
  const c1 = await connect(srv.port), c2 = await connect(srv.port);
  await poll(() => c1.settings && c2.settings, 8000);
  t.check('the list message carries the settings', c1.settings && c1.settings.terminal.fontSize === 14 && c1.settings.migrated === false);

  const http1 = await getJson(`http://127.0.0.1:${srv.port}/api/settings`);
  t.check('GET /api/settings returns settings and the schema', http1.settings.terminal.fontSize === 14 && Array.isArray(http1.schema) && http1.schema.some((e) => e.path === 'terminal.fontSize' && e.min === 9 && e.max === 24));
  t.check('GET /api/settings checks the Host header', (await rawGet(srv.port, '/api/settings', 'evil.example')) === 403);

  const m = (c) => c.messages.filter((x) => x.t === 'settings');
  c1.send({ t: 'settings:set', patch: { terminal: { fontSize: 17 } }, rid: 'r1' });
  await poll(() => m(c1).length === 1 && m(c2).length === 1, 8000);
  t.check('both clients get the broadcast, with the request id', m(c1).length === 1 && m(c2).length === 1 && m(c1)[0].rid === 'r1' && m(c2)[0].settings.terminal.fontSize === 17);
  t.check('the settings file was written', JSON.parse(fs.readFileSync(srv.settingsFile, 'utf8')).terminal.fontSize === 17);

  c2.send({ t: 'settings:set', patch: { terminal: { fontSize: 999 }, junk: 1 }, rid: 'r2' });
  await poll(() => m(c1).some((x) => x.rid === 'r2'), 8000);
  t.check('out-of-range values are clamped and unknown keys never stored', c1.settings.terminal.fontSize === 24 && c1.settings.junk === undefined && JSON.parse(fs.readFileSync(srv.settingsFile, 'utf8')).junk === undefined);
  const before = m(c1).length;
  c2.send({ t: 'settings:set', patch: { bogus: 1 }, rid: 'r3' });
  await poll(() => m(c1).some((x) => x.rid === 'r3'), 8000);
  t.check('a patch that changes nothing is still acknowledged (so a client can clear its request)', m(c1).length === before + 1 && m(c1).at(-1).rid === 'r3');

  c1.send({ t: 'settings:set', patch: { ui: { cwd: 'C:\\from-localstorage' } }, migrate: true, rid: 'm1' });
  await poll(() => m(c2).some((x) => x.rid === 'm1'), 8000);
  c2.send({ t: 'settings:set', patch: { ui: { cwd: 'C:\\second-window' } }, migrate: true, rid: 'm2' });
  await poll(() => m(c1).some((x) => x.rid === 'm2'), 8000);
  t.check('migration happens once: the second window cannot overwrite it', c2.settings.migrated === true && c2.settings.ui.cwd === 'C:\\from-localstorage');

  const c3 = await connect(srv.port);
  await poll(() => c3.settings, 8000);
  t.check('a window that connects later gets the current settings immediately', c3.settings.terminal.fontSize === 24 && c3.settings.ui.cwd === 'C:\\from-localstorage');

  c1.close(); c2.close(); c3.close();
  srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });

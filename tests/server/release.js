'use strict';
// @slow
/*
 * סקריפט השחרור (T44, scripts/release.js) בתיקיית גרסאות זמנית (TG_VERSIONS_DIR): אף פעם לא ב-"Terminal Grid Versions" האמיתית.
 *  - מסרב: בלי מספר גרסה תקין, כשעץ git לא נקי, וכשתיקיית הגרסה כבר קיימת (התוכן שלה לא משתנה);
 *  - שחרור אמיתי של ה-commit הנוכחי (--allow-dirty ו---skip-tests קיימים רק לבדיקה הזאת): כל הקבצים שב-git, בלי .duo/.dev/קבצי מצב/יומנים/tests/.tmp,
 *    node_modules הוא העתק אמיתי (לא קישור), הגרסה ב-package.json, מפעיל וסקריפט מעבר, RELEASE.txt עם ה-commit;
 *  - השרת רץ מתוך העותק (גרסה נכונה ב-/api/info), וקיצור ההפעלה עם Windows שהוא כותב מצביע על ה-start.ps1 של העותק עצמו ולא על תיקיית הפיתוח.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { TMP, checker, startServer, getJson, post, sleep } = require('../lib/harness');

const REPO = path.resolve(__dirname, '..', '..');
const versions = path.join(TMP, 'versions-test-' + process.pid);
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@local', ...a], { cwd, encoding: 'utf8' });
const release = (args, env = {}) => spawnSync(process.execPath, [path.join(REPO, 'scripts', 'release.js'), ...args], { cwd: REPO, encoding: 'utf8', env: { ...process.env, TG_VERSIONS_DIR: versions, ...env } });
const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* נעול: נשאר ב-tests/.tmp, ננקה בריצה הבאה */ } };

(async () => {
  const t = checker('release script (temp versions folder)');
  rm(versions);

  /* ---------- סירובים ---------- */
  let r = release([]);
  t.check('no version: refused', r.status !== 0 && /give a version number/.test(r.stderr), r.stderr.slice(0, 200));
  r = release(['four']);
  t.check('a version that is not a number: refused', r.status !== 0 && /give a version number/.test(r.stderr));

  const tiny = path.join(TMP, 'release-tiny-' + process.pid);
  rm(tiny); fs.mkdirSync(tiny, { recursive: true });
  fs.writeFileSync(path.join(tiny, 'a.txt'), 'a');
  git(tiny, 'init', '-q'); git(tiny, 'add', '.'); git(tiny, 'commit', '-q', '-m', 'one');
  fs.writeFileSync(path.join(tiny, 'untracked.txt'), 'x');
  r = release(['1.0'], { TG_RELEASE_REPO: tiny });
  t.check('a dirty git tree (an untracked file): refused, and nothing was created', r.status !== 0 && /not clean/.test(r.stderr) && !fs.existsSync(path.join(versions, 'V1.0')), r.stderr.slice(0, 200));
  rm(tiny);

  fs.mkdirSync(path.join(versions, 'V8.8'), { recursive: true });
  fs.writeFileSync(path.join(versions, 'V8.8', 'marker.txt'), 'keep me');
  r = release(['8.8', '--allow-dirty', '--skip-tests']);
  t.check('an existing version folder is never overwritten', r.status !== 0 && /already exists/.test(r.stderr) && fs.readFileSync(path.join(versions, 'V8.8', 'marker.txt'), 'utf8') === 'keep me' && fs.readdirSync(path.join(versions, 'V8.8')).length === 1, r.stderr.slice(0, 200));

  /* ---------- שחרור אמיתי ---------- */
  fs.writeFileSync(path.join(versions, 'current.txt'), 'V0.1\r\n');
  const t0 = Date.now();
  r = release(['9.9', '--allow-dirty', '--skip-tests']);
  t.check('a release of the current commit succeeds', r.status === 0 && /DONE/.test(r.stdout), (r.stdout + r.stderr).slice(-400));
  const dir = path.join(versions, 'V9.9');
  const has = (...p) => fs.existsSync(path.join(dir, ...p));
  const tracked = git(REPO, 'ls-files').stdout.split(/\r?\n/).filter(Boolean);
  const missing = tracked.filter((f) => f !== 'Terminal Grid V4.cmd' && !has(f));
  t.check('every file tracked by git is in the release', missing.length === 0 && tracked.length > 50, `missing: ${missing.slice(0, 5)} of ${tracked.length}`);
  t.check('the development launcher (port 7795) is not in the release', !has('Terminal Grid V4.cmd'));
  const leaks = ['.duo', '.dev', 'tests/.tmp', 'state.json', 'settings.json', 'server.log', 'launch.log', '.claude'].filter((f) => has(...f.split('/')));
  t.check('nothing from the working folder leaks in (.duo, .dev, state, logs, tests/.tmp)', leaks.length === 0, leaks.join(','));
  const nm = path.join(dir, 'node_modules');
  const lst = fs.lstatSync(nm);
  const wsFile = path.join('node_modules', 'ws', 'package.json');
  t.check('node_modules is a REAL copy (not a link) with the same files', lst.isDirectory() && !lst.isSymbolicLink() && has(wsFile) && fs.statSync(path.join(dir, wsFile)).size === fs.statSync(path.join(REPO, wsFile)).size && has('node_modules', 'node-pty'));
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  t.check('package.json of the copy says 9.9.0 (the About dialog reads it); the development one is untouched', pkg.version === '9.9.0' && JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version !== '9.9.0', pkg.version);
  const launcher = fs.readFileSync(path.join(dir, 'Terminal Grid V9.9.cmd'), 'utf8');
  t.check('the launcher runs its OWN start.ps1 (%~dp0), no port argument (default 7791)', /%~dp0start\.ps1/.test(launcher) && !/-Port/.test(launcher) && /\r\n/.test(launcher), launcher);
  const info = fs.readFileSync(path.join(dir, 'RELEASE.txt'), 'utf8');
  const head = git(REPO, 'log', '-1', '--format=%h').stdout.trim();
  t.check('RELEASE.txt has the commit hash, a date and the test status', info.includes('commit: ' + head) && /date: \d{4}-\d\d-\d\d \d\d:\d\d/.test(info) && /quick suite/.test(info), info);
  const sw = fs.readFileSync(path.join(versions, 'Switch live to V9.9.cmd'), 'utf8');
  t.check('"Switch live to V9.9.cmd" and the switch script are next to the releases', /-Release V9\.9/.test(sw) && fs.existsSync(path.join(versions, 'switch-live-to-release.ps1')));
  t.check('T80: the stable launcher is copied next to the releases when missing, and a release does NOT change current.txt (a release is not a switch)', fs.existsSync(path.join(versions, 'launch-current.ps1')) && fs.readFileSync(path.join(versions, 'launch-current.ps1'), 'utf8') === fs.readFileSync(path.join(REPO, 'scripts', 'launch-current.ps1'), 'utf8') && fs.readFileSync(path.join(versions, 'current.txt'), 'utf8').trim() === 'V0.1');
  fs.writeFileSync(path.join(versions, 'launch-current.ps1'), '# my own launcher\n');
  r = release(['9.8', '--allow-dirty', '--skip-tests']);
  t.check('T80: an existing launcher is never overwritten by a later release (and current.txt still untouched)', r.status === 0 && fs.readFileSync(path.join(versions, 'launch-current.ps1'), 'utf8') === '# my own launcher\n' && fs.readFileSync(path.join(versions, 'current.txt'), 'utf8').trim() === 'V0.1', (r.stdout + r.stderr).slice(-200));
  r = release(['9.9', '--allow-dirty', '--skip-tests']);
  t.check('releasing the same version again is refused', r.status !== 0 && /already exists/.test(r.stderr));
  console.log(`(release took ${Math.round((Date.now() - t0) / 1000)}s)`);

  /* ---------- השרת רץ מהעותק, וההפעלה עם Windows כותבת את הנתיב של העותק ---------- */
  const startup = path.join(TMP, 'release-startup-' + process.pid);
  rm(startup); fs.mkdirSync(startup, { recursive: true });
  const srv = await startServer({ cwd: dir, env: { TG_TEST_STARTUP_DIR: startup, TG_TEST_AUTOSTART_STUB: '1' } });
  let info2 = null;
  for (let i = 0; i < 60 && !info2; i++) { try { info2 = await getJson(`http://127.0.0.1:${srv.port}/api/info`); } catch { await sleep(250); } }
  t.check('the server runs from the release copy and reports its version', !!info2 && info2.version === '9.9.0', JSON.stringify(info2));
  const on = await post(srv.port, '/api/autostart', { enabled: true });
  const lnk = path.join(startup, `Terminal Grid (${srv.port}).lnk`);
  let d = null; try { d = JSON.parse(fs.readFileSync(lnk, 'utf8')); } catch { /* לא נכתב */ }
  const ownStart = path.join(dir, 'start.ps1');
  t.check('autostart from a release copy writes the copy start.ps1 and working folder, not the development folder', !!d && d.arguments.includes(`"${ownStart}"`) && d.workingDirectory === dir && !d.arguments.includes(path.join(REPO, 'start.ps1')) && d.icon === path.join(dir, 'terminal-grid.ico'), JSON.stringify({ on, d }));
  srv.stop();
  await sleep(500);

  rm(startup); rm(versions);
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); rm(versions); process.exit(2); });

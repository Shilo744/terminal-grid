'use strict';
/*
 * שחרור ממוספר (T44): `npm run release -- 4.2` מקפיא את ה-commit הירוק הנוכחי לתיקייה משלו, "Terminal Grid Versions\V4.2", שאפשר להריץ כאפליקציה החיה
 * בלי שעבודת הפיתוח בתיקייה הזאת תיגע בה. השחרור הוא עותק עצמאי: קבצי git (לא .duo, לא tests/.tmp, לא קבצי מצב או יומנים), העתק אמיתי של node_modules
 * (לא junction: npm install בפיתוח לא יכול לשבור שחרור), הגרסה ב-package.json (מופיעה בתיבת "אודות"), מפעיל "Terminal Grid V<גרסה>.cmd" שמריץ את ה-start.ps1 שלו
 * על פורט 7791 עם state.json ו-settings.json שלו לידו, RELEASE.txt (commit, תאריך, תוצאת הבדיקות המהירות שרצו בתוך העותק), וסקריפט מעבר שמעתיק את המצב.
 *
 *   node scripts/release.js <גרסה> [--allow-dirty] [--skip-tests]
 *
 * מסרב כשעץ git לא נקי, כשהגרסה לא תקינה, כשהתיקייה כבר קיימת (אף פעם לא דורס), וכשהבדיקות המהירות נכשלות בתוך העותק (אז העותק נמחק).
 * --allow-dirty ו---skip-tests קיימים רק לבדיקה של הסקריפט עצמו (tests/e2e/release.js); לא משתמשים בהם בשחרור אמיתי.
 * משתני סביבה: TG_VERSIONS_DIR (ברירת מחדל: ..\Terminal Grid Versions), TG_RELEASE_REPO (ברירת מחדל: התיקייה הזאת), לבדיקות.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const REPO = path.resolve(process.env.TG_RELEASE_REPO || path.join(__dirname, '..'));
const VERSIONS = path.resolve(process.env.TG_VERSIONS_DIR || path.join(REPO, '..', 'Terminal Grid Versions'));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const version = args.find((a) => !a.startsWith('--'));

const fail = (msg, code = 1) => { console.error('\nRELEASE REFUSED: ' + msg); process.exit(code); };
const run = (cmd, a, opts = {}) => spawnSync(cmd, a, { encoding: 'utf8', windowsHide: true, ...opts });
const bom = String.fromCharCode(0xFEFF);

if (!version || !/^\d+\.\d+(\.\d+)?$/.test(version)) fail('give a version number like 4.2 (node scripts/release.js 4.2)');
const target = path.join(VERSIONS, 'V' + version);
if (fs.existsSync(target)) fail(`${target} already exists (a release folder is never overwritten)`);

// ---------- 1. עץ נקי ----------
const status = run('git', ['status', '--porcelain'], { cwd: REPO });
if (status.status !== 0) fail('this is not a git repository: ' + (status.stderr || '').trim());
if (status.stdout.trim() && !flag('--allow-dirty')) fail('the git tree is not clean (commit or stash first):\n' + status.stdout.split('\n').slice(0, 10).join('\n'));
const commit = run('git', ['log', '-1', '--format=%h %s'], { cwd: REPO }).stdout.trim();
if (!commit) fail('there is no commit to release');
console.log(`Releasing V${version} from commit: ${commit}`);

// ---------- 2. ייצוא של HEAD (git archive) ----------
fs.mkdirSync(VERSIONS, { recursive: true });
fs.mkdirSync(target, { recursive: true });
const tar = path.join(os.tmpdir(), `tg-release-${process.pid}.tar`);
const arch = run('git', ['archive', '--format=tar', '--output', tar, 'HEAD'], { cwd: REPO });
if (arch.status !== 0) { cleanup(); fail('git archive failed: ' + arch.stderr); }
// tar של Windows (bsdtar) במפורש: ב-Git Bash ה-tar הראשון ב-PATH הוא GNU tar, שמפרש "C:\..." כשם מחשב מרוחק
const TAR = [path.join(process.env.SystemRoot || 'C:' + String.fromCharCode(92) + 'Windows', 'System32', 'tar.exe')].find((p) => fs.existsSync(p)) || 'tar';
const untar = run(TAR, ['-xf', tar, '-C', target]);
try { fs.unlinkSync(tar); } catch { /* נשאר ב-temp */ }
if (untar.status !== 0) { cleanup(); fail('could not extract the archive: ' + untar.stderr); }
// "Terminal Grid V4.cmd" הוא מפעיל מופע הפיתוח (פורט 7795): בשחרור יש מפעיל משלו
try { fs.unlinkSync(path.join(target, 'Terminal Grid V4.cmd')); } catch { /* אין */ }

// ---------- 3. גרסה, מפעיל, node_modules ----------
const pkgFile = path.join(target, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.version = version.split('.').length === 2 ? version + '.0' : version;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');

fs.writeFileSync(path.join(target, `Terminal Grid V${version}.cmd`),
  `@echo off\r\nrem Terminal Grid V${version} (stable): the live app on port 7791, state and settings in this folder.\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*\r\n`);

function cleanup() { try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* נעול: נשאר */ } }

async function main() {
  // העתק אמיתי של node_modules ב-robocopy בעדיפות מתחת לרגילה (לא junction)
  const src = path.join(REPO, 'node_modules');
  if (!fs.existsSync(src)) { cleanup(); fail('node_modules is missing in the dev folder: run npm install first'); }
  console.log('Copying node_modules (a real copy, below-normal priority)...');
  await new Promise((resolve) => {
    const rc = spawn('robocopy', [src, path.join(target, 'node_modules'), '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'], { stdio: 'ignore', windowsHide: true });
    try { os.setPriority(rc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* לא נתמך */ }
    rc.on('exit', (code) => { if (code >= 8) { cleanup(); fail('robocopy failed with exit code ' + code); } resolve(); });
  });

  // ---------- 4. הבדיקות המהירות בתוך העותק ----------
  let summary = 'quick suite skipped (--skip-tests, release-script test only)';
  if (!flag('--skip-tests')) {
    console.log('Running the quick tests inside the release copy...');
    const t = run(process.execPath, [path.join(target, 'tests', 'run.js'), '--quick'], { cwd: target, maxBuffer: 64 * 1024 * 1024 });
    const out = (t.stdout || '') + (t.stderr || '');
    const line = out.split(/\r?\n/).filter((l) => /test files passed|flakes/.test(l)).join(' | ');
    console.log(out.split(/\r?\n/).filter((l) => /^=====/.test(l)).join('\n'));
    if (t.status !== 0) { cleanup(); fail('the quick tests failed inside the release copy, so nothing was released:\n' + out.slice(-1500)); }
    summary = 'quick suite (no browser) run inside this folder: ' + (line || 'passed');
  }
  // התיקייה הזמנית שהבדיקות יצרו בתוך העותק לא שייכת לשחרור
  try { fs.rmSync(path.join(target, 'tests', '.tmp'), { recursive: true, force: true }); } catch { /* נעול: נשאר */ }

  // ---------- 5. RELEASE.txt וסקריפט המעבר ----------
  const when = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  fs.writeFileSync(path.join(target, 'RELEASE.txt'), bom + [
    `Terminal Grid V${version} - stable release`,
    `commit: ${commit}`,
    `date: ${when.getFullYear()}-${p2(when.getMonth() + 1)}-${p2(when.getDate())} ${p2(when.getHours())}:${p2(when.getMinutes())}`,
    summary,
    'exported by scripts/release.js (git archive of the clean HEAD, its own copy of node_modules); run it with the launcher in this folder.',
    '',
  ].join('\r\n'));

  // סקריפט המעבר הוא כלי מגרסת הפיתוח (scripts/): תמיד מרעננים אותו, כדי שכל השחרורים ישתמשו באחרון
  fs.copyFileSync(path.join(REPO, 'scripts', 'switch-live-to-release.ps1'), path.join(VERSIONS, 'switch-live-to-release.ps1'));
  // המפעיל היציב (T80): נוצר רק אם חסר, אף פעם לא נדרס; current.txt לא נוגע בו השחרור (שחרור הוא לא מעבר, רק סקריפט המעבר מעדכן אותו)
  const launcher = path.join(VERSIONS, 'launch-current.ps1');
  if (!fs.existsSync(launcher)) fs.copyFileSync(path.join(REPO, 'scripts', 'launch-current.ps1'), launcher);
  fs.writeFileSync(path.join(VERSIONS, `Switch live to V${version}.cmd`),
    `@echo off\r\nrem Switch the live Terminal Grid to the frozen release V${version} (read switch-live-to-release.ps1 for the 3 steps).\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0switch-live-to-release.ps1" -Release V${version}\r\npause\r\n`);

  console.log(`\nDONE: ${target}`);
  console.log(`  launcher: Terminal Grid V${version}.cmd inside it (port 7791, its own state.json and settings.json)`);
  console.log(`  switch the live app: pause the pairs, close the window, then double-click "Switch live to V${version}.cmd" in ${VERSIONS}`);
  console.log('  details and rollback: docs/releasing.md');
}
main().catch((e) => { cleanup(); fail(e.message); });

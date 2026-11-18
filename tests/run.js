'use strict';
/*
 * `npm test` מריץ כל קובץ בדיקה בתהליך משלו ומדפיס סיכום. `npm test -- ui` מריץ רק קבצים שהנתיב שלהם מכיל "ui" (גם e2e/ui).
 * `npm run test:quick` (דגל --quick) מריץ רק בדיקות שרת/יחידה בלי Chrome ובלי הבדיקות שמסומנות "// @slow" בראש הקובץ: לשימוש בזמן עבודה.
 *
 * שכן מנומס: התהליך (ובעקבותיו כל הילדים: שרתי הבדיקה, Chrome) רץ בעדיפות "מתחת לרגילה", כדי שהמחשב של המשתמש יישאר רגיש.
 * בסוף מודפסים זמן ריצה ועומס ה-CPU הממוצע של המחשב בזמן הריצה (מול עומס הרקע שנמדד לפני שהתחילה).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

if (!process.env.TG_TEST_NORMAL_PRIORITY) { try { os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* לא נתמך */ } }

const tracker = require('./lib/tracker');
// מזהה לריצה (T58): כל בדיקה רושמת את השרתים והדפדפנים שהיא פותחת בקובץ בתיקייה הזאת, ומי שנהרג בלי לנקות (פסק זמן) מנוקה אחריו לפי הקובץ, לפי pid מדויק
const RUN_ID = String(Date.now()) + '-' + process.pid;
const RUN_DIR = path.join(path.join(__dirname, '.tmp'), 'run-' + RUN_ID);
fs.mkdirSync(RUN_DIR, { recursive: true });
const leftovers = [];
const SEP = String.fromCharCode(92);
const root = __dirname;
const SKIP = new Set(['lib', 'fixtures', 'tools', '.tmp']);
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const filter = args.find((a) => !a.startsWith('--'));
const norm = (p) => p.split(SEP).join('/');

const isSlow = (f) => /@slow/.test(fs.readFileSync(path.join(root, f), 'utf8').split('\n').slice(0, 6).join('\n'));
const files = [];
for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory() || SKIP.has(dir.name)) continue;
  if (quick && !['server', 'unit'].includes(dir.name)) continue;
  for (const f of fs.readdirSync(path.join(root, dir.name))) if (f.endsWith('.js')) files.push(path.join(dir.name, f));
}
// בדיקות שנגמרות ב-"-real" עולות כסף (סוכנים אמיתיים) ולכן לא רצות ב-npm test; מריצים אותן ידנית: node tests/e2e/duo-real.js
const picked = files
  .filter((f) => !f.endsWith('-real.js') && (!filter || norm(f).includes(norm(filter))) && !(quick && isSlow(f)))
  .sort();

// פרופילים ישנים של Chrome מהרצות קודמות (נשארים כשבדיקה נהרגה באמצע): מנקים לפני שמתחילים, לא משאירים זבל בדיסק
const TMP = path.join(root, '.tmp');
// הבית הזמני של הבדיקות (T43) מתחיל נקי בכל ריצה: אחרת קבצי .duo וחיפושי היסטוריה מהריצה הקודמת מזהמים את הבאה
try { fs.rmSync(path.join(TMP, 'home'), { recursive: true, force: true }); } catch { /* נעול: ממשיכים */ }
// וגם קבצי מצב והגדרות של שרתי בדיקה לפי פורט (settings-<port>.json, state-<port>.json) ותיקיות של זוגות סוכנים: בלי זה מצטברות מאות
try { for (const d of fs.readdirSync(TMP)) if ((/^run-/.test(d) && d !== 'run-' + RUN_ID) || (/^chrome-profile-/.test(d) && d !== 'chrome-profile-shot') || /^(settings|state)-\d+\.json(\.tmp|\.bak)?$/.test(d) || /^duo-(a|b|ui)-\d+$/.test(d)) fs.rmSync(path.join(TMP, d), { recursive: true, force: true }); } catch { /* אין תיקייה או קובץ נעול */ }

// עומס CPU של כל המחשב בין שתי דגימות (אחוז)
const cpuTimes = () => os.cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 });
const load = (a, b) => (b.total === a.total ? 0 : Math.round((1 - (b.idle - a.idle) / (b.total - a.total)) * 100));
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const b0 = cpuTimes(); sleepSync(2000); const background = load(b0, cpuTimes());
const t0 = Date.now(), c0 = cpuTimes();

const failed = [];
const flakes = [];
// שומר הבית (T43): הבדיקות רצות עם בית זמני (tests/lib/harness.js). אם בסוף הריצה התיקייה .duo בבית האמיתי של המשתמש (או קובץ בתוכה) חדשה מתחילת הריצה, בדיקה כתבה שם: כישלון.
// (אם בדיוק בזמן הריצה יצרתם בעצמכם זוג סוכנים בתיקיית הבית, ההתראה תהיה שגויה: מריצים שוב.)
const REAL_HOME = process.env.USERPROFILE;
const runStart = Date.now();
function homeGuard() {
  const hits = [];
  if (!REAL_HOME) return hits;
  const dir = path.join(REAL_HOME, '.duo');
  try {
    if (fs.statSync(dir).mtimeMs > runStart) hits.push(dir);
    for (const f of fs.readdirSync(dir)) if (fs.statSync(path.join(dir, f)).mtimeMs > runStart) hits.push(path.join(dir, f));
  } catch { /* אין תיקייה: תקין */ }
  return hits;
}
// שומר חלונות מערכת (T50): חלון "בחירת אפליקציה" של Windows (OpenWith.exe) שנפתח בזמן הריצה פירושו שבדיקה (או הדפדפן שלה) הפעילה תוכנה חיצונית על שולחן העבודה של המשתמש.
// סופרים את התהליכים לפני, כל כמה שניות במהלך הריצה (כדי לדעת אילו קבצים רצו באותו זמן) ובסוף; גידול = כישלון בקול רם. tasklist מותר (זה לא powershell/cmd).
// (אם בדיוק בזמן הריצה פתחתם בעצמכם חלון כזה, ההתראה תהיה שגויה: מריצים שוב. החלון הקיים לפני הריצה לא נספר.)
function openWithCount() {
  try { return execFileSync('tasklist', ['/FI', 'IMAGENAME eq OpenWith.exe', '/NH'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter((l) => /^OpenWith\.exe/i.test(l.trim())).length; } catch { return 0; }
}
const openWith0 = openWithCount();
const openers0 = new Set(tracker.openerPids()); // מה שכבר רץ בהתחלה: לא נוגעים בו (חלון של המשתמש)
const running = new Set();
let dialogPopped = null;
let dialogOptedIn = 0;
// T58: חלון מערכת חדש (pid שלא היה בהתחלה) נסגר מיד, לפי ה-pid המדויק שלו; הריצה נכשלת רק אם אף בדיקה שרצה אז לא הצהירה עליו (allowExternal)
function checkOpenWith() {
  const fresh = tracker.openerPids().filter((pid) => !openers0.has(pid));
  if (!fresh.length) return;
  const declared = tracker.optIns(RUN_DIR).filter((o) => { try { process.kill(o.owner, 0); return true; } catch { return false; } });
  for (const pid of fresh) { tracker.killTree(pid); openers0.add(pid); }
  if (declared.length) {
    dialogOptedIn += fresh.length;
    console.log(`\n[tracker] closed ${fresh.length} OS window(s) (pid ${fresh.join(', ')}) that a test opened on purpose: ${declared.map((o) => o.reason).join('; ')}`);
    return;
  }
  if (!dialogPopped) {
    dialogPopped = { from: openWith0, to: openWith0 + fresh.length, during: [...running] };
    console.log(`\n!!!!! TEST POPPED AN OS DIALOG (closed by exact pid ${fresh.join(', ')}): OpenWith.exe processes ${openWith0} -> ${openWith0 + fresh.length}. Running at that moment: ${dialogPopped.during.join(', ') || '(none)'}`);
  }
}
const openWithTimer = setInterval(checkOpenWith, 3000);
openWithTimer.unref();
// הרצה במקביל (ברירת מחדל 3 קבצים בבת אחת; --serial או TG_TEST_PARALLEL=1 = אחד אחד): הבדיקות עצמאיות (פורט חופשי, קובץ מצב והגדרות משלהן),
// והזמן הארוך הוא בעיקר המתנה, כך שהמקביליות מקצרת את הריצה בלי להעלות את העומס הממוצע. הפלט של כל קובץ מודפס כבלוק אחד כשהוא נגמר.
const PARALLEL = args.includes('--serial') ? 1 : Math.max(1, Number(process.env.TG_TEST_PARALLEL) || 3);
const runOnce = (f) => new Promise((resolve) => {
  let out = '';
  running.add(f);
  const child = spawn(process.execPath, [path.join(root, f)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TG_TEST_RUN_ID: RUN_ID } });
  const timer = setTimeout(() => { try { child.kill(); } catch { /* נסגר */ } }, 15 * 60 * 1000);
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('exit', (code) => {
    clearTimeout(timer); running.delete(f);
    // מה שהבדיקה פתחה ולא סגרה (נהרגה בפסק זמן, או נפלה בלי לנקות): נסגר עכשיו לפי pid ומודפס בקול
    for (const e of tracker.sweep(RUN_DIR, child.pid)) { leftovers.push(e); out += String.fromCharCode(10) + 'LEFTOVER: ' + f + ' left ' + e.image + ' pid ' + e.pid + ' (' + e.label + '), closed by exact pid'; }
    resolve({ ok: code === 0, out });
  });
});
async function runFile(f) {
  let r = await runOnce(f);
  let log = '##### ' + f + String.fromCharCode(10) + r.out;
  if (!r.ok) {
    // המחשב הזה מריץ גם סוכנים אחרים: בדיקות עם דפדפן ותזמונים נכשלות לפעמים מעומס. קובץ שנכשל רץ פעם נוספת, אבל בקול רם:
    log += String.fromCharCode(10) + '##### ' + f + ' (failed, running once more)' + String.fromCharCode(10);
    r = await runOnce(f);
    log += r.out;
    if (r.ok) { flakes.push(f); log += String.fromCharCode(10) + 'FLAKE: ' + f + ' passed on retry'; } else failed.push(f);
  }
  console.log(String.fromCharCode(10) + log);
}
async function main() {
  const queue = picked.slice();
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => { while (queue.length) await runFile(queue.shift()); }));
}

main().then(() => {
  const wall = Math.round((Date.now() - t0) / 1000);
  const avg = load(c0, cpuTimes());
  clearInterval(openWithTimer); checkOpenWith();
  for (const e of tracker.sweep(RUN_DIR)) { leftovers.push(e); console.log('LEFTOVER: ' + e.image + ' pid ' + e.pid + ' (' + e.label + ') was still alive at the end of the run, closed by exact pid'); }
  console.log(leftovers.length ? '\n===== LEFTOVERS: ' + leftovers.length + ' process(es) a test left running were closed (see the LEFTOVER lines above); fix the test that did not clean up' : '\n===== leftovers: none (every server and browser a test started is gone)');
  try { fs.rmSync(RUN_DIR, { recursive: true, force: true }); } catch { /* נעול: tests/run.js ינקה בריצה הבאה */ }
  if (dialogPopped) { failed.push('os-dialog'); console.log(`\n===== OS DIALOG GUARD FAILED: OpenWith.exe processes grew ${dialogPopped.from} -> ${dialogPopped.to} during the run (running then: ${dialogPopped.during.join(', ') || 'none'}). Do NOT close the window from here; tell the user.`); } else console.log(`\n===== os dialog guard: OpenWith.exe processes unchanged (${openWith0})${dialogOptedIn ? ', ' + dialogOptedIn + ' opened on purpose by an opted-in test and closed' : ''}`);
  const touched = homeGuard();
  if (touched.length) { failed.push('home-guard'); console.log(`\n===== HOME GUARD FAILED: a test wrote into the user's real home: ${touched.join(', ')}`); } else console.log('\n===== home guard: the real home folder was not touched');
  console.log(`\n===== ${picked.length - failed.length}/${picked.length} test files passed${failed.length ? '. FAILED: ' + failed.join(', ') : ''}`);
  console.log(`===== flakes (passed only on retry): ${flakes.length}${flakes.length ? ' -> ' + flakes.join(', ') : ''}`);
  console.log(`===== wall ${wall}s, machine CPU avg ${avg}% during the run (background before the run: ${background}%)${quick ? ' [quick]' : ''}`);
  process.exit(failed.length ? 1 : 0);
});

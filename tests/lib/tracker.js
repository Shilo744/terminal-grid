'use strict';
/*
 * מעקב אחרי כל מה שניסוי פותח (T58): שרתים, דפדפנים ותהליכי עזר. הכלל (RULES 4b): מותר לפתוח, חייבים לסגור בסוף הניסוי, גם בכישלון, בפסק זמן ובעצירה.
 *
 *  - רק לפי מספר תהליך מדויק (pid), ורק תהליכים שהניסוי הזה פתח בעצמו: אף פעם לפי שם, ואף פעם משהו שכבר רץ בהתחלה (חלון של המשתמש).
 *  - כל תהליך שהניסוי מתחיל נרשם (record). בסוף הריצה (יציאה רגילה, כישלון, Ctrl+C) הכול נסגר עם העץ שלו (taskkill /PID /T /F: תהליכי הילדים של שרת הם טרמינלים).
 *  - tests/run.js נותן לכל ריצה מזהה (TG_TEST_RUN_ID): הרישום נכתב גם לקובץ, ומי שנהרג בלי להספיק לנקות (פסק זמן, kill) מנוקה אחריו לפי הקובץ (sweep).
 *  - חלונות מערכת שהניסוי העלה (OpenWith.exe, "בחירת אפליקציה"): כל תהליך חדש מהתמונות הידועות שלא היה בהתחלה נסגר בסוף. ברירת המחדל: OpenWith.exe בלבד
 *    (אף אחד לא פותח אותו בכוונה בזמן ריצה). בדיקה שפותחת בכוונה משהו נוסף מצהירה על זה (allowExternal ב-harness) עם images משלה.
 *  - tasklist בלבד לחיפוש (בלי powershell/wmic/cmd), ו-taskkill לסגירה לפי pid.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TMP = path.join(__dirname, '..', '.tmp');
const RUN_ID = process.env.TG_TEST_RUN_ID || '';
const OPENER_IMAGES = ['OpenWith.exe'];
const regDir = () => (RUN_ID ? path.join(TMP, 'run-' + RUN_ID) : null);

/** pid -> שם התמונה, כפי שהמערכת מדווחת עכשיו */
function processTable() {
  const out = new Map();
  let text = '';
  try { text = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line);
    if (m) out.set(Number(m[2]), m[1]);
  }
  return out;
}

/** סוגר תהליך ואת העץ שלו לפי pid מדויק. מחזיר true אם הפקודה הצליחה */
function killTree(pid) {
  if (!pid || pid === process.pid) return false;
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; }
}

const mine = new Map();        // pid -> { image, label }
let baseline = null;           // pid -> image, ברגע המעקב הראשון (מה שכבר רץ לפני הניסוי)
let hooked = false;
let extraImages = [];          // תמונות נוספות שהניסוי הצהיר עליהן (allowExternal)

function log(file, entry) {
  const dir = regDir();
  if (!dir) return;
  try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, file), JSON.stringify(entry) + '\n'); } catch { /* הרישום הוא רשת ביטחון, לא תנאי */ }
}

function hook() {
  if (hooked) return;
  hooked = true;
  baseline = processTable();
  process.on('exit', () => { closeAll('exit'); });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => { closeAll(sig); process.exit(130); });
}

/** מתחילים לעקוב אחרי תהליך שהניסוי פתח (שרת, Chrome, עזר) */
function record(pid, image, label = '') {
  if (!pid) return;
  hook();
  mine.set(pid, { image, label });
  log(process.pid + '.jsonl', { a: 'start', pid, image, label, owner: process.pid });
}

/** התהליך נסגר כמו שצריך: מפסיקים לעקוב */
function forget(pid) {
  if (!mine.delete(pid)) return;
  log(process.pid + '.jsonl', { a: 'end', pid });
}

/** הניסוי הצהיר שהוא פותח בכוונה יישומים: התמונות שלהם נסגרות בסוף (רק חדשים, לפי pid) */
function watchImages(images = []) {
  hook();
  for (const i of images) if (!extraImages.includes(i)) extraImages.push(i);
}

/** תהליכים חדשים (שלא היו בהתחלה) מהתמונות שמעקב אחריהן */
function newOpeners() {
  if (!baseline) return [];
  const want = new Set([...OPENER_IMAGES, ...extraImages].map((x) => x.toLowerCase()));
  const out = [];
  for (const [pid, image] of processTable()) if (!baseline.has(pid) && want.has(image.toLowerCase()) && !mine.has(pid)) out.push({ pid, image });
  return out;
}

/** סוגר הכול: מה שנרשם (אם עוד חי ועדיין אותה תמונה) ופותחי חלונות חדשים. מחזיר רשימת מה שנסגר */
function closeAll(reason = '') {
  const closed = [];
  if (!hooked) return closed;
  const table = processTable();
  for (const [pid, info] of [...mine]) {
    const now = table.get(pid);
    if (now && now.toLowerCase() === info.image.toLowerCase()) {
      killTree(pid);
      closed.push({ pid, image: info.image, label: info.label });
    }
    forget(pid);
  }
  for (const o of newOpeners()) {
    killTree(o.pid);
    closed.push({ pid: o.pid, image: o.image, label: 'opened a window during the experiment' });
  }
  if (closed.length && reason !== 'exit-quiet') for (const c of closed) console.log(`[tracker] closed ${c.image} pid ${c.pid}${c.label ? ' (' + c.label + ')' : ''}`);
  return closed;
}

/** מה שנרשם בקבצי הריצה ועוד חי (תהליכים של בדיקה שנהרגה בלי לנקות). owner = pid של הבדיקה, או כל הריצה */
function readRegistry(dir, owner) {
  const alive = new Map();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  for (const f of files) {
    if (owner && f !== owner + '.jsonl') continue;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line) continue;
      try { const e = JSON.parse(line); if (e.a === 'start') alive.set(e.pid, e); else if (e.a === 'end') alive.delete(e.pid); } catch { /* שורה חלקית */ }
    }
  }
  return [...alive.values()];
}

/** סוגר לפי הקבצים את מה שנשאר חי (אותה תמונה בדיוק). מחזיר מה שנסגר; run.js מדפיס LEFTOVER לכל אחד */
function sweep(dir, owner) {
  const left = readRegistry(dir, owner);
  if (!left.length) return [];
  const table = processTable();
  const closed = [];
  for (const e of left) {
    const now = table.get(e.pid);
    if (now && now.toLowerCase() === String(e.image).toLowerCase()) { killTree(e.pid); closed.push(e); }
  }
  return closed;
}

/** pid-ים חיים של תמונות פותחי החלונות (ל-run.js: מי חדש מאז שהריצה התחילה) */
function openerPids(images = OPENER_IMAGES) {
  const want = new Set(images.map((x) => x.toLowerCase()));
  const out = [];
  for (const [pid, image] of processTable()) if (want.has(image.toLowerCase())) out.push(pid);
  return out;
}

/** הצהרות allowExternal של בדיקות שרצות עכשיו (קבצי optin-*.json בתיקיית הריצה) */
function declareOptIn(info) { const dir = regDir(); if (dir) { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `optin-${process.pid}.json`), JSON.stringify({ ...info, owner: process.pid })); } catch { /* ignore */ } } }
function optIns(dir) {
  const out = [];
  try { for (const f of fs.readdirSync(dir)) if (/^optin-\d+\.json$/.test(f)) { try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* ignore */ } } } catch { /* אין */ }
  return out;
}

module.exports = { processTable, killTree, record, forget, watchImages, newOpeners, closeAll, readRegistry, sweep, openerPids, declareOptIn, optIns, OPENER_IMAGES, TMP };

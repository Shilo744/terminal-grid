'use strict';
/*
 * תור המשימות של הזוג (T78): הקבצים הקטנים והלוגיקה סביבם.
 *   - STATUS.json: מונים (הושלמו), מזהי משימות שהסתיימו, הפעילות האחרונה (feed), מה שממתין לסקירת הארכיטקט.
 *   - ארכיון: משימה שסומנה [x] עוברת (עם שורת ה-Result) ל-.duo/archive/TASKS-done-<n>.md, ו-TASKS.md מחזיק רק משימות פתוחות ושורת אינדקס אחת.
 *   - תיבה: INBOX-architect.md (הודעת משתמש / משימות לסקירה / משימה חסומה). לעובד אין תיבה: הוא קורא את TASKS.md כולו.
 *   - מעבר מגרסה 1: הארכיון של המשימות שהסתיימו והשיחה הישנה, עם גיבוי מלא; המונים בלוח לא משתנים.
 * הפונקציות כאן כותבות לקבצים אבל לא מכירות סוכנים או טרמינלים (נבדקות ביחידה).
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');
const { TASKS_TEMPLATE } = require('./protocol');
const files = require('./files');
const { taskBlocks } = require('./tasks');

const ARCHIVE_FILE_MAX = 40;   // כמה משימות בקובץ ארכיון אחד
const RECENT_MAX = 12;         // משימות אחרונות שנשמרות ב-STATUS (להקשר ולרשימת "הושלמו" בלוח)
const FEED_MAX = 60;
const RESULT_CLIP = 600;

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const defaults = () => ({ v: 1, done: 0, doneIds: [], archiveSeq: 1, archiveCount: 0, recent: [], feed: [], pendingReview: [], reportedBlocked: [] });

function readStatus(project) {
  const p = files.paths(project);
  try { return { ...defaults(), ...JSON.parse(files.read(p.status) || '{}') }; } catch { return defaults(); }
}
function writeStatus(project, st) {
  const p = files.paths(project);
  fs.mkdirSync(p.dir, { recursive: true });
  writeFileAtomic(p.status, JSON.stringify(st, null, 1) + '\n');
}

/** שורת האינדקס: הטווחים של מספרי המשימות שהסתיימו (T1-T5, T7) */
function indexLine(doneIds) {
  const nums = [...new Set(doneIds.map((k) => /^T(\d+)$/.exec(k)).filter(Boolean).map((m) => Number(m[1])))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `T${nums[i]}-T${nums[j]}` : `T${nums[i]}`);
    i = j + 1;
  }
  return out.length ? `Done and archived (see .duo/archive/): ${out.join(', ')}` : '';
}
const INDEX_RE = /^Done and archived \(see \.duo\/archive\/\):.*$/m;

function setIndexLine(md, line) {
  if (INDEX_RE.test(md)) return md.replace(INDEX_RE, () => line);
  if (!line) return md;
  const blocks = taskBlocks(md);
  const lines = md.split(/\r?\n/);
  const at = blocks.length ? blocks[0].start : lines.length;
  lines.splice(at, 0, line, '');
  return lines.join('\n');
}

/**
 * יוצר את תיקיית הזוג אם חסרה. זוג חדש מקבל תבנית ו-STATUS ריק; תיקייה של גרסה 1 (שיחה, או משימות שהסתיימו בתוך TASKS.md) עוברת מעבר חד-פעמי עם גיבוי.
 * מחזיר את הנתיבים.
 */
function ensure(project) {
  const p = files.paths(project);
  fs.mkdirSync(p.dir, { recursive: true });
  if (!fs.existsSync(p.tasks)) fs.writeFileSync(p.tasks, TASKS_TEMPLATE);
  if (!fs.existsSync(p.status)) migrate(project);
  return p;
}

function migrate(project) {
  const p = files.paths(project);
  const hasOld = fs.existsSync(p.legacyChat) || taskBlocks(files.read(p.tasks)).some((b) => b.status === 'done');
  if (hasOld) {
    // גיבוי מלא לפני שנוגעים: אם משהו ישתבש, הכול נשמר כאן כפי שהיה
    fs.mkdirSync(p.backup, { recursive: true });
    for (const f of [p.tasks, p.legacyChat]) {
      const to = path.join(p.backup, path.basename(f));
      if (fs.existsSync(f) && !fs.existsSync(to)) fs.copyFileSync(f, to);
    }
  }
  const st = defaults();
  archiveDone(project, st, { quiet: true });
  if (fs.existsSync(p.legacyChat)) {
    fs.mkdirSync(p.archive, { recursive: true });
    let to = path.join(p.archive, 'CHAT-before-v2.md');
    for (let i = 2; fs.existsSync(to); i++) to = path.join(p.archive, `CHAT-before-v2-${i}.md`);
    fs.renameSync(p.legacyChat, to);
  }
  writeStatus(project, st);
  return st;
}

/**
 * מעביר משימות שסומנו [x] לארכיון ומעדכן את st (המונים, recent, feed, pendingReview). idempotent: משימה שכבר בארכיון רק מוסרת מהתור.
 * quiet: בלי feed ובלי "ממתין לסקירה" (מעבר מגרסה 1). מחזיר את המשימות שהועברו עכשיו. הקורא שומר את st.
 */
// Every finished task, in the order they were archived, for the board (one list in order). Cached by the archive files' size and time, so a snapshot does not re-parse them.
const archiveCache = new Map();
function readArchiveItems(project) {
  const p = files.paths(project);
  let names = [];
  try { names = fs.readdirSync(p.archive).filter((n) => /^TASKS-done-\d+\.md$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])); } catch { return []; }
  const sig = names.map((n) => { try { const s = fs.statSync(path.join(p.archive, n)); return n + ':' + s.size + ':' + s.mtimeMs; } catch { return n; } }).join('|');
  const hit = archiveCache.get(p.archive);
  if (hit && hit.sig === sig) return hit.items;
  const items = [];
  for (const n of names) {
    for (const b of taskBlocks(files.read(path.join(p.archive, n)))) {
      if (b.status !== 'done') continue;
      items.push({ id: b.id || b.key, status: 'done', title: clip(b.title, 160), text: clip(b.title, 160), detail: b.result ? 'Result: ' + clip(b.result, 300) : '' });
    }
  }
  archiveCache.set(p.archive, { sig, items });
  return items;
}

function archiveDone(project, st, { quiet = false, ready = null } = {}) {
  const p = files.paths(project);
  const md = files.read(p.tasks);
  const blocks = taskBlocks(md).filter((b) => b.status === 'done' && (!ready || ready(b))); // ready: משימה שעוד לא מוכנה לארכיון (אין לה Result והעובד באמצע תור) נשארת בקובץ
  if (!blocks.length) return [];
  // כל השינויים נעשים קודם על עותק (st והוספות לקובצי הארכיון), ורק אם הקובץ לא השתנה בינתיים הם נכתבים: העובד והארכיטקט עורכים אותו במקביל, ודריסה שלו הייתה מאבדת את העריכה
  const cur = JSON.parse(JSON.stringify(st));
  const appends = [];
  const moved = [];
  for (const b of blocks) {
    if (cur.doneIds.includes(b.key)) continue;
    if (cur.archiveCount >= ARCHIVE_FILE_MAX) { cur.archiveSeq++; cur.archiveCount = 0; }
    appends.push({ file: path.join(p.archive, `TASKS-done-${cur.archiveSeq}.md`), text: b.raw + '\n\n' });
    cur.archiveCount++;
    cur.doneIds.push(b.key);
    cur.done++;
    const item = { id: b.id || b.key, title: clip(b.title, 120), result: clip(b.result, RESULT_CLIP) };
    cur.recent.push(item);
    moved.push({ ...item, key: b.key });
    if (!quiet) {
      cur.pendingReview.push({ ...item, status: 'done' });
      pushFeed(cur, 'worker', `${item.id} — ${item.title}${item.result ? '\n' + item.result : ''}`);
    }
  }
  if (cur.recent.length > RECENT_MAX) cur.recent = cur.recent.slice(-RECENT_MAX);
  // מוחקים את הגושים מהקובץ (מהסוף להתחלה, כדי שהמיקומים לא יזוזו) ומעדכנים את שורת האינדקס
  const lines = md.split(/\r?\n/);
  for (const b of [...blocks].reverse()) {
    let end = b.end;
    if (lines[end + 1] !== undefined && lines[end + 1].trim() === '') end++; // שורה ריקה אחת אחרי הגוש
    lines.splice(b.start, end - b.start + 1);
  }
  if (files.read(p.tasks) !== md) return []; // השתנה בזמן שחישבנו: לא נכתב ולא נספר כלום (ה-watcher מפעיל סבב חדש)
  fs.mkdirSync(p.archive, { recursive: true });
  for (const a of appends) fs.appendFileSync(a.file, a.text);
  for (const k of Object.keys(st)) delete st[k];
  Object.assign(st, cur);
  writeStatus(project, st); // קודם המונים ואז התור: קריסה באמצע משאירה משימה שכבר נספרה בקובץ, והמעבר הבא רק מסיר אותה (בלי לספור שוב)
  writeFileAtomic(p.tasks, setIndexLine(lines.join('\n'), indexLine(st.doneIds)));
  return moved;
}

/** משימות חסומות [!] שעוד לא דווחו: נרשמות לסקירה ולפעילות (פעם אחת לכל משימה). מחזיר את החדשות */
function noteBlocked(project, st) {
  const p = files.paths(project);
  const fresh = [];
  for (const b of taskBlocks(files.read(p.tasks))) {
    if (b.status !== 'blocked' || st.reportedBlocked.includes(b.key)) continue;
    st.reportedBlocked.push(b.key);
    const item = { id: b.id || b.key, title: clip(b.title, 120), result: clip(b.result, RESULT_CLIP), status: 'blocked' };
    st.pendingReview.push(item);
    pushFeed(st, 'worker', `${item.id} — ${item.title}\n${item.result || 'blocked'}`, 'blocked');
    fresh.push(item);
  }
  if (st.reportedBlocked.length > 200) st.reportedBlocked = st.reportedBlocked.slice(-200);
  return fresh;
}

function pushFeed(st, author, text, kind) {
  st.feed.push({ t: Date.now(), author, kind: kind || undefined, text: String(text).trim().slice(0, 900) });
  if (st.feed.length > FEED_MAX) st.feed = st.feed.slice(-FEED_MAX);
}

/** תיבת הארכיטקט: הודעות משתמש, משימות שהסתיימו לסקירה, משימות חסומות */
function writeArchitectInbox(project, { users = [], review = [], remaining = 0 }) {
  const p = files.paths(project);
  const parts = ['# Your inbox (written by the server)\n'];
  if (users.length) parts.push('## Message from the user\n\n' + users.map((u) => u.text.trim()).join('\n\n---\n\n') + '\n');
  const blocked = review.filter((r) => r.status === 'blocked');
  const done = review.filter((r) => r.status !== 'blocked');
  if (blocked.length) parts.push('## Blocked tasks (the worker could not do them)\n\n' + blocked.map((r) => `- ${r.id} — ${r.title}\n  Reason: ${r.result || '(none given)'}`).join('\n') + '\n');
  if (done.length) parts.push(`## Finished since your last review (archived automatically)\n\n` + done.map((r) => `- ${r.id} — ${r.title}\n  Result: ${r.result || '(no Result line)'}`).join('\n') + '\n');
  parts.push(`## Queue\n\n${remaining ? `${remaining} open task(s) remain in .duo/TASKS.md.` : 'No open tasks remain in .duo/TASKS.md.'}\n`);
  fs.mkdirSync(p.dir, { recursive: true });
  writeFileAtomic(p.inbox.architect, parts.join('\n'));
}

module.exports = { readArchiveItems, ensure, migrate, readStatus, writeStatus, archiveDone, noteBlocked, pushFeed, writeArchitectInbox, indexLine, setIndexLine, clip, defaults, ARCHIVE_FILE_MAX, RECENT_MAX };

'use strict';
/*
 * עבודה עם קבצי הזוג בתיקיית הפרויקט (T78): נתיבים, יצירה, קריאה, וצפייה בשינויים בתור המשימות.
 * הצפייה היא fs.watch (מהיר) + בדיקת גיבוי כל כמה שניות (כי בתיקיות OneDrive האירועים לפעמים מתפספסים).
 * הלוגיקה של התור (ארכיון, מונים, תיבות, מעבר מגרסה 1) ב-queue.js.
 */
const fs = require('fs');
const path = require('path');
const { DIR, TASKS_FILE, CHAT_FILE, STATUS_FILE, INBOX, ARCHIVE_DIR, BACKUP_DIR } = require('./protocol');

function paths(project) {
  const dir = path.join(project, DIR);
  return {
    dir, tasks: path.join(dir, TASKS_FILE), status: path.join(dir, STATUS_FILE), archive: path.join(dir, ARCHIVE_DIR), backup: path.join(dir, BACKUP_DIR),
    inbox: { architect: path.join(dir, INBOX.architect) }, legacyChat: path.join(dir, CHAT_FILE),
  };
}

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

/** מחזיר { close() }. onChange נקרא אחרי השהיה קצרה (איחוד אירועים), ופעם בכמה שניות לפי תוכן התור. */
function watch(project, onChange, { pollMs = 3000, debounceMs = 400 } = {}) {
  const p = paths(project);
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, debounceMs); };
  let watcher = null;
  try {
    watcher = fs.watch(p.dir, { persistent: false }, (_ev, name) => { if (!name || name === TASKS_FILE) fire(); });
    watcher.on('error', () => { /* הבדיקה התקופתית ממשיכה */ });
  } catch { /* התיקייה עוד לא קיימת — הבדיקה התקופתית תטפל */ }
  let last = read(p.tasks);
  const poll = setInterval(() => {
    const now = read(p.tasks);
    if (now !== last) { last = now; fire(); }
  }, pollMs);
  poll.unref();
  return { close() { clearTimeout(timer); clearInterval(poll); try { if (watcher) watcher.close(); } catch { /* ignore */ } } };
}

module.exports = { paths, read, watch };

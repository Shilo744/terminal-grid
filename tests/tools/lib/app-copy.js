'use strict';
/*
 * העתק זמני של האפליקציה (server.js, server/, public/ ו-junction ל-node_modules) שכלי הצילום עובדים עליו.
 * למה העתק: אפשר לשנות בו את index.html (להזריק סקריפט סצנה) בלי לגעת בקוד האמיתי.
 * ההעתק נוצר עם copyFileSync (לא fs.cpSync, שמפיל את node בשקט), וקבצים שנעלמו מהמקור נמחקים גם מההעתק.
 */
const path = require('path');
const fs = require('fs');
const { APP } = require('../../lib/harness');

// מחיקה של קבצים ותיקיות רגילים בלבד (לא עוקבת אחרי קישורים; משמשת רק בתיקיות שהכלי יצר, בלי junction)
function removeTree(p) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const c = path.join(p, e.name);
    if (e.isDirectory()) removeTree(c); else fs.unlinkSync(c);
  }
  fs.rmdirSync(p);
}

// העתקה רקורסיבית בלי fs.cpSync; קבצים שנעלמו מהמקור נמחקים מההעתק, כדי שגרסה ישנה לא תישאר שם
function syncDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  const names = new Set();
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    names.add(e.name);
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) syncDir(a, b); else fs.copyFileSync(a, b);
  }
  for (const e of fs.readdirSync(to, { withFileTypes: true })) {
    if (names.has(e.name)) continue;
    const b = path.join(to, e.name);
    if (e.isDirectory()) removeTree(b); else fs.unlinkSync(b);
  }
}

// יוצר/מרענן את ההעתק בתיקייה dir ומחזיר אותה. allowFraming: מסיר מההעתק את x-frame-options כדי שאפשר יהיה לשבץ את האפליקציה ב-iframe
function makeAppCopy(dir, { allowFraming = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  let server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  if (allowFraming) {
    const next = server.replace("'x-frame-options': 'DENY',", '');
    if (next === server) throw new Error('לא נמצאה הכותרת x-frame-options ב-server.js');
    server = next;
  }
  fs.writeFileSync(path.join(dir, 'server.js'), server);
  fs.copyFileSync(path.join(APP, 'package.json'), path.join(dir, 'package.json'));
  if (fs.existsSync(path.join(APP, 'server'))) syncDir(path.join(APP, 'server'), path.join(dir, 'server'));
  syncDir(path.join(APP, 'public'), path.join(dir, 'public'));
  const nm = path.join(dir, 'node_modules');
  if (!fs.existsSync(nm)) fs.symlinkSync(path.join(APP, 'node_modules'), nm, 'junction');
  return dir;
}

// שינוי טקסט (למשל ברירת מחדל) בכל קובץ JS של הממשק שבהעתק; נכשל אם אין מה להחליף
function patchDefault(dir, pattern, replacement) {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(dir);
  let hits = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const next = src.replace(pattern, replacement);
    if (next !== src) { fs.writeFileSync(f, next); hits++; }
  }
  if (!hits) throw new Error('לא נמצא טקסט להחלפה: ' + pattern);
}

module.exports = { makeAppCopy, patchDefault, syncDir, removeTree };

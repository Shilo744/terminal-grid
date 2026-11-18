'use strict';
/*
 * הגדרות המשתמש, בשרת (settings.json): מקור האמת היחיד, נשלח לכל חלון פתוח ושורד שינוי פורט.
 * הסכמה (SCHEMA) היא טבלה הצהרתית: מפתח (נתיב עם נקודות), סוג, ברירת מחדל וגבולות. הוספת הגדרה = שורה אחת בטבלה.
 * בלי תלויות. הקובץ נכתב אטומית (קובץ זמני + rename), וקובץ פגום מועתק ל-.bak ואז מתחילים מברירות מחדל.
 */
const fs = require('fs');
const { writeFileAtomic } = require('./atomic-write');

const VERSION = 1;
const MAX_STRING = 400;

// סוגים: bool | int (min/max, step אופציונלי) | number (min/max, step אופציונלי) | enum (values) | string (max אורך) | strings (max פריטים, maxLen אורך כל פריט)
// label: מזהה טקסט לממשק (ההגדרות עצמן לא תלויות בו)
const SCHEMA = [
  { path: 'terminal.fontFamily', type: 'string', def: 'TG Cascadia', max: 80, label: 'terminal.fontFamily' },
  { path: 'terminal.fontSize', type: 'int', def: 14, min: 9, max: 24, label: 'terminal.fontSize' },
  { path: 'terminal.lineHeight', type: 'number', def: 1, min: 1, max: 1.6, step: 0.05, label: 'terminal.lineHeight' },
  { path: 'terminal.cursorStyle', type: 'enum', def: 'block', values: ['block', 'bar', 'underline'], label: 'terminal.cursorStyle' },
  { path: 'terminal.cursorBlink', type: 'bool', def: true, label: 'terminal.cursorBlink' },
  { path: 'terminal.scrollback', type: 'int', def: 5000, min: 1000, max: 50000, step: 500, label: 'terminal.scrollback' },
  { path: 'appearance.rtlLayer', type: 'bool', def: true, label: 'appearance.rtlLayer' },
  // alias: ערכים שמורים מגרסאות קודמות (vscode ו-intellij היו שני מראות כמעט זהים) הופכים ל-ide (T49)
  { path: 'appearance.style', type: 'enum', def: 'ide', values: ['ide', 'classic', 'paper'], alias: { vscode: 'ide', intellij: 'ide' }, label: 'appearance.style' },
  { path: 'appearance.accent', type: 'enum', def: 'default', values: ['default', 'blue', 'teal', 'violet', 'green', 'amber', 'rose'], label: 'appearance.accent' },
  { path: 'ui.sideOpen', type: 'bool', def: false, label: 'ui.sideOpen' },
  { path: 'ui.advancedOpen', type: 'bool', def: false, label: 'ui.advancedOpen' },
  { path: 'ui.notifyWaiting', type: 'bool', def: false, label: 'ui.notifyWaiting' },
  // virtual: האמת היא קובץ הקיצור בתיקיית ההפעלה של Windows (server/autostart.js), לא settings.json. הערך נקבע בכל קריאה, ו-patch מתעלם ממנו
  { path: 'system.autostart', type: 'bool', def: false, virtual: true, label: 'system.autostart' },
  { path: 'claude.autoCompact.mode', type: 'enum', def: 'default', values: ['default', 'early', 'off'], label: 'claude.autoCompact.mode' },
  { path: 'claude.autoCompact.window', type: 'enum', def: 400000, values: [150000, 250000, 400000, 600000], label: 'claude.autoCompact.window' },
  { path: 'ui.cwd', type: 'string', def: '', max: 400, label: 'ui.cwd' },
  { path: 'ui.recents', type: 'strings', def: [], max: 8, maxLen: 400, label: 'ui.recents' },
];

const BY_PATH = new Map(SCHEMA.map((e) => [e.path, e]));

const getPath = (obj, p) => p.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
function setPath(obj, p, value) {
  const keys = p.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  o[keys[keys.length - 1]] = value;
}

const clone = (v) => (Array.isArray(v) ? v.slice() : v);

// ערך אחד מול הסכמה: מחזיר { ok, value }. לא זורק לעולם.
function check(entry, raw) {
  switch (entry.type) {
    case 'bool':
      return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false };
    case 'int':
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false };
      let v = Math.min(entry.max, Math.max(entry.min, raw));
      if (entry.step) v = entry.min + Math.round((v - entry.min) / entry.step) * entry.step; // הצמדה לצעד (מתחילים ב-min)
      v = entry.type === 'int' ? Math.round(v) : Math.round(v * 1e6) / 1e6; // בלי שאריות של נקודה צפה (1.1500000000000001)
      return { ok: true, value: Math.min(entry.max, Math.max(entry.min, v)) };
    }
    case 'enum': {
      const v = entry.alias && Object.prototype.hasOwnProperty.call(entry.alias, raw) ? entry.alias[raw] : raw;
      return entry.values.includes(v) ? { ok: true, value: v } : { ok: false };
    }
    case 'string':
      return typeof raw === 'string' ? { ok: true, value: raw.slice(0, entry.max || MAX_STRING) } : { ok: false };
    case 'strings': {
      if (!Array.isArray(raw)) return { ok: false };
      const out = [];
      for (const s of raw) {
        if (typeof s !== 'string' || !s) continue;
        const v = s.slice(0, entry.maxLen || MAX_STRING);
        if (!out.includes(v)) out.push(v);
        if (out.length >= (entry.max || 20)) break;
      }
      return { ok: true, value: out };
    }
    default:
      return { ok: false };
  }
}

// כל ברירות המחדל, כאובייקט מקונן, כולל הגרסה והדגל migrated
function defaults() {
  const out = { v: VERSION, migrated: false };
  for (const e of SCHEMA) setPath(out, e.path, clone(e.def));
  return out;
}

// מקבל כל דבר ומחזיר אובייקט תקין מלא: מפתחות לא מוכרים נזרקים, מספרים מוגבלים, ערך לא תקין חוזר לברירת המחדל
function normalize(obj) {
  const src = obj && typeof obj === 'object' ? obj : {};
  const out = { v: VERSION, migrated: src.migrated === true };
  for (const e of SCHEMA) {
    const r = check(e, getPath(src, e.path));
    setPath(out, e.path, r.ok ? r.value : clone(e.def));
  }
  return out;
}

// מיזוג חלקי על מצב קיים: רק מפתחות מוכרים עם ערך תקין נכנסים, השאר נשארים כמו שהיו
function merge(current, partial) {
  const out = normalize(current);
  if (!partial || typeof partial !== 'object') return out;
  for (const e of SCHEMA) {
    if (e.virtual) continue;
    const raw = getPath(partial, e.path);
    if (raw === undefined) continue;
    const r = check(e, raw);
    if (r.ok) setPath(out, e.path, r.value);
  }
  return out;
}

// virtual: { 'נתיב.הגדרה': () => ערך } לערכים שנקראים מהמערכת ולא נשמרים בקובץ (למשל האם הקיצור להפעלה אוטומטית קיים)
function createSettings({ file, log = () => {}, virtual = {} }) {
  let current = defaults();
  const listeners = new Set();

  function load() {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { current = defaults(); return current; } // אין קובץ: ברירות מחדל
    try {
      current = normalize(JSON.parse(text));
    } catch (e) {
      try { fs.copyFileSync(file, file + '.bak'); } catch { /* ignore */ }
      log('settings file is corrupt, copied to .bak and starting from defaults:', e.message);
      current = defaults();
    }
    return current;
  }

  function save() {
    try {
      const out = normalize(current);
      for (const e of SCHEMA) if (e.virtual) { const keys = e.path.split('.'); let o = out; for (const k of keys.slice(0, -1)) o = o && o[k]; if (o) delete o[keys[keys.length - 1]]; }
      writeFileAtomic(file, JSON.stringify(out, null, 2));
      return true;
    } catch (e) { log('save settings failed', e.message); return false; }
  }

  const get = () => {
    const out = normalize(current);
    for (const [p, fn] of Object.entries(virtual)) { try { setPath(out, p, !!fn()); } catch { /* נשאר ברירת המחדל */ } }
    return out;
  };

  // patch: מיזוג חלקי, שמירה, ועדכון המאזינים. migrate: ההעברה החד-פעמית מ-localStorage (רק אם עוד לא בוצעה)
  function patch(partial, { migrate = false } = {}) {
    if (migrate && current.migrated) return get();
    const next = merge(current, partial);
    if (migrate) next.migrated = true;
    current = next;
    save();
    const snapshot = get();
    for (const fn of listeners) { try { fn(snapshot); } catch (e) { log('settings listener failed', e.message); } }
    return snapshot;
  }

  const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  return { load, save, get, patch, onChange, file };
}

// משתני הסביבה של דחיסת שיחה אוטומטית לטרמינל של Claude חדש (תהליך חדש בלבד; תהליך רץ לא משתנה). sig מזהה את ההגדרה שהטרמינל הותחל איתה.
//   default: לא מגדירים כלום (לא דורסים מה שמוגדר בסביבת המשתמש); early: CLAUDE_CODE_AUTO_COMPACT_WINDOW=<טוקנים>; off: DISABLE_AUTO_COMPACT=1
function autoCompactEnv(settings) {
  const c = (settings && settings.claude && settings.claude.autoCompact) || { mode: 'default', window: 400000 };
  if (c.mode === 'early') return { env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(c.window) }, sig: 'early:' + c.window };
  if (c.mode === 'off') return { env: { DISABLE_AUTO_COMPACT: '1' }, sig: 'off' };
  return { env: {}, sig: 'default' };
}

// הסכמה לממשק (בלי פונקציות), כדי שהלקוח יכיל גבולות וברירות מחדל בלי כפילות
const publicSchema = () => SCHEMA.map((e) => ({ ...e, def: clone(e.def) }));

module.exports = { SCHEMA, BY_PATH, VERSION, defaults, normalize, merge, createSettings, publicSchema, autoCompactEnv };

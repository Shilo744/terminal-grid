/* ---------- הגדרות: מקור האמת בשרת (settings.json), כאן עותק מקומי, שליחה לשרת וקליטה מחלונות אחרים ---------- */
// getSetting/setSetting עובדים לפי נתיב עם נקודות (למשל 'terminal.fontSize'). שינוי מקומי נראה מיד (אופטימי),
// נשלח לשרת בדחייה של 200ms, והשרת משדר את המצב המלא לכל החלונות. localStorage (tg.*) הוא רק מטמון לציור הראשון
// ומקור להעברה החד-פעמית של הגדרות ישנות לשרת.
import { SETTINGS_FALLBACK } from './constants.js';
import { bus } from './state.js';
import { store } from './store.js';
import { send, onMessage } from './connection.js';

// נתיב הגדרה -> מפתח localStorage הישן (tg.<מפתח>). המפתחות האלה נשארים תקפים (docs/client-architecture.md, כלל 5)
const CACHE_KEYS = {
  'terminal.fontSize': 'fontSize',
  'terminal.fontFamily': 'fontFamily',
  'appearance.rtlLayer': 'rtlLayer',
  // המראה נקרא גם ב-index.html לפני הציור הראשון (tg.appearanceStyle / tg.appearanceAccent)
  'appearance.style': 'appearanceStyle',
  'appearance.accent': 'appearanceAccent',
  'ui.sideOpen': 'side',
  'ui.cwd': 'cwd',
  'ui.recents': 'recents',
};

const FLUSH_MS = 200;

// מה ש-localStorage החזיק לפני שהשרת ענה: משמש לציור הראשון ולהעברה. נקרא פעם אחת, לפני שמשהו כותב למטמון.
const legacy = {};
for (const [path, key] of Object.entries(CACHE_KEYS)) {
  const v = store.get(key, undefined);
  const fb = SETTINGS_FALLBACK[path];
  // ערך ישן מסוג לא צפוי (אחסון פגום) לא נכנס, כדי שהציור הראשון וההעברה לשרת לא יסתמכו עליו
  if (v !== undefined && typeof v === typeof fb && Array.isArray(v) === Array.isArray(fb)) legacy[path] = v;
}

export const settings = { ...SETTINGS_FALLBACK, ...legacy }; // מפה שטוחה: נתיב -> ערך
let schema = [];                 // הסכמה מהשרת (סוג, ברירת מחדל, גבולות)
let migrated = true;             // ברירת מחדל זהירה: לא מעבירים עד שהשרת אומר שעוד לא
let migrationSent = false;
const listeners = new Map();     // נתיב -> [fn]
let pending = {};                // שינויים מקומיים שעוד לא נשלחו
let flushTimer = null;
const inflight = new Set();      // מזהי בקשות ששלחנו והשרת עוד לא החזיר עליהן הד
const touched = {};              // נתיב -> מתי שינינו אותו כאן לאחרונה (הד מאוחר של ערך קודם לא דורס שינוי טרי: T38)
const ECHO_GUARD_MS = 800;

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- ממיר בין נתיב שטוח לאובייקט מקונן ---------- */
function nest(flat) {
  const out = {};
  for (const [path, value] of Object.entries(flat)) {
    const keys = path.split('.');
    let o = out;
    for (const k of keys.slice(0, -1)) o = o[k] || (o[k] = {});
    o[keys[keys.length - 1]] = value;
  }
  return out;
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out); else out[path] = v;
  }
  return out;
}

/* ---------- קריאה וכתיבה ---------- */
export const getSetting = (path) => settings[path];

export function defaultOf(path) {
  const e = schema.find((x) => x.path === path);
  return e ? e.def : SETTINGS_FALLBACK[path];
}

// הסכמה כפי שהשרת שלח (למשל לגבולות של מחוון); מערך ריק עד שהשרת ענה
export const getSchema = () => schema;

function notify(path) {
  for (const fn of listeners.get(path) || []) fn(settings[path], path);
  bus.emit('settings', path);
}

function writeCache(path, value) {
  const key = CACHE_KEYS[path];
  if (key) store.set(key, value);
}

export function onSetting(path, fn) {
  if (!listeners.has(path)) listeners.set(path, []);
  listeners.get(path).push(fn);
  return () => listeners.set(path, listeners.get(path).filter((x) => x !== fn));
}

function flush() {
  flushTimer = null;
  const batch = pending;
  pending = {};
  if (!Object.keys(batch).length) return;
  const rid = Math.random().toString(36).slice(2);
  if (send({ t: 'settings:set', patch: nest(batch), rid })) { inflight.add(rid); return; }
  pending = { ...batch, ...pending }; // אין חיבור: מחזירים לתור, ונשלח כשהחיבור יחזור
}

export function setSetting(path, value) {
  if (sameValue(settings[path], value)) return;
  settings[path] = value;
  touched[path] = Date.now();
  writeCache(path, value);
  pending[path] = value;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, FLUSH_MS);
  notify(path);
}

/* ---------- קליטה מהשרת ---------- */
function applyServer(nested) {
  const flat = flatten(nested);
  migrated = flat.migrated === true;
  delete flat.v; delete flat.migrated;
  for (const [path, value] of Object.entries(flat)) {
    if (path in pending) continue; // שינוי מקומי שעוד לא נשלח גובר על מה שהשרת מחזיק
    if (Date.now() - (touched[path] || 0) < ECHO_GUARD_MS) continue; // שינינו אותו הרגע: מה שהשרת שולח הוא הד של ערך קודם
    if (sameValue(settings[path], value)) continue;
    settings[path] = value;
    writeCache(path, value);
    notify(path);
  }
}

// ההעברה החד-פעמית: מה שהיה ב-localStorage (לפני עדכון זה) עובר לשרת, והשרת מסמן migrated=true
function maybeMigrate() {
  if (migrated || migrationSent) return;
  if (send({ t: 'settings:set', patch: nest(legacy), migrate: true })) migrationSent = true;
}

// טעינה ראשונה לפני החיבור (נקראת מ-main.js): אם השרת לא עונה, ממשיכים עם המטמון
export async function loadSettings() {
  try {
    const j = await (await fetch('/api/settings')).json();
    schema = j.schema || [];
    applyServer(j.settings);
  } catch { /* offline: connect() will handle */ }
}

export function initSettings() {
  onMessage('list', (m) => { if (m.settings) { applyServer(m.settings); maybeMigrate(); } });
  onMessage('settings', (m) => {
    // הד של בקשה שלנו: מחכים להד האחרון, שמכיל את המצב המצטבר
    if (m.rid) inflight.delete(m.rid);
    if (!inflight.size) applyServer(m.settings);
  });
  // החיבור חזר: שולחים שינויים שנתקעו
  bus.on('connected', () => { if (Object.keys(pending).length && !flushTimer) flushTimer = setTimeout(flush, 0); });
}

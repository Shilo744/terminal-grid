/* ---------- מצב משותף ותקשורת בין מודולים ---------- */

// לשוניות הרשת (T60): לכל לשונית סדר, הגדלה ומיקוד משלה; כל טרמינל (שאינו של זוג) שייך לאחת. state.order / expandedId / focusId הם תמיד של הלשונית
// הפעילה (getter/setter), כך שכל הקוד שעובד על "הרשת הנוכחית" לא משתנה.
const activeOf = (s) => s.tabs.find((t) => t.id === s.activeTabId) || s.tabs[0];
export const activeTab = () => activeOf(state);
export const tabOf = (paneId) => state.tabs.find((t) => t.order.includes(paneId)) || null;

export const state = {
  ws: null,
  connected: false,
  quitting: false,
  panes: new Map(),     // id -> pane
  tabs: [{ id: 't1', name: '', cwd: '', order: [], expanded: null, focus: null }], // name ריק = השם המחושב (tabs.js)
  activeTabId: 't1',
  get order() { return activeOf(this).order; },           // ids של הלשונית הפעילה, לפי סדר התצוגה
  set order(v) { activeOf(this).order = v; },
  get focusId() { return activeOf(this).focus; },
  set focusId(v) { activeOf(this).focus = v; },
  get expandedId() { return activeOf(this).expanded; },
  set expandedId(v) { activeOf(this).expanded = v; },
  info: { home: '', claude: true },
  reqs: new Set(),
  pending: new Map(),   // reqId -> { el, label, timer }: כרטיס "פותח את..." בגריד עד שהשרת עונה (pending.js)
  after: new Map(),     // reqId -> id של טרמינל: הטרמינל החדש (שכפול) ייכנס מיד אחריו בסדר
  synced: false,        // השרת כבר שלח את רשימת הטרמינלים (לא מציגים "אין טרמינלים" לפני כן)
  restored: false,      // הסדר/ההגדלה/המיקוד מהשרת כבר הוחזרו פעם אחת
};

/*
 * אירועים פנימיים: מודול נמוך לא מייבא מודול גבוה ממנו; הוא מכריז על אירוע והמודול הגבוה מאזין לו.
 * הקריאה סינכרונית (באותו מקום בקוד שבו הייתה קריאה ישירה), ולכן הסדר נשאר זהה.
 *   connected - החיבור לשרת נפתח (launch מרענן את מידע השרת)
 *   focus     - המיקוד עבר לטרמינל אחר (status מעדכן את הסיכום)
 *   expanded  - הטרמינל המוגדל השתנה (panes מצייר מחדש את הכותרות)
 *   tabs      - הלשוניות או הלשונית הפעילה השתנו (שורת הלשוניות נבנית מחדש)
 *   status-tick - בדיקת המצב של הטרמינלים (כל 400ms) הסתיימה (שורת הלשוניות מעדכנת נקודות וספירה אם השתנו)
 *   settings  - הגדרה השתנתה (הארגומנט: הנתיב שלה); רוב המודולים מאזינים לנתיב אחד דרך onSetting ב-settings.js
 */
const listeners = new Map();
export const bus = {
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(fn);
  },
  emit(name, ...args) {
    for (const fn of listeners.get(name) || []) fn(...args);
  },
};

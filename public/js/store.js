/* ---------- אחסון מקומי בדפדפן ---------- */
// כל המפתחות מתחילים ב-"tg." (למשל tg.fontSize). האחסון יכול להיות חסום (חלון פרטי, נתונים מנוקים), לכן הכול בתוך try.
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('tg.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('tg.' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

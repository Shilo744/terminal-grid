'use strict';
/*
 * מבטיח שדפדפן הבדיקות לעולם לא מוסר ל-Windows ניווט לתוכנה חיצונית (T50).
 *
 * למה: ב-Chrome הסכמה mailto: נמצאת ברשימת "מותר בלי לשאול" (kAllowedSchemes), ולכן ניווט אליה מפעיל את תוכנת הדואר של המחשב מיד, בלי חלון אישור.
 * במחשב הזה ברירת המחדל של mailto: מצביעה על מחלקה שלא קיימת, אז כל הפעלה כזו מקפיצה על שולחן העבודה של המשתמש את חלון "בחירת אפליקציה" (OpenWith.exe) שנשאר פתוח.
 * ההעדפה protocol_handler.excluded_schemes לא יכולה לחסום: ב-Chrome ערך true שם מתעלמים ממנו בכוונה, ו-false דווקא מתיר. אין מתג שורת פקודה או feature שמכבה את זה,
 * ומדיניות (policy) ב-Windows נקראת רק מהרישום, שאסור לנו לגעת בו. לכן החסימה נעשית בדף עצמו, לפני שהניווט מגיע לדפדפן:
 * window.open, לחיצה על עוגן, שליחת טופס, ו-Navigation API (location.href = ... וכל ניווט אחר שהסקריפט יוזם) שיעדם אינו http/https/about/blob/data מבוטלים ונרשמים ב-window.__tgBlockedExternal.
 * הקוד נטען לפני כל סקריפט של הדף, בכל מסגרת, כך שגם באג באפליקציה (או בדיקה) לא יכול להקפיץ חלון מערכת.
 */

// רץ בתוך הדף (מוזרק כטקסט): לא להשתמש במשתנים מבחוץ
function guard() {
  const SAFE = /^(https?|about|blob|data):$/i;
  const log = (window.__tgBlockedExternal = window.__tgBlockedExternal || []);
  // allowExternal (T58): סכמות שהבדיקה הצהירה עליהן בכוונה (בעמוד הזה בלבד)
  const allowed = (p) => (window.__tgAllowedSchemes || []).includes(String(p).replace(/:$/, '').toLowerCase());
  const web = (u) => { try { const p = new URL(String(u), location.href).protocol; return SAFE.test(p) || allowed(p); } catch { return false; } };
  const block = (what, u) => { log.push(what + ' ' + String(u).slice(0, 80)); };

  const open = window.open;
  window.open = function (u, ...rest) {
    if (u != null && String(u) !== '' && !web(u)) { block('open', u); return null; }
    return open.call(this, u, ...rest);
  };

  // שלב הבועות (לא הלכידה): כך האפליקציה והבדיקות רואות את האירוע קודם, וחגורת הבטיחות של האפליקציה עצמה נבדקת בכנות (אם היא עצרה, כאן כבר אין מה לעשות)
  const onClick = (e) => {
    if (e.defaultPrevented) return;
    const a = e.target && e.target.closest && e.target.closest('a[href], area[href]');
    if (a && !web(a.href)) { e.preventDefault(); block('click', a.href); }
  };
  window.addEventListener('click', onClick, false);
  window.addEventListener('auxclick', onClick, false);

  for (const name of ['submit', 'requestSubmit']) {
    const orig = HTMLFormElement.prototype[name];
    HTMLFormElement.prototype[name] = function (...a) {
      if (this.action && !web(this.action)) { block(name, this.action); return undefined; }
      return orig.apply(this, a);
    };
  }

  if (window.navigation && typeof window.navigation.addEventListener === 'function') {
    window.navigation.addEventListener('navigate', (e) => {
      if (e.destination && e.destination.url && !web(e.destination.url) && e.cancelable) { e.preventDefault(); block('navigate', e.destination.url); }
    });
  }
}

const SOURCE = `(${guard.toString()})();`;

/** מתקין את המגן בכל מסמך חדש (CDP). לקרוא לפני הניווט הראשון לכתובת האפליקציה. */
async function installExternalGuard(call) {
  await call('Page.addScriptToEvaluateOnNewDocument', { source: SOURCE });
}

/** מרים את המגן לסכמות מוצהרות (למסמך הנוכחי ולכל מסמך עתידי של העמוד) */
async function allowExternalSchemes(call, schemes) {
  const list = JSON.stringify(schemes.map((s) => String(s).toLowerCase().replace(/:$/, '')));
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__tgAllowedSchemes = ${list};` });
  await call('Runtime.evaluate', { expression: `window.__tgAllowedSchemes = ${list}; true`, returnByValue: true });
}

module.exports = { installExternalGuard, allowExternalSchemes, SOURCE };

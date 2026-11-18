/* ---------- תקציב ציור: מי מצייר עכשיו, ומי מחזיק הקשר WebGL (לכל היותר 8) ---------- */
// ציור הוא החלק היקר של טרמינל. פאן שלא רואים (אריח בתצוגה מוגדלת, טרמינל של זוג סוכנים שממתין) לא מצייר בכלל:
// ה-host שלו מוסתר (xterm משהה ציור כשהוא מוסתר), הפלט ממשיך להיכנס למאגר, וההקשר של WebGL משתחרר.
// כשהפאן חוזר להיראות מציירים אותו מחדש מהמאגר (refresh), ולכן שום תוכן לא הולך לאיבוד.
// הדפדפן מגביל את מספר הקשרי WebGL בעמוד (כ-16, ומעבר לזה הוא משחרר ישנים בלי להודיע), ולכן מחזיקים לכל היותר max:
// מי שהמיקוד אצלו הכי חדש מקבל, והשאר חוזרים בשקט לציור DOM רגיל (איטי יותר אבל נכון).
// נקרא "מאגר" כי כל הפאנים חולקים אותו; הלוגיקה לא תלויה בדפדפן, והתוסף מוזרק (נבדק ב-tests/unit/renderer-pool.js).

export const MAX_WEBGL = 8;
const SCROLL_GUARD_MS = 3000;

export function createRendererPool({ max = MAX_WEBGL, createAddon, raf = (f) => requestAnimationFrame(f) }) {
  const holders = new Set(); // פאנים שמחזיקים הקשר WebGL

  const redraw = (p) => raf(() => { try { p.term.refresh(0, p.term.rows - 1); } catch { /* הפאן נסגר */ } });

  // host מוסתר מאפס את אזור הגלילה של xterm, ובחזרה (כשהציור מתחדש, מאוחר יותר מהפריים הראשון) המסך קופץ לראש ההיסטוריה
  // והפלט החדש כבר לא גולל אותו למטה. לכן מחזירים את המיקום (למטה, או השורה שהייתה), ושומרים על זה כמה שניות: אם הקפיצה לראש מגיעה
  // אחרי ההחזרה, תופסים אותה (onScroll) ומחזירים שוב. רק הקפיצה לשורה 0 נתפסת, כך שגלילה של המשתמש לא נדחקת.
  const restoreScroll = (p) => raf(() => {
    try {
      const t = p.term;
      const apply = () => { if (p.atBottom === false) t.scrollToLine(p.viewY); else t.scrollToBottom(); };
      apply();
      const guard = t.onScroll(() => { const b = t.buffer.active; if (b.viewportY === 0 && b.baseY > 0 && (p.atBottom !== false || p.viewY > 0)) apply(); });
      setTimeout(() => { try { guard.dispose(); } catch { /* הפאן נסגר */ } }, SCROLL_GUARD_MS);
    } catch { /* הפאן נסגר */ }
  });

  function release(p) {
    if (!p.webgl) return;
    holders.delete(p);
    const addon = p.webgl;
    p.webgl = null;
    try { addon.dispose(); } catch { /* כבר שוחרר */ }
  }

  // מנסה להעניק לפאן הקשר WebGL. כשהתקציב מלא לוקחים ממי שהמיקוד אצלו הכי ישן, ורק אם הוא ישן יותר ממי שמבקש
  function acquire(p) {
    if (p.webgl) return true;
    if (holders.size >= max) {
      let victim = null;
      // קודם מי שמוסתר (לשונית אחרת, שהשארנו לו את ההקשר כדי שהחזרה אליו תהיה מיידית), ואז הישן ביותר
      for (const q of holders) if (!q.rendering && (!victim || (q.focusedAt || 0) < (victim.focusedAt || 0))) victim = q;
      if (!victim) {
        for (const q of holders) if (!victim || (q.focusedAt || 0) < (victim.focusedAt || 0)) victim = q;
        if (!victim || (victim.focusedAt || 0) >= (p.focusedAt || 0)) return false;
      }
      release(victim);
      redraw(victim);
    }
    try {
      const addon = createAddon();
      addon.onContextLoss(() => release(p)); // הדפדפן לקח את ההקשר: חוזרים לציור DOM
      p.term.loadAddon(addon);
      p.webgl = addon;
      holders.add(p);
      return true;
    } catch { return false; } // אין WebGL (כרטיס מסך, מדיניות): ציור DOM
  }

  // הפאן נראה (on) או לא. מחזיר true כשהמצב השתנה, כדי שהקורא ימדוד ויתאים גודל מחדש
  // keep: הפאן מוסתר רק כי עברו ללשונית אחרת. משאירים לו את הקשר ה-WebGL (יצירת הקשר חדש היא מה שהאט את החזרה ללשונית);
  // אם התקציב נגמר, acquire לוקח קודם הקשרים של פאנים מוסתרים
  function setRendering(p, on, keep = false) {
    if (p.rendering === on) return false;
    p.rendering = on;
    p.host.style.display = on ? '' : 'none';
    if (!on) {
      try { const b = p.term.buffer.active; p.viewY = b.viewportY; p.atBottom = b.viewportY >= b.baseY; } catch { /* אין מאגר */ }
      if (!keep) release(p);
      return true;
    }
    p.lastVW = 0; // כשהיה מוסתר אי אפשר היה למדוד אותו: התאמת הגודל תרוץ מחדש
    acquire(p);
    redraw(p);
    restoreScroll(p);
    return true;
  }

  // המיקוד עבר לפאן שנראה אבל מצייר ב-DOM: אולי מגיע לו הקשר WebGL
  function promote(p) {
    if (p.rendering && !p.webgl && acquire(p)) redraw(p);
  }

  return { acquire, release, setRendering, promote, count: () => holders.size, max };
}

// המאגר של האפליקציה (WebglAddon הוא סקריפט גלובלי שנטען ב-index.html)
export const pool = createRendererPool({ createAddon: () => new WebglAddon.WebglAddon() });
export const webglCount = () => pool.count();

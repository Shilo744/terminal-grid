/*
 * רגישות הגלילה (T70): כמה שורות זזות בגלגלת, יחסית לגודל הפאן ולא מספר קבוע.
 *  - קליק של גלגלת עכבר (deltaMode שורות, או פיקסלים בגודל 50 ומעלה, בדרך כלל 100): כ-12% מהשורות הנראות בפאן הזה, לפחות 3 ולכל היותר 12, לכל קליק.
 *  - משטח מגע וגלגלת בחדות גבוהה (פיקסלים קטנים): המרחק האמיתי בפיקסלים מומר לשורות, עם שארית שנצברת בין אירועים (חלק, בלי קפיצות).
 *  - Alt מכפיל ב-5 (מהר). Ctrl (זום) ותוכנית שמקשיבה לעכבר או מסך חלופי: לא נוגעים, xterm מטפל.
 * פונקציה טהורה (נבדקת ב-tests/unit/wheel.js); החיבור לטרמינל ב-wireWheel.
 */
export const NOTCH_SHARE = 0.12;
export const NOTCH_MIN = 3;
export const NOTCH_MAX = 12;
export const FAST = 5;
const NOTCH_PX = 100; // קליק אחד של גלגלת בדפדפן, בפיקסלים
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/** שורות לקליק אחד של גלגלת בפאן עם rows שורות נראות */
export const linesPerNotch = (rows) => clamp(Math.round(rows * NOTCH_SHARE), NOTCH_MIN, NOTCH_MAX);

/**
 * @param {{deltaY:number, deltaMode:number, altKey:boolean}} e
 * @param {{rows:number, cellH:number, carry:number}} s  cellH בפיקסלים של המסך; carry = שארית בשורות מהאירוע הקודם
 * @returns {{lines:number, carry:number, notch:boolean}} lines שלם (חיובי = למטה)
 */
export function wheelLines(e, s) {
  const fast = e.altKey ? FAST : 1;
  const notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50;
  if (notch) {
    const clicks = e.deltaMode === 1 ? Math.max(1, Math.round(Math.abs(e.deltaY) / 3)) : Math.max(1, Math.round(Math.abs(e.deltaY) / NOTCH_PX));
    return { lines: Math.sign(e.deltaY) * clicks * linesPerNotch(s.rows) * fast, carry: 0, notch: true };
  }
  const exact = (e.deltaY / s.cellH) * fast + (Math.sign(s.carry) === Math.sign(e.deltaY) ? s.carry : 0);
  const lines = Math.trunc(exact);
  return { lines, carry: exact - lines, notch: false };
}

/** מחבר את הרגישות לטרמינל: מאזין בשלב הלכידה על ה-host, ורק כשאין תוכנית שמקשיבה לעכבר ולא מסך חלופי */
export function wireWheel(term, host) {
  let carry = 0, lastAt = 0;
  host.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey || e.deltaY === 0) return;
    const buf = term.buffer.active;
    if (buf.type !== 'normal' || (term.modes && term.modes.mouseTrackingMode && term.modes.mouseTrackingMode !== 'none')) return;
    const screen = host.querySelector('.xterm-screen');
    if (!screen) return;
    const cellH = screen.getBoundingClientRect().height / term.rows;
    if (!cellH) return;
    const now = performance.now();
    if (now - lastAt > 250) carry = 0; // הפסקה: שארית ישנה לא נגררת לגלילה חדשה
    lastAt = now;
    const r = wheelLines(e, { rows: term.rows, cellH, carry });
    carry = r.carry;
    e.preventDefault();
    e.stopPropagation();
    if (r.lines) term.scrollLines(r.lines);
  }, { capture: true, passive: false });
}

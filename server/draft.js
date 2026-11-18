'use strict';
/*
 * טיוטה של המשתמש בתיבת הקלט של סוכן (T62): ידיעה אם יש בתיבה הודעה שעוד לא נשלחה, כדי שהוראת wake של זוג לא תתערבב איתה ולא תשלח אותה לפני הזמן.
 * שני מקורות:
 *  1. צל של הקשות האדם (createDraft): כל מה שמגיע מהדפדפן דרך הודעת input. תווים והדבקות מגדילים, Backspace מקטין, Enter / Ctrl+C / Ctrl+U / Esc כפול מנקים,
 *     Esc+Enter (שורה חדשה, T54) הוא עוד תו בטיוטה, ורצפי escape (חצים, דיווחי מיקוד ועכבר, תשובות מכשיר) לא נספרים ולא נחשבים הקלדה.
 *     הצל מקורב: Ctrl+W, חצים ועריכה באמצע השורה לא ידועים לו, ולכן מקור 2 גובר כשהוא קריא.
 *  2. אמת מהמסך (screenState): תיבת הקלט של Claude Code היא בין שני קווי ─ ; שורתה הראשונה מתחילה ב-❯ ; הטקסט הדהוי (SGR 2) הוא ההצעה ("Try ...") ולא טיוטה.
 *     "› stashed" בשורת התחתית אומר שהטיוטה הוזזה הצידה ב-Ctrl+S (נבדק מול Claude Code v2.1.301: נשמרת כולל [Pasted text #N], וחוזרת לבד בשליחה הבאה).
 *     כשהמסך לא נראה כמו תיבת קלט (תפריט, בקשת הרשאה, טרמינל רגיל) found=false וחוזרים לצל.
 * כל זה רץ בשרת בלבד; שום דבר מזה לא נשלח לסוכן.
 */

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

function createDraft() {
  let len = 0;          // כמה תווים (נקודות קוד) בטיוטה לפי ההקשות; שורה חדשה נספרת כתו
  let inPaste = false;
  let lastAt = 0;       // מתי נגעו בטיוטה לאחרונה (לבדיקת "הכתיבה נעצרה")
  return {
    /** מעדכן לפי מה שהמשתמש שלח. מחזיר true אם בחבילה היה קלט של אדם (תו, מחיקה, Enter, הדבקה), ולא רק דיווחי מערכת. */
    feed(data, now = Date.now()) {
      let human = false;
      const s = String(data);
      let i = 0;
      while (i < s.length) {
        if (s.startsWith(PASTE_START, i)) { inPaste = true; human = true; i += PASTE_START.length; continue; }
        if (s.startsWith(PASTE_END, i)) { inPaste = false; i += PASTE_END.length; continue; }
        const c = s.codePointAt(i);
        const w = c > 0xffff ? 2 : 1;
        if (inPaste) { len += 1; human = true; i += w; continue; }
        if (c === 0x1b) {
          const n = s[i + 1];
          if (n === '\r') { if (len > 0) len += 1; human = true; i += 2; continue; }   // Shift+Enter: שורה חדשה בתוך הטיוטה
          if (n === '\x1b') { len = 0; human = true; i += 2; continue; }               // Esc כפול מנקה את התיבה
          if (n === '[' || n === 'O') {                                              // רצף בקרה: חצים, מיקוד (I/O), עכבר, תשובות מכשיר. לא הקלדה
            let j = i + 2;
            while (j < s.length && !(s.charCodeAt(j) >= 0x40 && s.charCodeAt(j) <= 0x7e)) j++;
            i = j + 1;
            continue;
          }
          i += n === undefined ? 1 : 2;                                              // Alt+מקש, או Esc בודד בסוף חבילה
          continue;
        }
        if (c === 0x0d) { len = 0; human = true; i += w; continue; }                  // Enter: ההודעה נשלחה
        if (c === 0x03 || c === 0x15) { len = 0; human = true; i += w; continue; }    // Ctrl+C / Ctrl+U מנקים
        if (c === 0x7f || c === 0x08) { len = Math.max(0, len - 1); human = true; i += w; continue; }
        if (c < 0x20) { human = true; i += w; continue; }                             // בקרות אחרות (Tab, Ctrl+S ...): הקלדה, אבל לא משנות את הטיוטה
        len += 1; human = true; i += w;
      }
      if (human) lastAt = now;
      return human;
    },
    clear() { len = 0; inPaste = false; },
    get active() { return len > 0; },
    get length() { return len; },
    get lastAt() { return lastAt; },
  };
}

const RULE = /^[─━-]{8,}\s*$/;

/**
 * קורא את המסך הנראה של טרמינל (xterm headless) ומחזיר { found, draft, stashed }.
 * found=false כשלא נראית תיבת קלט של Claude. draft=true כשיש בתיבה טקסט לא דהוי.
 */
function screenState(term) {
  try {
    const b = term.buffer.active;
    const top = b.baseY;
    const rows = [];
    for (let y = 0; y < term.rows; y++) { const l = b.getLine(top + y); rows.push(l ? l.translateToString(true) : ''); }
    let r2 = -1;
    for (let i = rows.length - 1; i >= 0; i--) if (RULE.test(rows[i])) { r2 = i; break; }
    if (r2 < 1) return { found: false };
    let r1 = -1;
    for (let i = r2 - 1; i >= 0; i--) if (RULE.test(rows[i])) { r1 = i; break; }
    if (r1 < 0 || r2 - r1 < 2) return { found: false };
    if (!/^\s*(❯|>|›)/.test(rows[r1 + 1])) return { found: false };
    let draft = false;
    for (let i = r1 + 1; i < r2 && !draft; i++) {
      const line = b.getLine(top + i);
      if (!line) continue;
      for (let x = 2; x < term.cols; x++) {
        const cell = line.getCell(x);
        if (!cell) break;
        const ch = cell.getChars();
        if (ch && ch.trim() && !cell.isDim()) { draft = true; break; }
      }
    }
    const footer = rows.slice(r2 + 1).join(' ');
    return { found: true, draft, stashed: /stashed/.test(footer) };
  } catch { return { found: false }; }
}

module.exports = { createDraft, screenState };

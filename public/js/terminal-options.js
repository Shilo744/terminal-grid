/* ---------- אפשרויות נוספות של הטרמינל: גובה שורה, צורת סמן, הבהוב והיסטוריית גלילה ---------- */
// ערכי ההתחלה של טרמינל חדש (createTerm) והחלה חיה על כל הטרמינלים הפתוחים כשההגדרה משתנה (גם מחלון אחר).
import { state } from './state.js';
import { getSetting, onSetting } from './settings.js';
import { scheduleLayout } from './layout.js';

// האפשרויות של xterm לפי ההגדרות, לטרמינל חדש
export const terminalOptions = () => ({
  lineHeight: getSetting('terminal.lineHeight'),
  cursorStyle: getSetting('terminal.cursorStyle'),
  cursorBlink: getSetting('terminal.cursorBlink'),
  scrollback: getSetting('terminal.scrollback'),
});

// הגדרה -> שם האפשרות ב-xterm. גובה שורה משנה את גודל התא, לכן הפריסה נמדדת מחדש (lastVW = 0)
const LIVE = {
  'terminal.lineHeight': { option: 'lineHeight', refit: true },
  'terminal.cursorStyle': { option: 'cursorStyle' },
  'terminal.cursorBlink': { option: 'cursorBlink' },
  'terminal.scrollback': { option: 'scrollback' },
};

export function initTerminalOptions() {
  // גרירת מחוון (גובה שורה) מייצרת עשרות שינויים בשנייה: ההחלה על כל הטרמינלים פעם אחת לפריים, עם הערך האחרון (T38)
  const queued = new Set();
  for (const [path, { option, refit }] of Object.entries(LIVE)) {
    onSetting(path, () => {
      if (queued.has(path)) return;
      queued.add(path);
      requestAnimationFrame(() => {
        queued.delete(path);
        const value = getSetting(path);
        for (const p of state.panes.values()) {
          p.term.options[option] = value;
          if (refit) p.lastVW = 0;
        }
        if (refit) scheduleLayout();
      });
    });
  }
}

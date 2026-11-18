/* ---------- מסוף xterm של פאן אחד: יצירה, והעתקה/הדבקה ---------- */
// xterm והתוספים שלו נטענים כסקריפטים רגילים ב-index.html ומגדירים משתנים גלובליים:
// Terminal, FitAddon, WebLinksAddon, Unicode11Addon (ו-WebglAddon, שמשמש את renderer-pool.js).
import { THEME } from './constants.js';
import { getSetting } from './settings.js';
import { fontStack } from './fonts.js';
import { terminalOptions } from './terminal-options.js';
import { state, bus } from './state.js';
import { imagesIn, attachImages, wireImageDrop, shouldFileText, attachText, markPlainPaste, isPlainPaste, dropImages } from './image-attach.js';
import { paneLinks } from './links.js';
import { selectionText } from './hebrew-copy.js';
import { handleInputKey } from './input-select.js';
import { wireWheel } from './wheel.js';

// יוצר את הטרמינל עם התוספים, פותח אותו בתוך host ומצייר את התמונה השמורה מהשרת (אם יש). ללא WebGL: הוא מגיע מהמאגר, רק לפאן שנראה
// גלילה בגלגלת/משטח מגע מונפשת (T52). האנימציה של xterm חלה גם על גלילה מתוכנתת (הצמדה לתחתית עם פלט חדש, החזרת מיקום אחרי החלפת מרנדר), והיא האטה אותן,
// לכן היא דולקת רק בזמן שהגלגלת בשימוש ונכבית SMOOTH_IDLE_MS אחרי האירוע האחרון
export const SMOOTH_SCROLL_MS = 100;
export const SMOOTH_IDLE_MS = 500;
export function createTerm(meta, host, snapshot) {
  const links = paneLinks(() => host.closest('.pane')); // T47: קישורים רק ב-Ctrl+לחיצה, ורק web נפתח
  const term = new Terminal({
    cols: meta.cols, rows: meta.rows,
    fontFamily: fontStack(), fontSize: getSetting('terminal.fontSize'), letterSpacing: 0,
    ...terminalOptions(), allowProposedApi: true,
    theme: THEME,
    linkHandler: links.handler,
    ...(/Win/i.test(navigator.platform || navigator.userAgent || '') ? { windowsPty: { backend: 'conpty', buildNumber: 22621 } } : {}), // רק ב-Windows (ConPTY); ב-Mac/Linux הטרמינל אמיתי ואין התאמות
    rightClickSelectsWord: false, // קליק ימני לא נוגע בבחירה (T57)
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  try { term.loadAddon(new WebLinksAddon.WebLinksAddon(links.webActivate, links.webOptions)); } catch { /* optional */ }
  try {
    term.loadAddon(new Unicode11Addon.Unicode11Addon());
    term.unicode.activeVersion = '11';
  } catch { /* optional */ }

  term.open(host);
  let smoothOff = 0;
  host.addEventListener('wheel', () => {
    if (term.options.smoothScrollDuration !== SMOOTH_SCROLL_MS) term.options.smoothScrollDuration = SMOOTH_SCROLL_MS;
    clearTimeout(smoothOff);
    smoothOff = setTimeout(() => { term.options.smoothScrollDuration = 0; }, SMOOTH_IDLE_MS);
  }, { capture: true, passive: true });
  wireWheel(term, host); // רגישות גלגלת יחסית לגודל הפאן (T70)
  // ציור WebGL (תווי מסגרת ובלוקים בלי רווחים, כמו Windows Terminal) מוענק ונלקח ב-renderer-pool.js לפי מה שנראה עכשיו
  if (snapshot) term.write(snapshot);
  return { term, fit };
}

// העתקה והדבקה כמו ב-Windows Terminal
// שורה חדשה בלי שליחה (T54): Claude Code מבין ESC+CR (כמו Alt+Enter, מה ש-/terminal-setup שלו מגדיר בטרמינלים אחרים) כ"שורה חדשה". Enter רגיל שולח כרגיל.
export const NEWLINE_SEQ = String.fromCharCode(27, 13);
const IS_WIN = /Win/i.test(navigator.platform || navigator.userAgent || '');
// Shift+Enter (לחיצה ושחרור) בפורמט win32-input-mode של ConPTY: Vk=13, Sc=28, Uc=13, Kd=1/0, Cs=16 (Shift), Rc=1
export const SHIFT_ENTER_WIN32 = '\x1b[13;28;13;1;16;1_\x1b[13;28;13;0;16;1_';

export function wireClipboard(term, host, meta) {
  // Ctrl+C מעתיק כשיש בחירה (אחרת נשלח כרגיל). Ctrl+V ו-Ctrl+Shift+V מדביקים כמו ב-Windows Terminal.
  // e.code (המקש הפיזי) כדי שזה יעבוד גם כשמקלדת עברית פעילה.
  term.attachCustomKeyEventHandler((e) => {
    // Ctrl+A בתיבת ההקלדה של Claude בוחר את מה שהוקלד, ואז Ctrl+C/X, Backspace/Delete וכו' פועלים עליו (T63). לא נוגע בפאנים אחרים
    if (meta.kind === 'claude') { const handled = handleInputKey(term, meta, e, { onWipe: (nums) => dropImages(state.panes.get(meta.id), nums) }); if (handled !== undefined) return handled; }
    // Shift+Enter בפאן של Claude (רשת, אריחים, סוכני זוג): שורה חדשה בתיבת הקלט. e.key ולא e.code, כדי שיעבוד בכל פריסת מקלדת; קלט IME לא נוגעים בו.
    // false בלי לשלוח את ה-CR  הרגיל, גם לאירוע ה-keypress שבא אחרי ה-keydown, כדי שלא יישלח פעמיים; preventDefault מונע שורה חדשה בתיבת הטקסט הנסתרת של xterm
    if (meta.kind === 'claude' && e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing) {
      if (e.type === 'keydown') { e.preventDefault(); term.input(NEWLINE_SEQ); }
      return false;
    }
    // אותו Shift+Enter בטרמינל רגיל (PowerShell): שורה חדשה בעריכה (">>"), לא הרצה. ConPTY מבין רק את הצורה של win32-input-mode (נבדק מול PowerShell אמיתי);
    // ב-Mac/Linux אין לפקודה הזאת מקבילה אחידה ב-bash/zsh, לכן שם Enter רגיל נשאר
    if (meta.kind !== 'claude' && IS_WIN && e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing) {
      if (e.type === 'keydown') { e.preventDefault(); term.input(SHIFT_ENTER_WIN32); }
      return false;
    }
    if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey)) return true;
    const key = e.key.toLowerCase();
    if ((key === 'c' || e.code === 'KeyC') && (e.shiftKey || term.hasSelection())) {
      if (term.hasSelection()) { navigator.clipboard.writeText(selectionText(term, meta.kind)).catch(() => {}); term.clearSelection(); }
      return false;
    }
    // מחזירים false בלי לבטל את הפעולה: הדפדפן מפעיל הדבקה רגילה (אירוע paste ש-xterm מטפל בו),
    // בלי לשלוח ^V לתוכנית ובלי לבקש הרשאה לקרוא את הלוח
    if ((key === 'v' || e.code === 'KeyV') && !e.altKey) { if (e.shiftKey) markPlainPaste(); return false; } // Ctrl+Shift+V: הטקסט עצמו, בלי שמירה כקובץ (T53)
    return true;
  });
  // Ctrl+V כשבלוח יש תמונה (צילום מסך, או קובץ תמונה שהועתק בסייר): הדפדפן קורא אותה מאירוע ההדבקה, השרת שומר קובץ זמני, והנתיב מודבק לטרמינל (T45):
  // מיידי, בלי ש-Claude יפעיל PowerShell כדי לקרוא את הלוח (המסלול הישן, Alt+V, נשאר רק כגיבוי כשההעלאה נכשלת). טקסט בלוח גובר: הדבקה רגילה.
  host.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (text) {
      if (meta.kind !== 'claude') return; // טקסט בטרמינל רגיל: הדבקה רגילה (הפניה לקובץ היא רק של Claude)
      // טקסט ארוך בטרמינל של Claude (T53): נשמר כקובץ ומודבקת שורת הפניה אחת. קצר, או Ctrl+Shift+V: הדבקה רגילה (מסוגרת)
      if (isPlainPaste() || !shouldFileText(text)) return;
      e.preventDefault();
      e.stopPropagation();
      attachText(term, meta, text);
      return;
    }
    const files = imagesIn(cd);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    attachImages(term, meta, files, { viaPaste: true });
  }, true);
  wireImageDrop(host.closest('.pane'), term, meta); // גרירת קבצי תמונה על הפאן: אותו מסלול
  // קליק ימני (T57): התפריט שלנו, לעולם לא הדבקה ולא נוגע בלוח או בבחירה (להדבקה: Ctrl+V או גרירה). אם התוכנית מקשיבה לעכבר (mouse reporting), הקליק שלה; Shift+קליק ימני פותח את התפריט (כמו בטרמינלים אחרים)
  host.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (term.modes && term.modes.mouseTrackingMode && term.modes.mouseTrackingMode !== 'none' && !e.shiftKey) return;
    const pane = state.panes.get(host.closest('.pane').dataset.id);
    if (pane) bus.emit('pane-menu', pane, { point: { x: e.clientX, y: e.clientY }, terminal: true });
  });
}

/* ---------- קיצורי מקלדת ומיקוד החלון ---------- */
import { state, bus } from './state.js';
import { activate, focusTerm, setFocus } from './layout.js';
import { switchRelative, switchToNumber } from './tabs.js';
import { focusNextWaiting } from './attention.js';
import { toast } from './toast.js';

export function initShortcuts() {
  // Ctrl + A כשהמיקוד לא בטרמינל ולא בשדה טקסט (למשל אחרי לחיצה על לשונית או כפתור): הדפדפן היה בוחר את כל הדף והמקלדת הייתה "מתה" (ההקלדה הלכה ללשונית ולא ל-Claude),
  // וזה מה שהמשתמש חווה כ"אחרי Ctrl+A שורת ההקלדה לא עובדת" (T75, נמדד עם Claude אמיתי: 102 תווים נבחרו בדף והמקש הבא לא הגיע). אין שימוש לבחירת כל הדף באפליקציה הזאת:
  // מבטלים אותה ומחזירים את המיקוד לטרמינל הממוקד, כך שהמקלדת חיה תמיד.
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && (e.code === 'KeyA' || e.key === 'a' || e.key === 'A'))) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable], .xterm')) return;
    e.preventDefault(); e.stopPropagation();
    try { getSelection().removeAllRanges(); } catch { /* ignore */ }
    const id = state.focusId && state.panes.has(state.focusId) ? state.focusId : state.order[0]; // אין ממוקד (למשל אחרי סגירה): הראשון בלשונית
    if (id) { if (id === state.focusId) focusTerm(id); else setFocus(id); }
  }, true);
  // Ctrl + ,: הגדרות (גם כשהמיקוד בטרמינל; e.code כדי שיעבוד גם במקלדת עברית). הפאנל מאזין לאירוע
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && (e.code === 'Comma' || e.key === ',')) {
      e.preventDefault(); e.stopPropagation(); bus.emit('open-settings');
    }
  }, true);
  // Alt + 1…9: מעבר מהיר בין טרמינלים (בשלב הלכידה, כדי שהטרמינל לא יקבל את המקש)
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
      const id = state.order[Number(e.key) - 1];
      if (id) { e.preventDefault(); e.stopPropagation(); activate(id); }
    }
  }, true);
  // Ctrl + Alt + ←/→: הלשונית הקודמת/הבאה, Ctrl + Alt + 1…9: לשונית מספר N (T60). e.code כדי שיעבוד גם במקלדת עברית; חץ ימינה = הבאה בעברית (השורה מימין לשמאל)
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey)) return;
    let done = false;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
      done = switchRelative((e.code === 'ArrowLeft') === rtl ? 1 : -1);
    } else if (/^Digit[1-9]$/.test(e.code)) done = switchToNumber(Number(e.code.slice(5)));
    else return;
    e.preventDefault(); e.stopPropagation();
    if (!done) toast('אין לשונית כזאת');
  }, true);
  // Alt + W: הטרמינל הבא שממתין לך (הדחוף ראשון). לא תפוס ב-Chrome, ב-Claude Code (Alt+P/T/V/Enter) ולא ב-PSReadLine; e.code כדי שיעבוד גם במקלדת עברית
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyW') {
      e.preventDefault(); e.stopPropagation();
      if (!focusNextWaiting()) toast('אין טרמינל שממתין לך');
    }
  }, true);
  // חזרה לחלון: הטרמינל הממוקד מקבל מיקוד והסימון "ממתין לך" נמחק
  window.addEventListener('focus', () => { const p = state.panes.get(state.focusId); if (p) { p.waiting = false; p.dirty = false; focusTerm(p.id); } });
}

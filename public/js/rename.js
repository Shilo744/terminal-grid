/* ---------- שינוי שם במקום (T56, T71): אותה התנהגות בכל משטח שיש לו שם (לשונית זוג, כותרת הלוח, פריט בתפריט הצד, פרויקט) ---------- */
// שדה טקסט צף מעל מקום השם, ולא בתוך הלשונית או הכפתור: אלה נבנים מחדש בכל עדכון ובתוך כפתור אי אפשר להקליד.
// Enter שומר, Esc מבטל, יציאה מהשדה שומרת, שם ריק או זהה = בלי שינוי, עד NAME_MAX תווים, עברית ו-RTL לפי התוכן (dir="auto").
// (כותרת הטרמינל עצמה נערכת במקום, ב-pane-actions.js, באותם כללים.)
export const NAME_MAX = 60;

// בזמן שהשדה פתוח הרכיבים שבונים מחדש את האלמנט (שורת הלשוניות, תפריט הצד) מחכים: אחרת האלמנט שהשדה יושב עליו נעלם באמצע ההקלדה
let editing = 0;
const waiting = new Set();
export const isRenaming = () => editing > 0;
/** מריץ fn כשהעריכה נגמרת (בלי כפילויות): ככה בנייה מחדש שנדחתה קורית אחרי הסגירה */
export const afterRename = (fn) => { waiting.add(fn); };

/**
 * שדה העריכה יושב בדיוק על מקום השם (אותו מלבן, גופן, גובה וכיוון), בלי מסגרת צפה: רקע קל וקו תחתון בצבע ההדגשה. הרוחב גדל עם הטקסט עד קצה הלשונית/השורה
 * (בעברית מהצד הימני). Enter שומר, Esc מבטל, יציאה מהשדה שומרת.
 * @returns {HTMLInputElement|null} השדה (נסגר לבד); onCommit(value) נקרא רק כשיש שם חדש. find() מחזיר את אלמנט השם החי אם זה שהועבר כבר נבנה מחדש
 */
export function overlayRename(anchor, { value, onCommit, onEnd, find }) {
  // הלחיצה הראשונה של לחיצה כפולה בונה מחדש את הלשונית/השורה, ולכן האלמנט שהמאזין החזיק כבר מנותק (מלבן ריק: זו הסיבה לשדה "הצף בצד" שדווח). מוצאים את החי לפי מפתח
  if (!anchor.isConnected && find) anchor = find() || anchor;
  if (!anchor.isConnected) return null;
  const r = anchor.getBoundingClientRect();
  const cs = getComputedStyle(anchor);
  const box = anchor.closest('.duo-tab, .gtab, .grp-head, .duo-item, .db-title') || anchor.parentElement;
  const limit = box ? box.getBoundingClientRect() : r;
  const rtl = getComputedStyle(anchor).direction === 'rtl';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'rename-input';
  inp.value = value;
  inp.maxLength = NAME_MAX;
  inp.dir = 'auto';
  inp.setAttribute('aria-label', 'שם חדש');
  Object.assign(inp.style, { font: cs.font, letterSpacing: cs.letterSpacing, lineHeight: r.height + 'px', height: r.height + 'px', top: r.top + 'px' });
  const meas = document.createElement('span');
  meas.style.cssText = 'position:fixed;visibility:hidden;white-space:pre;left:-9999px;top:0';
  meas.style.font = cs.font;
  meas.style.letterSpacing = cs.letterSpacing;
  document.body.appendChild(meas);
  const place = () => {
    meas.textContent = inp.value || ' ';
    const want = Math.ceil(meas.getBoundingClientRect().width) + 1; // הרוחב ההתחלתי הוא של השם עצמו; גדל רק כשהטקסט החדש ארוך ממנו
    const room = rtl ? r.right - limit.left : limit.right - r.left;
    const w = Math.max(r.width, Math.min(want, Math.max(r.width, room)));
    inp.style.width = w + 'px';
    inp.style.left = (rtl ? r.right - w : r.left) + 'px';
  };
  place();
  document.body.appendChild(inp);
  editing++;
  inp.focus();
  inp.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const v = inp.value.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    inp.remove();
    meas.remove();
    editing--;
    if (commit && v && v !== value) onCommit(v);
    if (onEnd) onEnd();
    if (!editing) { const fns = [...waiting]; waiting.clear(); for (const fn of fns) { try { fn(); } catch { /* ignore */ } } }
  };
  inp.addEventListener('input', place);
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation(); // לא מגיע לקיצורי המקלדת של האפליקציה (Alt+1..9, F2 וכו')
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
  return inp;
}

/** F2 (בלי Ctrl/Alt/Shift/Meta), כשהמיקוד לא בטרמינל, בשדה טקסט או בכתיבה במקום */
export function isRenameKey(e) {
  if (e.key !== 'F2' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
  const a = document.activeElement;
  return !(a && a.closest && a.closest('input, textarea, [contenteditable], .xterm'));
}

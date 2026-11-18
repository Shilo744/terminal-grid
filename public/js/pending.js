/* ---------- משוב מיידי (T38): כל לחיצה שממתינה לשרת משנה את הממשק תוך 100ms ---------- */
// addPending(reqId, label): כרטיס "פותח את <label>…" בגריד, מיד בלחיצה. הוא מוחלף בטרמינל האמיתי כשהשרת עונה ('created' עם אותו reqId),
// ונעלם עם הודעה אם השרת עונה בשגיאה (launch.js) או לא עונה 10 שניות.
// busy(btn, text, timeoutMessage): כפתור שממתין לשרת (למשל "הפעלה מחדש") מקבל ספינר וטקסט, וחוזר לעצמו בשגיאה או אחרי 10 שניות.
// הכרטיסים הם חלק מהחלוקה בגריד (layout.js קורא את state.pending), אבל אינם טרמינלים: אין להם מצב, סדר או שמירה.
import { state } from './state.js';
import { stage } from './dom.js';
import { toast } from './toast.js';
import { scheduleLayout } from './layout.js';

export const PENDING_MS = 10000;

export function addPending(reqId, label) {
  const el = document.createElement('div');
  el.className = 'pending-card';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span class="spin lg" aria-hidden="true"></span><span class="pc-text" dir="auto"></span>';
  el.querySelector('.pc-text').textContent = `פותח את ${label}…`;
  stage.appendChild(el);
  const timer = setTimeout(() => {
    if (!removePending(reqId)) return;
    toast(`לא הצלחנו לפתוח את ${label}: השרת לא ענה`, 'error');
  }, PENDING_MS);
  state.pending.set(reqId, { el, label, timer });
  scheduleLayout();
}

// מסיר את הכרטיס (הטרמינל האמיתי הגיע, או שנכשל). מחזיר true אם הוא היה קיים
export function removePending(reqId) {
  const q = state.pending.get(reqId);
  if (!q) return false;
  clearTimeout(q.timer);
  q.el.remove();
  state.pending.delete(reqId);
  scheduleLayout();
  return true;
}

// חיבור מחדש ורשימה מלאה מהשרת: מה שחיכה כבר לא רלוונטי (הטרמינל החדש, אם נוצר, כבר ברשימה)
export function clearPending() {
  for (const id of [...state.pending.keys()]) removePending(id);
}

const busies = new Set();

export function busy(btn, text, timeoutMessage) {
  const html = btn.innerHTML, wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = '<span class="spin" aria-hidden="true"></span><span></span>';
  btn.lastChild.textContent = text;
  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    busies.delete(restore);
    if (!btn.isConnected) return;
    btn.disabled = wasDisabled;
    btn.removeAttribute('aria-busy');
    btn.innerHTML = html;
  };
  const timer = setTimeout(() => { restore(); if (timeoutMessage) toast(timeoutMessage, 'error'); }, PENDING_MS);
  busies.add(restore);
  return restore;
}

// השרת ענה בשגיאה על בקשה בלי reqId (למשל הפעלה מחדש): כל הכפתורים הממתינים חוזרים לעצמם
export function restoreAllBusy() {
  for (const r of [...busies]) r();
}

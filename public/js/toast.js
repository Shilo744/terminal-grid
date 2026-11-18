/* ---------- הודעות קצרות בפינה ---------- */
import { $ } from './dom.js';
import { icon } from './icons.js';

// opts.action = { label, onClick }: כפתור בהודעה (נשארת עד opts.ms, ברירת מחדל 4.2 שניות; עם כפתור כדאי יותר); opts.ms = כמה זמן להציג
export function toast(message, kind = 'info', opts = {}) {
  // לחיצות חוזרות לא מערימות את אותה הודעה שוב ושוב
  for (const old of document.querySelectorAll('#toasts .toast')) if (old.querySelector('.toast-text').textContent === message) old.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'error' ? ' error' : '');
  // אייקון עגול בתחילת ההודעה לפי הסוג (בלי פס צבע בצד): מידע / שגיאה
  const ic = document.createElement('span');
  ic.className = 'toast-ic';
  ic.setAttribute('aria-hidden', 'true');
  ic.innerHTML = icon(kind === 'error' ? 'alert' : 'info', 14);
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  el.append(ic, text);
  if (opts.action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = opts.action.label;
    b.addEventListener('click', () => { el.remove(); opts.action.onClick(); });
    el.append(b);
  }
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), opts.ms || 4200);
}

/* ---------- קבוצת "סוכני Claude" בהגדרות: הערה חיה על טרמינלים קיימים, והסבר "מה זה ומה מומלץ?" ---------- */
// העובדות כאן מהתיעוד של Claude Code (נבדקו ב-2026-10-16): דחיסה אוטומטית כברירת מחדל קרוב לגבול ההקשר של המודל
// (חלון של 200K טוקנים במודלים בלי הקשר מורחב, כ-967K במודלים עם הקשר של מיליון); CLAUDE_CODE_AUTO_COMPACT_WINDOW קובע את החלון (נגזר מחלון המודל);
// DISABLE_AUTO_COMPACT=1 מכבה דחיסה אוטומטית ו-/compact הידני ממשיך לעבוד. לא מציינים כאן מספרים או הבטחות שלא נמצאים בעובדות האלה.
import { state } from '../state.js';
import { plural } from '../util.js';
import { getSetting, onSetting } from '../settings.js';
import { onMessage } from '../connection.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// החתימה שהשרת נותן לכל טרמינל Claude בזמן ההפעלה (server/settings.js autoCompactEnv): מה שרץ עם הגדרה אחרת לא משתנה עד הפעלה מחדש
const currentSig = () => (getSetting('claude.autoCompact.mode') === 'early' ? `early:${getSetting('claude.autoCompact.window')}` : getSetting('claude.autoCompact.mode'));

function staleCount() {
  const sig = currentSig();
  let n = 0;
  for (const p of state.panes.values()) if (p.meta.kind === 'claude' && !p.meta.exited && p.meta.compact && p.meta.compact !== sig) n++;
  return n;
}

export function compactNote() {
  const box = el('div', 'st-note');
  box.append(el('div', null, 'חל על טרמינלים חדשים ועל הפעלה מחדש של שיחות. טרמינלים שכבר רצים לא משתנים.'));
  const count = el('div', 'st-note-count');
  box.append(count);
  const refresh = () => {
    const n = staleCount();
    count.hidden = n === 0;
    count.textContent = n === 0 ? '' : `${n} ${plural(n, 'טרמינל פתוח ימשיך', 'טרמינלים פתוחים ימשיכו')} עם ההגדרה הקודמת.`;
  };
  onSetting('claude.autoCompact.mode', refresh);
  onSetting('claude.autoCompact.window', refresh);
  for (const t of ['list', 'created', 'closed', 'exit']) onMessage(t, () => setTimeout(refresh, 0));
  refresh();
  return box;
}

// קטע אנגלי/נתיב בתוך טקסט עברי: מבודד, כדי שהסימנים שבו (כמו הלוכסן ב-/compact) לא יתהפכו
const ltr = (s) => String.fromCharCode(0x2066) + s + String.fromCharCode(0x2069);

const PARTS = [
  ['מה זה דחיסה?', [
    'כשהשיחה של סוכן מתארכת, ההקשר שלו (כל מה שהוא "זוכר") מתמלא. דחיסה היא כאשר Claude מסכם את השיחה כדי לפנות מקום ולהמשיך לעבוד. בדחיסה נאבדים פרטים.',
  ]],
  ['מה עושה כל מצב?', [
    'ברירת המחדל של Claude: הוא דוחס מעצמו קרוב לגבול ההקשר של המודל (חלון של 200K טוקנים במודלים בלי הקשר מורחב, וכ-967K טוקנים במודלים עם הקשר של מיליון).',
    'מוקדם יותר: הוא דוחס כשההקשר מגיע לגודל שבחרתם (הגודל לא יכול לעבור את חלון המודל).',
    `כבוי: הוא לא דוחס לבד. כשההקשר מתמלא הסוכן עוצר עם שגיאת גבול הקשר, ולכן זה מתאים רק לעבודה קצרה ומתוסרטת. דחיסה ידנית (${ltr('/compact')}) ממשיכה לעבוד.`,
  ]],
  ['מה מומלץ?', [
    'רוב האנשים משאירים את ברירת המחדל.',
    'בריצות ארוכות או לילה, במיוחד עם מודלים של מיליון טוקנים, סף מוקדם כמו 400K שומר על כל תור קטן וזול יותר ומונע דחיסה ברגע האחרון, במחיר של איבוד פרטים מוקדם יותר.',
    `אם חשוב לכם נושא מסוים, אפשר להקליד ${ltr('/compact')} עם הנחיה בטרמינל של הסוכן ולבחור בעצמכם מה לשמר.`,
  ]],
];

// הסבר מתקפל (סגור כברירת מחדל): details מקורי, נגיש מהמקלדת
export function compactHelp() {
  const d = el('details', 'st-help');
  d.append(el('summary', null, 'מה זה ומה מומלץ?'));
  for (const [title, lines] of PARTS) {
    d.append(el('h4', null, title));
    for (const l of lines) {
      const p = el('p', null, l);
      p.setAttribute('dir', 'auto');
      d.append(p);
    }
  }
  return d;
}

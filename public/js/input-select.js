/*
 * Ctrl+A בתיבת ההקלדה של Claude (T63): בוחר את מה שהקלדת, כמו בכל שדה טקסט.
 *
 * Claude Code מצייר את התיבה בעצמו ואין בה בחירה אמיתית; Ctrl+A אצלו הוא "לתחילת השורה" (readline; נבדק ב-v2.1.301). כאן, ורק בפאנים של Claude, Ctrl+A מסמן
 * בבחירה הרגילה של xterm (term.select, בלי לצייר שום דבר מעל הטרמינל) את הטקסט שבתיבה. כל עוד הוא מסומן:
 *   Ctrl+C / Ctrl+X מעתיקים את מה שהקלדת (בלי הסמן ">", בלי המסגרת, בעברית בסדר לוגי), Backspace / Delete / Ctrl+X מוחקים הכול, תו רגיל מחליף הכול,
 *   וכל מקש אחר (חצים, Home/End, Esc, Enter, קליק) רק מבטל את הסימון ופועל כרגיל.
 * אם אי אפשר לזהות את התיבה בוודאות (אין שני קווים, אין סמן, התיבה ריקה = הטקסט האפור "Try ...", אין מצב רגיל) Ctrl+A עובר ל-Claude כמו שהוא.
 *
 * מבנה התיבה (v2.1.301): קו אופקי, שורה ראשונה "❯ טקסט", שורות המשך מוזחות בשני תווים, קו אופקי, שורת מצב. בסגנון הישן: מסגרת ╭─╮ │ > טקסט │ ╰─╯.
 * מחיקה (נבדקה ב-Claude אמיתי, ראו docs/known-issues.md): הסמן יכול להיות בכל מקום, ולכן שולחים Delete (ESC [ 3 ~) כמספר התווים שאחרי הסמן ו-Backspace כמספר
 * התווים שלפניו. הספירה מוגזמת בכוונה (כל גבול שורה נספר כתו): Delete בסוף ו-Backspace בהתחלה לא עושים כלום, ולכן העודף לא מזיק. לא משתמשים בחיצים (חץ ימינה בסוף
 * התיבה עלול לקבל את ההצעה האפורה) ולא ב-Ctrl+C (הוא מנקה, אבל גם מכין את Claude ליציאה בלחיצה שנייה).
 */
import { state } from './state.js';
import { visualToLogical, isHebrewRow } from './hebrew-copy.js';

// הקו העליון של Claude האמיתי נושא תווית בקצה ("──── duo-worker ─"): קו תקין הוא רצף של קווים, ואולי תווית אחת ועוד קו קצר (T75: בלי זה התיבה האמיתית לא זוהתה בכלל)
const RULE = /^[─━═-]{12,}(?: [^─]{1,60} ─+)?$/;
const BOX_TOP = /^╭─+╮$/;
// אחרי ה-❯ של Claude האמיתי יש רווח שאינו נשבר (U+00A0), לא רווח רגיל (נמדד ב-v2.1.301): זו הייתה הסיבה שהתיבה האמיתית אף פעם לא זוהתה (T75)
const MARKER = /^(?:❯|>)[ \u00a0]/;
const SPARE = 2; // תווים נוספים בספירת המחיקה (בטוח: עודף לא עושה כלום)

/** מאתר את התיבה סביב הסמן. null כשאי אפשר בוודאות. { boxed, rows: [{ y, body, startCol }], cx, cy, empty } */
export function findInput(term) {
  const buf = term.buffer.active;
  const cur = buf.baseY + buf.cursorY;
  const text = (y) => { const l = buf.getLine(y); return l ? l.translateToString(true) : ''; };
  let top = -1, boxed = false;
  for (let y = cur; y >= Math.max(0, cur - 40); y--) {
    const t = text(y).trim();
    if (RULE.test(t) || BOX_TOP.test(t)) { top = y; boxed = BOX_TOP.test(t); break; }
  }
  if (top < 0 || top === cur) return null;
  let bot = -1;
  for (let y = cur + 1; y <= Math.min(buf.length - 1, cur + 40); y++) {
    const t = text(y).trim();
    if (boxed ? /^╰─+╯$/.test(t) : RULE.test(t)) { bot = y; break; }
  }
  if (bot < 0 || bot - top < 2 || bot - top > 42) return null;
  const startCol = boxed ? 4 : 2;
  const rows = [];
  for (let y = top + 1; y < bot; y++) {
    let t = text(y);
    if (boxed) t = t.replace(/^│ ?/, '│ ').replace(/\s*│$/, '');
    if (rows.length === 0 && !MARKER.test(boxed ? t.replace(/^│ /, '') : t)) return null; // השורה הראשונה חייבת להתחיל ב-❯ או >
    const body = t.slice(startCol).replace(/\s+$/, '');
    rows.push({ y, body, startCol });
  }
  if (!rows.length || cur < rows[0].y || cur > rows[rows.length - 1].y) return null; // הסמן לא בתוך התיבה (תפריט, שורת מצב...)
  const first = buf.getLine(rows[0].y).getCell(startCol);
  const placeholder = !!first && first.getChars() !== '' && first.isDim() !== 0; // הטקסט האפור של תיבה ריקה
  if (/^\d+\.\s/.test(rows[0].body)) return null; // רשימת אפשרויות של דיאלוג ("❯ 1. Yes"), לא תיבת הקלדה
  const empty = placeholder || rows.every((r) => r.body === '');
  return { boxed, rows, cx: buf.cursorX, cy: cur - rows[0].y, empty, cols: term.cols };
}

const width = (r) => [...r.body].length;

/** הטקסט שהוקלד, להעתקה: בלי הסמן והמסגרת, עברית בסדר לוגי, שורות שנשברו בגלל הרוחב (המילה הבאה לא הייתה נכנסת) מחוברות ברווח והשאר בירידת שורה */
export function inputText(r) {
  const out = [];
  r.rows.forEach((row, i) => {
    const t = isHebrewRow(row.body) ? visualToLogical(row.body) : row.body;
    const prev = r.rows[i - 1];
    // שבירת שורה לפי רוחב (מילה שלא נכנסה) או ירידת שורה אמיתית? אם המילה הראשונה בשורה הזאת הייתה נכנסת בסוף הקודמת, זו ירידת שורה אמיתית; אחרת זו שבירה, וההמשך מחובר ברווח
    const firstWord = ([...row.body.split(' ')[0]]).length;
    const wrapped = !!prev && prev.startCol + [...prev.body].length + 1 + firstWord > r.cols - (r.boxed ? 2 : 0);
    if (wrapped) out[out.length - 1] += ' ' + t; else out.push(t);
  });
  return out.join('\n');
}

/** כמה Delete (אחרי הסמן) וכמה Backspace (לפניו) מרוקנים את התיבה, מוגזם בכוונה */
export function deletePlan(r) {
  let b = 0, a = 0;
  r.rows.forEach((row, i) => {
    const w = width(row);
    if (i < r.cy) b += w + 1;
    else if (i > r.cy) a += w + 1;
    else { const k = Math.max(0, Math.min(w, r.cx - row.startCol)); b += k; a += w - k; }
  });
  return { before: b + SPARE, after: a + SPARE };
}

function highlight(term, r) {
  const first = r.rows[0], last = r.rows[r.rows.length - 1];
  const length = (last.y - first.y) * term.cols + (last.startCol + width(last) - first.startCol);
  if (length > 0) term.select(first.startCol, first.y, length);
}

// הדמיית Ctrl+A. T75: כובתה כשמשתמש דיווח שאחריה שורת ההקלדה לא מגיבה, ו-T74 הדליק אותה שוב רק אחרי שהוכחה מול Claude אמיתי עם מקשים אמיתיים
// (tests/tools/real-claude-keys.js): הדגשה, החלפה, Backspace/Delete, Esc, חצים, קליק, פריסה עברית, טוקן תמונה, ומיקוד מחוץ לטרמינל.
// הסיבה לדיווח הייתה ששני דברים לא זוהו על המסך האמיתי (רווח שאינו נשבר אחרי ה-❯, ותווית על הקו העליון), ושב-Ctrl+A כשהמיקוד מחוץ לטרמינל הדפדפן בחר את כל הדף (shortcuts.js).
// כיבוי: false כאן מעביר את כל המקשים ל-Claude כמו קודם.
export const INPUT_SELECT_ENABLED = true;
let enabledNow = INPUT_SELECT_ENABLED;
export const setInputSelectEnabled = (v) => { enabledNow = !!v; };

const active = new WeakMap(); // term -> { text, at }: הטקסט שסומן ומתי; בתוקף כל עוד הבחירה קיימת, התיבה לא השתנתה, ולא עברו HIGHLIGHT_MAX_MS
const HIGHLIGHT_MAX_MS = 15000; // מוצא מילוט: סימון ישן לא נשאר לנצח ולא מוחק טקסט שהשתנה מאז
const MODIFIER_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'ContextMenu'];

// נותנים לכל שאר הקוד לראות אם הבחירה היא שלנו (pane-terminal: Ctrl+C הרגיל מעתיק את כל הבחירה, כאן הוא מעתיק רק את הטקסט שהוקלד)
export const hasInputSelection = (term) => active.has(term) && term.hasSelection();

/**
 * נקרא ממטפל המקשים של הטרמינל לפני כל השאר. מחזיר true/false כשהטיפל במקש (false = xterm לא ישלח אותו), או undefined כשלא נוגע בו.
 */
export function handleInputKey(term, meta, e, hooks = {}) {
  if (!enabledNow) return undefined;
  if (e.type !== 'keydown') return undefined;
  const plain = !e.altKey && !e.metaKey && !e.shiftKey;
  const ctrlOnly = e.ctrlKey && plain;
  const isCtrlA = ctrlOnly && (e.code === 'KeyA' || e.key === 'a' || e.key === 'A');

  if (isCtrlA) {
    const pane = state.panes.get(meta.id);
    if (pane && (pane.meta.exited || pane.meta.agentState === 'attention' || pane.key === 'attn')) return undefined; // יש דיאלוג אישור או שהתהליך הסתיים: Ctrl+A עובר כמו שהוא
    let r = null;
    try { r = findInput(term); } catch { r = null; }
    if (!r || r.empty) return undefined;
    highlight(term, r);
    active.set(term, { text: inputText(r), at: Date.now() });
    e.preventDefault();
    return false;
  }

  if (!hasInputSelection(term)) { active.delete(term); return undefined; }
  if (MODIFIER_KEYS.includes(e.key)) return undefined; // מקש שינוי לבדו לא משנה כלום

  const drop = () => { active.delete(term); term.clearSelection(); };
  // מוצא מילוט: סימון שעבר זמן, או שהטקסט בתיבה השתנה מאז (Claude צייר מחדש, המשתמש הקליד במקום אחר): מבטלים אותו והמקש עובר כרגיל, אף פעם לא מוחקים טקסט אחר
  const st = active.get(term);
  let now = null;
  try { now = findInput(term); } catch { now = null; }
  if (Date.now() - st.at > HIGHLIGHT_MAX_MS || !now || now.empty || inputText(now) !== st.text) { drop(); return undefined; }
  const wipe = () => {
    let r = null;
    try { r = findInput(term); } catch { r = null; }
    drop();
    if (!r || r.empty) return false;
    const p = deletePlan(r);
    const tokens = [...inputText(r).matchAll(/\[Image #(\d+)\]/g)].map((m) => Number(m[1])); // טוקני תמונה שנמחקים עם הטקסט
    term.input('\x1b[3~'.repeat(p.after) + '\x7f'.repeat(p.before));
    if (tokens.length && hooks.onWipe) { try { hooks.onWipe(tokens); } catch { /* לא קריטי */ } }
    return true;
  };
  const key = e.key;
  if (ctrlOnly && (e.code === 'KeyC' || e.code === 'KeyX')) {
    let r = null;
    try { r = findInput(term); } catch { r = null; }
    if (r && !r.empty) { try { navigator.clipboard.writeText(inputText(r)).catch(() => {}); } catch { /* אין לוח */ } }
    if (e.code === 'KeyX') wipe(); else drop();
    e.preventDefault();
    return false;
  }
  if (plain && !e.ctrlKey && (key === 'Backspace' || key === 'Delete')) { wipe(); e.preventDefault(); return false; }
  if (plain && !e.ctrlKey && key.length === 1) { wipe(); return true; } // תו רגיל מחליף: קודם מוחקים, ואז המקש עצמו נשלח
  if (e.shiftKey && !e.ctrlKey && !e.altKey && key.length === 1) { wipe(); return true; } // אות גדולה או סימן עם Shift: גם הוא תו רגיל
  drop(); // כל מקש אחר: הסימון נעלם והמקש פועל כרגיל
  return undefined;
}

/*
 * העתקת עברית מטרמינל של Claude בסדר לוגי (T67).
 *
 * Claude Code שולח שורות עברית בסדר חזותי (כמו אחרי אלגוריתם הכיוון של יוניקוד: הרצפים השמאליים נשארים, כל השאר הפוך), וכך הן יושבות בתוך חוצץ הטרמינל.
 * שכבת ה-RTL (rtl.js) רק מזיזה את התאים לימין כדי להציג, ולכן כל הדרכים להעתיק (Ctrl+C, תפריט, ⋯) החזירו את הטקסט ההפוך.
 * כאן ההפיכה חזרה, בשורות שהשכבה מזהה כעבריות בלבד (אותו מבחן כמו ב-layoutRow): הופכים את השורה, ורצפי אנגלית/מספרים/נתיבים נשארים כמו שהם
 * (ביטוי באנגלית עם רווחים הוא רצף אחד: "Terminal Grid" נשאר "Terminal Grid"). סוגריים לא הופכים: Claude לא משקף אותם, רק מחליף מקום, וההיפוך מחזיר אותם.
 * נקודת רשימה והזחה (● ❯ - 1.) נשארות בתחילת השורה. שורות שאינן עברית נשארות כמו שהן. הטקסט מומר לפי סוג הפאן (Claude), לא לפי ההגדרה "יישור עברית":
 * ההגדרה משנה רק את התצוגה, והחוצץ הוא תמיד בסדר חזותי.
 *
 * פסקה שנשברה לכמה שורות: Claude שובר שורות בעצמו (בלי isWrapped), ורוחב השבירה שלו קטן מרוחב המסך (נמדד: הודעה נשברת בכ-80 מתוך 100 עמודות), לכן אורך השורה לא מעיד על כלום.
 * שורה מצטרפת לקודמת (ברווח, בלי ירידת שורה) כשהקודמת עברית, והנוכחית עברית, מוזחת לפחות ברווחיים ואינה פותחת ברשימה. פסקאות נפרדות מופרדות בשורה ריקה או בנקודת רשימה, ולכן לא מתערבבות.
 */
const HEB = /[֐-׿]/;
const LETTER = /[A-Za-z֐-׿]/;
const BOX = /[─-▟]/;
const MARKER = /^(?:[●•·✻✢✶⎿❯>*-]|\d{1,3}[.)])$/;
// רצף שמאלי: אותיות/ספרות, ובתוכו רווחים וסימנים כשיש אחריהם עוד אותיות/ספרות ("V4.3", "src/server.js", "Terminal Grid", "C:\x\y"), ואחוז בסוף
const RUN = /[$~@#/\\]?[A-Za-z0-9_]+(?:[ .,:;\-/\\@#%+=~'"&_!?()[\]{}<>]+[A-Za-z0-9_]+)*%?/g;

const rev = (s) => [...s].reverse().join('');

/** גוף שורה בסדר חזותי -> סדר לוגי: סדר הרצפים הפוך, אותיות הרצפים הלא-שמאליים הפוכות, רצפים שמאליים כמו שהם */
export function visualToLogical(body) {
  const tokens = [];
  let last = 0, m;
  RUN.lastIndex = 0;
  while ((m = RUN.exec(body))) {
    if (m.index > last) tokens.push(rev(body.slice(last, m.index)));
    tokens.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < body.length) tokens.push(rev(body.slice(last)));
  return tokens.reverse().join('');
}

// האם השורה היא שורת עברית של Claude (אותו מבחן כמו שכבת ה-RTL): מעט עברית ביחס לאותיות, או תווי מסגרת, והיא נשארת כמו שהיא
export function isHebrewRow(text) {
  let heb = 0, letters = 0;
  for (const ch of text) {
    if (BOX.test(ch)) return false;
    if (HEB.test(ch)) { heb++; letters++; } else if (LETTER.test(ch)) letters++;
  }
  return heb > 0 && heb >= letters * 0.3;
}

// הזחה, נקודת רשימה (עם הרווחים אחריה) וגוף
function parts(line) {
  const t = line.replace(/\s+$/, '');
  const lead = /^\s*/.exec(t)[0];
  const rest = t.slice(lead.length);
  const m = /^(\S+)(\s+)(\S[\s\S]*)$/.exec(rest);
  if (m && MARKER.test(m[1])) return { lead, marker: m[1], gap: m[2], body: m[3] };
  return { lead, marker: '', gap: '', body: rest };
}

/** טקסט הבחירה כפי שהוא בחוצץ (שורות מופרדות ב-\n) -> טקסט בסדר לוגי */
export function logicalText(raw) {
  if (typeof raw !== 'string' || !HEB.test(raw)) return raw;
  // xterm מפריד שורות ב-\r\n ב-Windows: שומרים את המפריד המקורי בכל השורות, גם בשורות שלא נגענו בהן
  const sep = raw.includes('\r\n') ? '\r\n' : '\n';
  const out = [];
  let prev = false; // השורה הקודמת הייתה שורת עברית (מועמדת לצורף)
  for (const line of raw.split(/\r?\n/)) {
    if (!isHebrewRow(line)) { out.push(line); prev = false; continue; }
    const p = parts(line);
    const text = visualToLogical(p.body);
    const continues = prev && !p.marker && p.lead.length >= 2;
    if (continues) out[out.length - 1] += ' ' + text;
    else out.push(p.lead + p.marker + p.gap + text);
    prev = true;
  }
  return out.join(sep);
}

/** הטקסט להעתקה מבחירה בטרמינל: בפאן של Claude בסדר לוגי, בכל פאן אחר כמו שהוא */
export function selectionText(term, kind) {
  const raw = term.getSelection();
  if (kind !== 'claude') return raw;
  try { return logicalText(raw); } catch { return raw; }
}

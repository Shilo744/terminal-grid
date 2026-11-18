'use strict';
/*
 * שאלת האמון של Claude Code בתיקייה חדשה: איזו אפשרות מסומנת עכשיו, ומה מותר ללחוץ (פונקציות טהורות, נבדקות מול הטקסט האמיתי ב-tests/fixtures/trust-real-prompt.txt).
 * הדיאלוג האמיתי:
 *     Quick safety check: Is this a project you created or one you trust? ...
 *     ❯ No, exit
 *       Yes, I trust this folder
 *     Enter to confirm · Esc to cancel
 * ברירת המחדל המסומנת היא "No, exit" (האפשרות הראשונה), ולכן Enter לבדו סוגר את Claude. הכלל: Enter נלחץ רק כשהשורה המסומנת היא "Yes, I trust this folder".
 * כשהמסומנת היא "No" והשורה "Yes, I trust ..." מתחתיה, שולחים חץ למטה (ואז קוראים את המסך שוב). בכל מקרה אחר (אין סימון, שני סימונים, שורה לא מוכרת) לא נשלח כלום.
 * הסימון: ❯ (גם › או >) בתחילת השורה, עם או בלי מספור ("1. ").
 */

const MARKER = /^\s*[❯›>]\s*(?:\d+[.)]\s*)?(.*\S)\s*$/;
const YES = /^(?:\d+[.)]\s*)?yes\b/i;
const NO = /^(?:\d+[.)]\s*)?no\b/i;

function trustPromptShown(text) {
  // הדיאלוג הנוכחי (עם "Enter to confirm"), או הניסוח הישן של השאלה
  return (/trust this folder/i.test(text) && /Enter to confirm/i.test(text)) || /Do you trust the files in this folder/i.test(text);
}

// השורה המסומנת (Yes/No) היחידה במסך, או null (אין שאלה, אין סימון, או שני סימונים: לא ברור)
function selectedOption(text) {
  if (typeof text !== 'string' || !trustPromptShown(text)) return null;
  const lines = text.split('\n');
  const marked = [];
  lines.forEach((l, i) => {
    const m = MARKER.exec(l);
    if (m && (YES.test(m[1]) || NO.test(m[1]))) marked.push({ i, label: m[1], lines });
  });
  return marked.length === 1 ? marked[0] : null;
}

// 'enter' = השורה המסומנת היא "Yes, I trust ...". 'down' = המסומנת היא No ומתחתיה Yes. null = לא לוחצים כלום
function trustChoice(text) {
  const sel = selectedOption(text);
  if (!sel) return null;
  const { i, label, lines } = sel;
  if (YES.test(label)) return /trust/i.test(label) ? 'enter' : null;
  const yesBelow = lines.slice(i + 1, i + 4).some((l) => /^\s*(?:\d+[.)]\s*)?yes\b.*trust/i.test(l));
  return yesBelow ? 'down' : null;
}

// התווית של השורה המסומנת: server.js משווה לפניה ואחריה כדי לדעת שהמסך הגיב לחץ (ולא שלוחצים שוב בעיוור)
const selectedLabel = (text) => { const s = selectedOption(text); return s ? s.label : null; };

module.exports = { trustChoice, trustPromptShown, selectedLabel };

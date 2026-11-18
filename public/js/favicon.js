/* ---------- סמל הלשונית: נקודה כתומה קטנה כשיש טרמינל שמחכה לך ---------- */
// מצייר בקנבס פעם אחת לכל שינוי של הספירה (לא בכל בדיקת סטטוס). בלי הנקודה חוזרים לסמל המקורי מ-index.html.
let link = null;
let original = '';
let shown = 0;

function draw() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  // אותו סמל כמו ב-index.html: ריבוע כהה מעוגל, חץ של שורת פקודה וקו
  g.fillStyle = '#0a0d13';
  g.beginPath(); g.roundRect(0, 0, 32, 32, 8); g.fill();
  g.strokeStyle = '#46e3c6'; g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(9, 11); g.lineTo(15, 16); g.lineTo(9, 21); g.moveTo(18, 22); g.lineTo(24, 22); g.stroke();
  // הנקודה: כתומה עם טבעת בצבע הרקע, כדי שתהיה ברורה גם בלשונית קטנה
  g.fillStyle = '#0a0d13'; g.beginPath(); g.arc(24, 8, 8, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f4b740'; g.beginPath(); g.arc(24, 8, 6, 0, Math.PI * 2); g.fill();
  return c.toDataURL('image/png');
}

/** n = כמה טרמינלים מחכים לך כרגע. נקרא כל כמה מאות מילישניות, ומצייר רק כשהספירה עברה בין "אין" ל"יש". */
export function setWaitingMark(n) {
  const on = n > 0 ? 1 : 0;
  if (on === shown) return;
  shown = on;
  if (!link) { link = document.querySelector('link[rel="icon"]'); if (link) original = link.href; }
  if (!link) return;
  link.href = on ? draw() : original;
}

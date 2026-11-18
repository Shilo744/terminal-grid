/* ---------- קבוצת "כללי" בהגדרות: הפעלה אוטומטית עם Windows ---------- */
// הערך עצמו (system.autostart) מגיע מהשרת ומשקף אם הקיצור קיים בתיקיית ההפעלה של Windows. כאן רק הפעולה (POST /api/autostart) וההערה.

/** מחליף את setSetting בשורה הזאת: השרת יוצר/מוחק את הקיצור ומשדר את ההגדרה החדשה לכל החלונות. { ok, note } */
export async function setAutostart(enabled) {
  try {
    const res = await fetch('/api/autostart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true };
    return { ok: false, note: j.error || 'לא הצלחנו לשנות את ההפעלה האוטומטית.' };
  } catch {
    return { ok: false, note: 'אין חיבור לשרת כרגע.' };
  }
}

export function autostartNote() {
  const d = document.createElement('div');
  d.className = 'st-note';
  d.textContent = 'זה עובד אחרי כניסה למשתמש. כדי שזה יעבוד גם בלילות בלי השגחה, הגדירו ל-Windows כניסה אוטומטית (ראו README).';
  return d;
}

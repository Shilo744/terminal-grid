/* ---------- נתוני השיחות השמורות (היסטוריית Claude) למסך הפתיחה ---------- */
// מקור אחד: POST /api/history (השרת סורק אסינכרונית ושומר 3 שניות במטמון). כאן עוד מטמון קצר בצד הלקוח ושיתוף בקשה שרצה,
// כדי שמסך הפתיחה, שנפתח ונסגר, לא יפיל על השרת בקשות כפולות.
let cache = null;
let at = 0;
let inflight = null;
const TTL_MS = 3000;

/** @returns {Promise<{projects: object[]}|null>} null כשהבקשה נכשלה */
export function fetchHistory() {
  if (cache && Date.now() - at < TTL_MS) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch('/api/history', { method: 'POST' })
      .then((r) => r.json())
      .then((j) => { cache = j; at = Date.now(); return j; })
      .catch(() => null)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** השיחות האחרונות מכל הפרויקטים (החדשות ראשונות), בלי אלה שהתיקייה שלהן נעלמה או שרצות בחלון אחר */
export function recentSessions(history, n = 4) {
  const out = [];
  for (const p of (history && history.projects) || []) {
    if (!p.exists || !p.cwd) continue;
    for (const s of p.sessions) if (!s.open && !s.live) out.push({ id: s.id, title: s.title, last: s.last, cwd: p.cwd, folder: p.name });
  }
  return out.sort((a, b) => b.last - a.last).slice(0, n);
}

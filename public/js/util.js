/* ---------- עזרים קטנים בלי תלות בדף ---------- */

// שם התיקייה האחרונה בנתיב (גם אם הנתיב נגמר בלוכסן)
export const basename = (p) => {
  const parts = String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p || '';
};

// זמן יחסי קצר בעברית (תפריט הצד ומסך הפתיחה)
export function relTime(ms) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return 'עכשיו';
  if (d < 3600) return `${Math.floor(d / 60)} דק׳`;
  if (d < 86400) return `${Math.floor(d / 3600)} שע׳`;
  if (d < 172800) return 'אתמול';
  if (d < 604800) return `${Math.floor(d / 86400)} ימים`;
  return new Date(ms).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}

// כמה זמן עבר, בעברית קצרה ("מזה 4 דק׳"). משמש את תווית המצב של הטרמינל ואת כרטיסי הסוכנים בלוח הזוג
export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return 'מזה כמה שניות';
  const m = Math.round(s / 60);
  if (m < 60) return `מזה ${m} דק׳`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `מזה ${h} שע׳ ${r} דק׳` : `מזה ${h} שע׳`;
}

export const plural = (n, one, many) => (n === 1 ? one : many);

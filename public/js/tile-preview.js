/* ---------- גוף האריח: שתי שורות הפלט האחרונות בטקסט קריא (בלי טרמינל מוקטן שמצייר בזמן אמת) ---------- */
// אריח בתצוגה מוגדלת לא מצייר את הטרמינל (ראו renderer-pool.js). במקום זה קוראים את שתי השורות האחרונות עם טקסט מהמאגר של xterm
// (term.buffer.active) ומציגים אותן ב-12px. בודקים פעמיים בשנייה ומשנים את ה-DOM רק כשהטקסט השתנה.
import { state } from './state.js';

const INTERVAL_MS = 500;
const LINES = 2;
const SCAN = 60; // כמה שורות מסתכלים אחורה כדי למצוא שתי שורות עם תוכן
// קווי מסגרת ובלוקים בקצה השורה (תיבת ההקלדה של Claude) הם לא תוכן; שורה שנשארה בלי אות או ספרה מדלגים עליה
const EDGE = /^[\s─-▟|]+|[\s─-▟|]+$/g;
const HAS_TEXT = /[\p{L}\p{N}]/u;
// שורות עזר קבועות של Claude Code שלא אומרות כלום על מה שהוא עושה
const HINT = /^\?\s*for shortcuts|\(shift\+tab to cycle\)/i;

export function lastLines(term, n = LINES) {
  const buf = term.buffer.active;
  const out = [];
  for (let y = buf.length - 1, seen = 0; y >= 0 && out.length < n && seen < SCAN; y--, seen++) {
    const line = buf.getLine(y);
    if (!line) continue;
    // רצף רווחים ארוך (עמודות של טבלה, יישור) מתכווץ: אחרת הטקסט החשוב נחתך בקצה הצר של האריח
    const t = line.translateToString(true).replace(EDGE, '').replace(/ {3,}/g, '  ');
    if (t && HAS_TEXT.test(t) && !HINT.test(t)) out.unshift(t);
  }
  return out;
}

export function paintTile(p) {
  let lines;
  // בשלב ההפעלה (T41) האריח מציג רק את המצב, לא את מה שמתרחש מאחורי הקלעים
  if (p.meta && p.meta.startup) lines = ['מכין את Claude…'];
  else try { lines = lastLines(p.term); } catch { return; }
  const sig = lines.join('\n');
  if (sig === p.tileSig) return;
  p.tileSig = sig;
  const els = p.el.querySelectorAll('.tl');
  // השורה האחרונה תמיד למטה; כשיש רק אחת השורה העליונה ריקה
  els[0].textContent = lines.length > 1 ? lines[0] : '';
  els[1].textContent = lines.length ? lines[lines.length - 1] : '';
  els[0].title = els[1].title = sig;
}

export function initTilePreview() {
  setInterval(() => {
    if (document.hidden) return;
    for (const p of state.panes.values()) if (p.el.classList.contains('tile')) paintTile(p);
  }, INTERVAL_MS);
}

/* ---------- פריסת הטרמינלים: חלוקה, מיקוד והגדלה, ומצב התצוגה שנשמר בשרת ---------- */
import { GAP, HEAD_H, TILE_H } from './constants.js';
import { state, bus, activeTab, tabOf } from './state.js';
import { stage, emptyEl, gridBtn } from './dom.js';
import { send, onMessage } from './connection.js';
import { pool } from './renderer-pool.js';
import { paintTile } from './tile-preview.js';

/* ---------- מצב תצוגה שנשמר בשרת (לשוניות: לכל אחת סדר, הגדלה ומיקוד) ---------- */
// הלשוניות, הסדר, ההגדלה והמיקוד נשמרים בשרת (לא בדפדפן): הם חוזרים אחרי רענון, וגם אחרי שהכול נסגר ונפתח מחדש.
// מספרי הטרמינלים משתנים בין הפעלות, ולכן אי אפשר לשמור אותם בדפדפן לפי מספר.
let viewTimer = null;
export function sendView() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => send({ t: 'view', tabs: state.tabs.map((t) => ({ id: t.id, name: t.name, cwd: t.cwd || '', order: t.order, expanded: t.expanded, focus: t.focus })), active: state.activeTabId }), 300);
}

export function applyView(v) {
  if (!v) return;
  if (Array.isArray(v.tabs) && v.tabs.length) {
    // הלשוניות של השרת מחליפות את המקומיות; טרמינל שהשרת לא שייך ללשונית (נוצר בינתיים) נכנס לפעילה
    const placed = new Set();
    const own = (id) => state.panes.has(id) && !state.panes.get(id).duo && !placed.has(id) && placed.add(id);
    const tabs = v.tabs.map((t) => ({ id: String(t.id), name: typeof t.name === 'string' ? t.name : '', cwd: typeof t.cwd === 'string' ? t.cwd : '', order: (t.order || []).map(String).filter(own), expanded: t.expanded ? String(t.expanded) : null, focus: t.focus ? String(t.focus) : null }));
    const active = tabs.find((t) => t.id === v.active) || tabs[0];
    for (const p of state.panes.values()) if (!p.duo && !placed.has(p.id)) { active.order.push(p.id); placed.add(p.id); }
    for (const t of tabs) {
      if (!t.order.includes(t.expanded)) t.expanded = null;
      if (!t.order.includes(t.focus)) t.focus = null;
    }
    state.tabs = tabs;
    state.activeTabId = active.id;
  } else if (Array.isArray(v.order)) {
    const rank = (id) => { const i = v.order.indexOf(id); return i < 0 ? v.order.length + Number(id) : i; };
    state.order.sort((a, b) => rank(a) - rank(b));
    if (v.expanded && state.panes.has(v.expanded)) state.expandedId = v.expanded;
    if (v.focus && state.panes.has(v.focus)) state.focusId = v.focus;
  }
  bus.emit('tabs');
  const a = activeTab();
  setExpanded(a.expanded && state.panes.has(a.expanded) ? a.expanded : null);
  if (a.focus && state.panes.has(a.focus)) setFocus(a.focus);
  scheduleLayout();
}

/* ---------- מיקוד והגדלה ---------- */
export const isFocused = (p) => state.focusId === p.id && document.hasFocus();

export function focusTerm(id) {
  const p = state.panes.get(id);
  if (p) requestAnimationFrame(() => p.term.focus());
}

let focusSeq = 0;
export function setFocus(id) {
  const p = state.panes.get(id);
  if (p && !p.duo) { const t = tabOf(id); if (t && t.id !== state.activeTabId) switchTab(t.id, { focus: false }); } // טרמינל בלשונית אחרת: עוברים אליה קודם
  state.focusId = id;
  if (p) { p.waiting = false; p.dirty = false; p.focusedAt = ++focusSeq; pool.promote(p); }
  for (const q of state.panes.values()) q.el.classList.toggle('focused', q.id === id);
  focusTerm(id);
  bus.emit('focus');
  sendView();
}

// מעבר ללשונית רשת (T60): הטרמינלים של האחרות נעלמים (relayout) ולא מציירים, אבל ממשיכים לרוץ ולדווח מצב
export function switchTab(id, { focus = true } = {}) {
  if (id === state.activeTabId || !state.tabs.some((t) => t.id === id)) return;
  state.activeTabId = id;
  const t = activeTab();
  if (!t.focus || !state.panes.has(t.focus)) t.focus = t.order[0] || null;
  bus.emit('tabs');
  bus.emit('expanded');
  if (focus && t.focus) setFocus(t.focus);
  else {
    for (const q of state.panes.values()) q.el.classList.toggle('focused', q.id === t.focus);
    bus.emit('focus');
    sendView();
  }
  scheduleLayout();
}

export function setExpanded(id) {
  state.expandedId = id;
  bus.emit('expanded');
  gridBtn.hidden = !(id && state.order.length > 1);
  sendView();
  scheduleLayout();
}

// חלון שנפתח בגלל "פתח ב-Terminal Grid" בתיקייה: מתמקדים בטרמינל החדש
export function restoreView() {
  const f = /f=(\d+)/.exec(location.hash);
  if (f && state.panes.has(f[1])) setFocus(f[1]);
}

// לחיצה על טרמינל: אם יש יותר מ-4 (או שכבר במצב מוגדל) הוא נהיה גדול לקריאה
export function activate(id) {
  // טרמינל של זוג סוכנים: רק מיקוד (אין הגדלה ואין מקום ברשת)
  const pane = state.panes.get(id);
  if (pane && pane.duo) { bus.emit('duo:reveal', pane.duo.duoId); setFocus(id); return; } // מסך הזוגות מציג את הזוג של הסוכן (duo/data.js)
  const t = tabOf(id);
  if (t && t.id !== state.activeTabId) switchTab(t.id, { focus: false }); // הטרמינל בלשונית אחרת (למשל "N ממתינים לך", Alt+W, התראה): עוברים אליה
  const n = state.order.length;
  if (state.expandedId && state.expandedId !== id) setExpanded(id);
  else if (!state.expandedId && n > 4) setExpanded(id);
  setFocus(id);
}

/* ---------- חלוקה ---------- */
let layoutQueued = false;
export function scheduleLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => { layoutQueued = false; relayout(); });
}

function computeRects(ids, W, H) {
  const rects = new Map();
  const n = ids.length;
  const exp = state.expandedId && n > 1 && ids.includes(state.expandedId) ? state.expandedId : null;

  if (exp) {
    const others = ids.filter((i) => i !== exp);
    const k = others.length;
    const sideCols = k > 8 ? 2 : 1;
    const colW = Math.round(Math.max(200, Math.min(380, W * 0.24)));
    const sideW = sideCols * colW + (sideCols - 1) * GAP;
    const mainX = sideW + GAP;
    const mainW = Math.max(200, W - mainX);
    rects.set(exp, { x: mainX, y: 0, w: mainW, h: H, tile: false });

    const rows = Math.ceil(k / sideCols);
    const availH = (H - (rows - 1) * GAP) / rows;
    const tileH = Math.floor(Math.min(availH, TILE_H));
    others.forEach((id, i) => {
      const r = Math.floor(i / sideCols), c = i % sideCols;
      rects.set(id, { x: c * (colW + GAP), y: r * (tileH + GAP), w: colW, h: tileH, tile: true });
    });
    return rects;
  }

  // רשת שווה: 1→1, 2→שניים, 3→שניים + אחד רחב, 4→2×2, 5-6→3×2, 7-9→3×3 ...
  const cols = n === 1 ? 1 : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const base = Math.floor(n / rows), extra = n % rows;
  const rowH = (H - (rows - 1) * GAP) / rows;
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const count = base + (r < extra ? 1 : 0);
    const cellW = (W - (count - 1) * GAP) / count;
    for (let c = 0; c < count; c++) {
      rects.set(ids[idx++], {
        x: Math.round(c * (cellW + GAP)), y: Math.round(r * (rowH + GAP)),
        w: Math.round(cellW), h: Math.round(rowH), tile: false,
      });
    }
  }
  return rects;
}

function relayout() {
  // טרמינלים של לשוניות אחרות מוסתרים ולא מציירים; הם ממשיכים לרוץ ולדווח מצב (אותו מנגנון כמו אריחים)
  const shown = new Set(state.order);
  for (const p of state.panes.values()) {
    if (p.duo) continue;
    const parked = !shown.has(p.id);
    if (p.el.classList.contains('tab-parked') !== parked) p.el.classList.toggle('tab-parked', parked);
    if (parked) pool.setRendering(p, false, true);
  }
  // כרטיס "פותח את..." (pending.js) תופס תא בחלוקה כמו טרמינל, בלי להיות אחד: המפתח שלו מתחיל ב-~
  const waiting = [...state.pending.keys()].map((k) => '~' + k);
  const ids = waiting.length ? state.order.concat(waiting) : state.order;
  const showEmpty = ids.length === 0 && state.synced; // לא מציגים "אין טרמינלים" לפני שהשרת ענה
  const wasHidden = emptyEl.hidden;
  emptyEl.hidden = !showEmpty;
  if (showEmpty && wasHidden) bus.emit('empty-shown'); // start-screen.js טוען שיחות ותיקיות אחרונות
  gridBtn.hidden = !(state.expandedId && ids.length > 1);
  if (!ids.length) return;

  const W = stage.clientWidth, H = stage.clientHeight;
  if (W < 10 || H < 10) return;
  const rects = computeRects(ids, W, H);

  for (const id of ids) {
    const r = rects.get(id);
    if (id[0] === '~') {
      const q = state.pending.get(id.slice(1));
      if (q && r) {
        Object.assign(q.el.style, { insetInlineStart: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
        q.el.classList.toggle('tile', r.tile);
      }
      continue;
    }
    const p = state.panes.get(id);
    if (!p || !r) continue;

    p.el.style.insetInlineStart = r.x + 'px';
    p.el.style.top = r.y + 'px';
    p.el.style.width = r.w + 'px';
    p.el.style.height = r.h + 'px';
    const wasTile = p.el.classList.contains('tile');
    p.el.classList.toggle('tile', r.tile);
    p.el.classList.toggle('focused', id === state.focusId);

    // אריח (תצוגה מוגדלת) לא מצייר ולא משנה גודל: גוף הטרמינל מוסתר ובמקומו שתי שורות הפלט האחרונות (tile-preview.js).
    // ה-PTY שלו נשאר בגודל שהיה, והוא יותאם רק כשהאריח יוגדל.
    if (r.tile) {
      pool.setRendering(p, false);
      if (!wasTile) paintTile(p);
      continue;
    }
    pool.setRendering(p, true);

    const innerW = r.w - 2, innerH = r.h - 2 - HEAD_H;
    p.host.style.width = innerW + 'px';
    p.host.style.height = innerH + 'px';
    p.host.style.left = '0px';

    if (p.lastVW !== innerW || p.lastVH !== innerH) {
      p.lastVW = innerW; p.lastVH = innerH;
      try { p.fit.fit(); } catch { /* not measurable yet */ }
    }
  }
}

export function initLayout() {
  new ResizeObserver(scheduleLayout).observe(stage);
  onMessage('view', (m) => applyView(m.view));
}

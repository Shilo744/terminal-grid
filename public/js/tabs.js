/* ---------- לשוניות הרשת (T60): כמה קבוצות עבודה זו לצד זו, לכל אחת סדר, הגדלה ומיקוד משלה ---------- */
// המודל נמצא ב-state.js (state.tabs, והגטרים state.order / focusId / expandedId של הלשונית הפעילה) ונשמר בשרת דרך sendView (layout.js).
// כאן הפעולות: לשונית חדשה, שם, סגירה, העברת טרמינל בין לשוניות, סדר, והמצב שהנקודה בלשונית מציגה. שורת הלשוניות עצמה ב-duo/view.js.
import { state, bus, activeTab, tabOf } from './state.js';
import { sendView, switchTab, scheduleLayout, setFocus, focusTerm } from './layout.js';
import { basename } from './util.js';
import { openMenu } from './menu.js';
import { overlayRename, NAME_MAX } from './rename.js';
import { requestClose } from './pane-actions.js';

export const MAX_TABS = 40;
const newId = () => 't' + Math.random().toString(36).slice(2, 8);

/** שם הלשונית: מה שנתן המשתמש, אחרת תיקיית הפרויקט של ה-Claude הראשון בה, אחרת "ראשי" (הראשונה) או "לשונית N" */
export function tabName(t) {
  if (t.name) return t.name;
  for (const id of t.order) {
    const p = state.panes.get(id);
    if (p && p.meta.kind === 'claude' && p.meta.cwd) return basename(p.meta.cwd);
  }
  if (t.cwd) return basename(t.cwd);
  const i = state.tabs.indexOf(t);
  return i === 0 ? 'לשונית חדשה' : `לשונית ${i + 1}`; // הלשונית הראשונה בלי טרמינל של Claude: "ראשי" (T68)
}

/** הנקודה של הלשונית: המצב החזק ביותר בתוכה. מחכה לך (אישור או סיים) > בעיה (תהליך שהסתיים) > עובד > פנוי */
export function tabStatus(t) {
  let worst = 'idle';
  const rank = { idle: 0, busy: 1, danger: 2, warn: 3 };
  for (const id of t.order) {
    const p = state.panes.get(id);
    if (!p) continue;
    const s = p.key === 'attn' || p.key === 'done' ? 'warn' : p.key === 'exit' ? 'danger' : p.key === 'busy' ? 'busy' : 'idle';
    if (rank[s] > rank[worst]) worst = s;
  }
  return worst;
}

export const STATUS_TEXT = { warn: 'מחכה לך', danger: 'תהליך שהסתיים', busy: 'עובד', idle: 'פנוי' };

/** חתימה קצרה של מה שהשורה מציגה (שמות, ספירה, נקודות): שורת הלשוניות נבנית מחדש רק כשהיא משתנה */
export const tabsSignature = () => state.tabs.map((t) => [t.id, tabName(t), t.order.length, tabStatus(t)].join(':')).join('|') + '|' + state.activeTabId;

export function newTab({ activate = true } = {}) {
  if (state.tabs.length >= MAX_TABS) return null;
  const t = { id: newId(), name: '', cwd: '', order: [], expanded: null, focus: null };
  state.tabs.push(t);
  bus.emit('tabs');
  if (activate) switchTab(t.id); else sendView();
  return t.id;
}

/** הלשונית הפעילה ריקה (חדשה, לא נגעו בה) ויש עוד לשוניות: סוגרים אותה בלי להשאיר כלום */
export function dropEmptyTab() {
  const t = state.tabs.find((x) => x.id === state.activeTabId);
  if (t && !t.order.length && state.tabs.length > 1) closeTab(t.id);
}

export function renameTab(t, anchor) {
  if (!anchor) return;
  overlayRename(anchor, {
    find: () => document.querySelector(`.gtab[data-tab="${t.id}"] .nm`),
    value: tabName(t),
    onCommit: (v) => { t.name = v.slice(0, NAME_MAX); bus.emit('tabs'); sendView(); },
  });
}

/** סוגר את הלשונית ואת הטרמינלים שבה בבת אחת (השיחות נשארות בהיסטוריה, כמו בסגירת טרמינל בודד). הלשונית האחרונה לא נסגרת */
export function closeTab(id) {
  const i = state.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const t = state.tabs[i];
  if (state.tabs.length < 2) {
    // הלשונית האחרונה (T72): נסגרים הטרמינלים שבה והיא נשארת כלשונית "ראשי" ריקה (השורה אף פעם לא ריקה)
    t.name = '';
    for (const pid of [...t.order]) { const p = state.panes.get(pid); if (p) requestClose(p); }
    bus.emit('tabs');
    sendView();
    return;
  }
  const wasActive = id === state.activeTabId;
  state.tabs.splice(i, 1);
  if (wasActive) state.activeTabId = (state.tabs[i - 1] || state.tabs[i]).id;
  for (const pid of t.order) { const p = state.panes.get(pid); if (p) requestClose(p); } // הטרמינל כבר מוסתר (אינו בשום לשונית), והשרת יאשר את הסגירה
  const a = activeTab();
  if (!a.focus || !state.panes.has(a.focus)) a.focus = a.order[0] || null;
  bus.emit('tabs');
  bus.emit('expanded');
  if (wasActive && a.focus) setFocus(a.focus); else { bus.emit('focus'); sendView(); }
  scheduleLayout();
}

/** מעביר טרמינל ללשונית אחרת (או 'new' ללשונית חדשה); הטרמינל ממשיך לרוץ ולא מופעל מחדש */
export function moveToTab(paneId, tabId) {
  const p = state.panes.get(paneId);
  if (!p || p.duo) return false;
  const from = tabOf(paneId);
  let to = state.tabs.find((t) => t.id === tabId);
  if (tabId === 'new') { const nid = newTab({ activate: false }); to = state.tabs.find((t) => t.id === nid); }
  if (!to || !from || from === to) return false;
  from.order = from.order.filter((x) => x !== paneId);
  if (from.expanded === paneId) from.expanded = null;
  const wasFocus = from.focus === paneId;
  if (wasFocus) from.focus = from.order[from.order.length - 1] || null;
  to.order.push(paneId);
  if (!to.focus) to.focus = paneId;
  bus.emit('tabs');
  bus.emit('expanded');
  if (from.id === state.activeTabId && wasFocus && from.focus) focusTerm(from.focus);
  sendView();
  scheduleLayout();
  return true;
}

export function reorderTabs(ids) {
  const byId = new Map(state.tabs.map((t) => [t.id, t]));
  const next = ids.map((id) => byId.get(id)).filter(Boolean);
  if (next.length !== state.tabs.length) return;
  state.tabs = next;
  bus.emit('tabs');
  sendView();
}

export function switchRelative(delta) {
  const i = state.tabs.findIndex((t) => t.id === state.activeTabId);
  const n = state.tabs.length;
  if (n < 2) return false;
  switchTab(state.tabs[(i + delta + n) % n].id);
  return true;
}

export function switchToNumber(n) {
  const t = state.tabs[n - 1];
  if (!t) return false;
  switchTab(t.id);
  return true;
}

/* ---------- תפריטים ---------- */
export function openTabMenu(t, where, nameEl) {
  const n = t.order.length;
  openMenu({
    ...where,
    label: `פעולות על ${tabName(t)}`,
    items: [
      { id: 'rename', label: 'שינוי שם', run: () => renameTab(t, nameEl) },
      { separator: true },
      { id: 'close', label: 'סגירת הלשונית', danger: true, disabled: state.tabs.length < 2 && !n, description: n ? `${n} ${n === 1 ? 'טרמינל ייסגר' : 'טרמינלים ייסגרו'} (השיחות נשארות בהיסטוריה)` : '', run: () => closeTab(t.id) },
    ],
  });
}

/** תפריט "העברה ללשונית…" לטרמינל: רשימת הלשוניות האחרות ולשונית חדשה */
export function openMoveMenu(p, where) {
  const from = tabOf(p.id);
  const items = state.tabs.filter((t) => t !== from).map((t) => ({ id: 'to-' + t.id, label: tabName(t), description: `${t.order.length} טרמינלים`, run: () => moveToTab(p.id, t.id) }));
  if (items.length) items.push({ separator: true });
  items.push({ id: 'to-new', label: 'לשונית חדשה', disabled: state.tabs.length >= MAX_TABS, run: () => moveToTab(p.id, 'new') });
  openMenu({ ...where, label: 'העברה ללשונית', items });
}

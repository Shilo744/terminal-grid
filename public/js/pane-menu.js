/* ---------- תפריט הפעולות של טרמינל: כפתור "⋯" בכותרת ולחיצה ימנית עליה ---------- */
// בדיוק הפעולות האלה ולא יותר: שינוי שם, שכפול, הפעלה מחדש (רק טרמינל שיצא), העתקת נתיב התיקייה, פתיחה בסייר הקבצים, ניקוי המסך,
// הגדלה/כיווץ, דחיסת השיחה (Claude בלבד) וסגירה. pane-actions.js מכריז pane-menu (pane, { anchor | point }) ומכאן נפתח התפריט.
import { state, bus } from './state.js';
import { send } from './connection.js';
import { openMenu } from './menu.js';
import { toast } from './toast.js';
import { setExpanded, setFocus } from './layout.js';
import { beginRename, requestClose, restartPane } from './pane-actions.js';
import { addPending } from './pending.js';
import { selectionText } from './hebrew-copy.js';
import { openMoveMenu } from './tabs.js';

// "/compact" בהדבקה מסוגרת ואז Enter, כמו שהזוגות מעירים סוכן: Claude מקבל אותה כפקודה אחת (ואם הוא באמצע תור, מכניס לתור)
// קטע אנגלי בתוך טקסט עברי: מבודד, כדי שהלוכסן לא יתהפך ("compact/")
const LTR = (s) => String.fromCharCode(0x2066) + s + String.fromCharCode(0x2069);
const COMPACT_INPUT = '\x1b[200~/compact\x1b[201~\r';

// terminal=true: קליק ימני על טקסט הטרמינל (T57): קודם העתקה ובחירת הכול (אין "הדבקה": Ctrl+V וגרירה הם הדרך, ופריט הדבקה היה דורש בקשת הרשאה ללוח), ואז אותן פעולות בקבוצות
export function paneMenuItems(p, { terminal = false } = {}) {
  const exited = !!p.meta.exited;
  const isClaude = p.meta.kind === 'claude';
  const expanded = state.expandedId === p.id;
  const it = {};
  it.copy = { id: 'copy', label: 'העתקה', hint: 'Ctrl+C', disabled: !(p.term && p.term.hasSelection()), run: () => copySelection(p) };
  it['select-all'] = { id: 'select-all', label: 'בחירת הכול', run: () => { if (p.term) p.term.selectAll(); } };
  if (!p.duo) it.rename = { id: 'rename', label: 'שינוי שם', run: () => beginRename(p) }; // סוכן זוג: התפקיד קבוע
  if (!p.duo) it.duplicate = { id: 'duplicate', label: 'שכפול', description: 'אותו סוג ואותה תיקייה', disabled: !p.meta.cwd, run: () => duplicate(p) };
  if (exited) it.restart = { id: 'restart', label: 'הפעלה מחדש', description: isClaude ? 'ממשיך את אותה שיחה' : 'באותה תיקייה', run: () => restartPane(p) };
  it['copy-path'] = { id: 'copy-path', label: 'העתקת נתיב התיקייה', disabled: !p.meta.cwd, run: () => copyPath(p) };
  it.reveal = { id: 'reveal', label: 'פתיחה בסייר הקבצים', disabled: !p.meta.cwd, run: () => reveal(p) };
  it.clear = { id: 'clear', label: 'ניקוי המסך', run: () => send({ t: 'clear', id: p.id }) };
  if (state.order.length > 1 && !p.duo) it.expand = { id: 'expand', label: expanded ? 'חזרה לתצוגת רשת' : 'הגדלה', run: () => { setExpanded(expanded ? null : p.id); setFocus(p.id); } };
  if (!p.duo) it.move = { id: 'move', label: 'העברה ללשונית…', description: 'הטרמינל ממשיך לרוץ', run: () => openMoveMenu(p, moveWhere(p)) };
  if (isClaude && !exited) it.compact = { id: 'compact', label: 'דחיסת השיחה עכשיו', description: `שולח ${LTR('/compact')} לסוכן`, run: () => compact(p) };
  it.close = { id: 'close', label: 'סגירה', danger: true, run: () => close(p) };
  const SEP = { separator: true };
  const order = terminal
    ? ['copy', 'select-all', SEP, 'rename', 'duplicate', 'restart', 'expand', 'move', SEP, 'copy-path', 'reveal', 'clear', 'compact', SEP, 'close']
    : ['rename', 'duplicate', 'restart', 'copy-path', 'reveal', 'clear', 'expand', 'move', 'compact', SEP, 'close'];
  const out = [];
  for (const key of order) {
    const item = key === SEP ? SEP : it[key];
    if (!item) continue;
    if (item === SEP && (!out.length || out[out.length - 1] === SEP)) continue; // בלי קו מפריד בהתחלה או כפול
    out.push(item);
  }
  if (out[out.length - 1] === SEP) out.pop();
  return out;
}

// איפה נפתח תפריט המשנה "העברה ללשונית": מתחת לכותרת הטרמינל
function moveWhere(p) {
  const r = p.el.querySelector('.pane-head').getBoundingClientRect();
  return { point: { x: r.left + 48, y: r.bottom } };
}

// העתקת הבחירה לפי בקשת המשתמש (לחיצה על פריט בתפריט: מחווה של משתמש, ולכן מותרת כתיבה ללוח)
function copySelection(p) {
  if (!p.term || !p.term.hasSelection()) return;
  navigator.clipboard.writeText(selectionText(p.term, p.meta.kind)).then(() => toast('הועתק'), () => toast('אין הרשאה לכתוב ללוח', 'error'));
}

function duplicate(p) {
  const reqId = Math.random().toString(36).slice(2);
  state.reqs.add(reqId);
  state.after.set(reqId, p.id);
  send({ t: 'create', kind: p.meta.kind, cwd: p.meta.cwd, reqId });
  addPending(reqId, p.meta.name || 'טרמינל');
}

function copyPath(p) {
  navigator.clipboard.writeText(p.meta.cwd).then(() => toast('הנתיב הועתק'), () => toast('אי אפשר להעתיק ללוח', 'error'));
}

function reveal(p) {
  fetch('/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: p.id }) })
    .then((r) => { if (!r.ok) toast('אי אפשר לפתוח את התיקייה', 'error'); }, () => toast('אי אפשר לפתוח את התיקייה', 'error'));
}

function compact(p) {
  const working = p.meta.agentState === 'working' || p.status === 'busy';
  send({ t: 'input', id: p.id, d: COMPACT_INPUT });
  if (working) toast('הסוכן עובד עכשיו. הדחיסה תתבצע כשיסיים את התור');
}

// סגירה מיידית, כמו כפתור ה-X (T55)
function close(p) {
  requestClose(p);
}

export function initPaneMenu() {
  bus.on('pane-menu', (p, where) => {
    // קליק ימני על הטרמינל (T57): התפריט נפתח בנקודה, ובסגירה (Esc, בחירה, קליק בחוץ) המיקוד חוזר לטרמינל
    const handle = openMenu({ ...where, label: `פעולות על ${p.meta.name}`, items: paneMenuItems(p, { terminal: !!where.terminal }), focus: where.anchor ? 'first' : undefined, onClose: where.terminal ? ({ reason }) => { if (reason === 'escape' && state.panes.get(p.id) === p) p.term.focus(); } : undefined }); // Esc מחזיר את המיקוד לטרמינל מיד; בחירה, או קליק במקום אחר, מחליטים בעצמם לאן המיקוד הולך
    // xterm מחזיר את המיקוד לעצמו בשחרור הכפתור (אחרי שהתפריט כבר נפתח): ממקדים את הפריט הראשון אחרי רגע, כדי שמקלדת (חצים, Enter, Esc) תפעל מיד
    if (where.terminal) setTimeout(() => { const first = handle.isOpen() && handle.el.querySelector('.menu-item:not(.disabled)'); if (first && !handle.el.contains(document.activeElement)) first.focus(); }, 40);
  });
}

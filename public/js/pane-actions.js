/* ---------- פעולות על פאן: גרירה להחלפת מקום, סגירה בשתי לחיצות, ושינוי שם ---------- */
import { state } from './state.js';
import { $, stage } from './dom.js';
import { send } from './connection.js';
import { activate, setExpanded, setFocus, focusTerm, sendView, scheduleLayout } from './layout.js';
import { bus } from './state.js';
import { busy, PENDING_MS } from './pending.js';
import { toast } from './toast.js';
import { isRenameKey } from './rename.js';

/* ---------- גרירה והחלפת מקום ---------- */
let dragId = null;
/** הטרמינל שגוררים עכשיו בכותרתו (שורת הלשוניות מקבלת אותו כהשלכה, T60), או null */
export const draggedPaneId = () => dragId;

function clearDropMarks() {
  for (const q of state.panes.values()) q.el.classList.remove('dragging', 'drop-target');
}

function movePane(fromId, toId) {
  // גרירה אל/מתוך הטרמינל הגדול = החלפה ביניהם בתצוגה המוגדלת
  if (state.expandedId === toId) { activate(fromId); return; }
  if (state.expandedId === fromId) { activate(toId); return; }
  const a = state.order.indexOf(fromId), b = state.order.indexOf(toId);
  if (a < 0 || b < 0) return;
  [state.order[a], state.order[b]] = [state.order[b], state.order[a]];
  sendView();
  scheduleLayout();
}

// הפאן מתעמעם ולא מגיב מיד בלחיצה; הוא נעלם כשהשרת מאשר ('closed'). אם האישור לא הגיע תוך 10 שניות הוא חוזר, עם הודעה
function sendClose(p) {
  send({ t: 'close', id: p.id });
  p.el.classList.add('closing');
  setTimeout(() => {
    if (state.panes.get(p.id) !== p) return;
    p.el.classList.remove('closing');
    toast('הסגירה לא הושלמה', 'error');
  }, PENDING_MS);
}

// הפעלה מחדש (כפתור השכבה "התהליך הסתיים" ופריט התפריט): הכפתור מציג ספינר מיד; הטרמינל הישן נסגר והחדש תופס את מקומו
// סוכן בזוג (T51): הזוג מפעיל אותו מחדש, באותו תפקיד ובאותה שיחה
export function restartPane(p) {
  send(p.duo ? { t: 'duo', op: 'restartAgent', duoId: p.duo.duoId, role: p.duo.role } : { t: 'restart', id: p.id });
  const btn = $('[data-act="restart"]', p.el);
  if (btn) busy(btn, 'מפעיל מחדש…', 'ההפעלה מחדש לא הושלמה');
}

/* ---------- כפתורי כותרת ---------- */
// סגירה מיידית (T55): כל שיחת Claude נשמרת בהיסטוריה של תפריט הצד וניתנת להמשך, ולכן לחיצה שנייה לא מגינה על כלום. אותו דבר לאריח, לפאן, לתפריט ולכפתור שבשכבת "התהליך הסתיים"
export function requestClose(p) {
  sendClose(p);
}

export function beginRename(p) {
  const el = $('.name', p.el);
  el.setAttribute('contenteditable', 'plaintext-only');
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = (commit) => {
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('blur', onBlur);
    const value = el.textContent.trim();
    el.removeAttribute('contenteditable');
    if (commit && value && value !== p.meta.name) send({ t: 'rename', id: p.id, name: value });
    el.textContent = p.meta.name;
    focusTerm(p.id);
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur);
}

// מחבר פאן חדש: מיקוד בלחיצה, גרירה להחלפת מקום ושינוי שם בלחיצה כפולה
export function wirePane(pane) {
  const el = pane.el;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ph-btn') || e.target.closest('.name[contenteditable]')) return;
    activate(pane.id);
  }, true);

  // גרירה: תופסים את הכותרת וגוררים על טרמינל אחר כדי להחליף ביניהם
  const head = $('.pane-head', el);
  head.draggable = true;
  head.addEventListener('dragstart', (e) => {
    if (e.target.closest('.name[contenteditable]')) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', pane.id);
    dragId = pane.id;
    el.classList.add('dragging');
  });
  head.addEventListener('dragend', () => { dragId = null; clearDropMarks(); });
  el.addEventListener('dragover', (e) => {
    if (!dragId || dragId === pane.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-target'); });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const from = dragId;
    clearDropMarks();
    if (from && from !== pane.id) movePane(from, pane.id);
  });
  // סוכני זוג: התפקיד (ארכיטקט / עובד) קבוע, בלי שינוי שם (T56)
  if (!pane.duo && !pane.meta.duo) $('.name', el).addEventListener('dblclick', () => beginRename(pane));
  // לחיצה ימנית על הכותרת: אותו תפריט כמו כפתור "⋯" (pane-menu.js)
  head.addEventListener('contextmenu', (e) => { e.preventDefault(); bus.emit('pane-menu', pane, { point: { x: e.clientX, y: e.clientY } }); });
  // וכל מקום אחר בפאן שלא טיפל בו (אריח, שכבת "התהליך הסתיים", שכבת ההפעלה): אותו תפריט, ולעולם לא תפריט הדפדפן או הדבקה (T57)
  el.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    bus.emit('pane-menu', pane, { point: { x: e.clientX, y: e.clientY } });
  });
}

// כפתורי הכותרת (הגדלה/סגירה) ושכבת "התהליך הסתיים" נתפסים בלחיצה על אזור הטרמינלים, וגם על עמודות הזוגות (T51: עד אז כפתור "⋯" ושכבת היציאה בטרמינל של זוג לא הגיבו)
export function initPaneActions() {
  const onClick = (e) => {
    const btn = e.target.closest('[data-act]');
    const pane = e.target.closest('.pane');
    if (!(btn && pane)) return;
    const p = state.panes.get(pane.dataset.id);
    if (!p) return;
    if (btn.dataset.act === 'expand') {
      setExpanded(state.expandedId === p.id ? null : p.id);
      setFocus(p.id);
    } else if (btn.dataset.act === 'close') {
      requestClose(p);
    } else if (btn.dataset.act === 'menu') {
      bus.emit('pane-menu', p, { anchor: btn });
    } else if (btn.dataset.act === 'restart') {
      restartPane(p);
    }
  };
  stage.addEventListener('click', onClick);
  $('#duoCols').addEventListener('click', onClick);
  // F2 כשהמיקוד בכותרת של פאן או אריח (לא בתוך הטרמינל): שינוי שם (T56)
  document.addEventListener('keydown', (e) => {
    if (!isRenameKey(e)) return;
    const head = document.activeElement && document.activeElement.closest && document.activeElement.closest('.pane-head');
    const pane = head && head.closest('.pane');
    const p = pane && state.panes.get(pane.dataset.id);
    if (p && !p.meta.duo) { e.preventDefault(); beginRename(p); }
  });
}

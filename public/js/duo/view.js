/* ---------- מסך הזוגות: מעבר בין רשת לזוגות, שורת הלשוניות של הרשת והזוגות, ומיקום הטרמינלים של הסוכנים בעמודות ---------- */
// ימין: הארכיטקט. אמצע: המסמך המשותף (board.js). שמאל: העובד.
// הטרמינלים של הזוג נוצרים ב-panes.js כמו כל טרמינל, אבל לא נכנסים לרשת: כאן הם מוצבים בעמודה שלהם.
import { $, stage, duoHold } from '../dom.js';
import { state, bus, tabOf } from '../state.js';
import { HEAD_H } from '../constants.js';
import { basename } from '../util.js';
import { scheduleLayout, switchTab } from '../layout.js';
import { pool } from '../renderer-pool.js';
import { duos, duoState, selectedDuo, selectDuo, setView, duoStatus, duoReason, reorderDuos, duoName, renameDuo, ROLES } from './data.js';
import { isRenameKey, isRenaming, afterRename } from '../rename.js';
import { openDuoMenu } from './ctx.js';
import { renderBoard } from './board.js';
import { openCreate } from './create.js';
import { icon } from '../icons.js';
import { send } from '../connection.js';
import { toast } from '../toast.js';
import { draggedPaneId } from '../pane-actions.js';
import { MAX_TABS, STATUS_TEXT, closeTab, moveToTab, newTab, openTabMenu, renameTab, reorderTabs, tabName, tabStatus, tabsSignature } from '../tabs.js';

const viewEl = $('#duoView');
const tabsEl = $('#duoTabs');
const colsEl = $('#duoCols');
const boardEl = $('#duoBoard');
const emptyEl = $('#duoEmpty');
const creatingEl = $('#duoCreating');
const slots = Object.fromEntries(ROLES.map((r) => [r, $(`.duo-col[data-role="${r}"] .duo-slot`)]));

const paneOf = (duo, role) => state.panes.get(duo.agents[role].sessionId);

// טרמינל בתוך העמודה: ממלא אותה, והטרמינל עצמו (xterm) מותאם לגודל שנשאר אחרי הכותרת
function place(pane, slot) {
  if (pane.el.parentElement !== slot) slot.appendChild(pane.el);
  const W = slot.clientWidth, H = slot.clientHeight;
  if (W < 10 || H < 10) return;
  Object.assign(pane.el.style, { insetInlineStart: '0px', top: '0px', width: W + 'px', height: H + 'px' });
  pane.el.classList.remove('tile');
  pool.setRendering(pane, true);
  const vw = W - 2, vh = H - 2 - HEAD_H;
  pane.host.style.width = vw + 'px';
  pane.host.style.height = vh + 'px';
  pane.host.style.left = '0px';
  if (pane.lastVW !== vw || pane.lastVH !== vh) {
    pane.lastVW = vw; pane.lastVH = vh;
    try { pane.fit.fit(); } catch { /* עוד לא ניתן למדידה */ }
  }
}

function mountPanes() {
  const duo = duoState.view === 'duo' ? selectedDuo() : null;
  // טרמינלים של זוגות שלא מוצגים עכשיו חוזרים למחזיק הנסתר
  for (const p of state.panes.values()) {
    if (!p.duo) continue;
    const shown = duo && p.duo.duoId === duo.id;
    if (!shown && p.el.parentElement !== duoHold) duoHold.appendChild(p.el);
    if (!shown) pool.setRendering(p, false); // טרמינל שממתין במחזיק לא מצייר
  }
  if (!duo) return;
  for (const role of ROLES) {
    const p = paneOf(duo, role);
    if (p) place(p, slots[role]);
  }
}

// גרירת לשוניות (T46, הוכללה ב-T60 לשוניות הרשת): pointer events עם לכידת מצביע; הלשונית הנגררת מורמת והאחרות מחליקות לפתוח את הפער; שחרור = סדר חדש; לחיצה בלי תנועה עדיין בוחרת.
// הגרירה והמקלדת פועלות בתוך קבוצה: לשוניות הזוגות, או לשוניות הרשת (groupSel)
const drag = { active: false, dirty: false, justDragged: false, live: '', focusKey: null };
const isRtl = () => getComputedStyle(tabsEl).direction === 'rtl';
const PAIR_SEL = '.duo-tab[data-id]';
const GRID_SEL = '.gtab';
const idOf = (el) => el.dataset.tab || el.dataset.id;
const keyOf = (el) => (el && el.dataset ? (el.dataset.tab ? 'g:' + el.dataset.tab : el.dataset.id ? 'p:' + el.dataset.id : '') : '');
const byKey = (k) => (k ? tabsEl.querySelector(k[0] === 'g' ? `${GRID_SEL}[data-tab="${k.slice(2)}"]` : `.duo-tab[data-id="${k.slice(2)}"]`) : null);

function wireReorder(tab, groupSel, reorder) {
  // מקלדת: Alt+Shift+חץ מזיז את הלשונית (חץ ימינה = למקום שלפני בעברית)
  tab.addEventListener('keydown', (e) => {
    if (!(e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) return;
    e.preventDefault();
    const ids = [...tabsEl.querySelectorAll(groupSel)].map(idOf);
    const i = ids.indexOf(idOf(tab));
    const later = (e.key === 'ArrowLeft') === isRtl();
    const j = later ? i + 1 : i - 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const nm = tab.querySelector('.nm').textContent;
    ids.splice(i, 1); ids.splice(j, 0, idOf(tab));
    // הלשוניות נבנות מחדש אחרי הזזה: המיקוד וההכרזה (aria-live) נשמרים ומוחזרים בבנייה
    drag.focusKey = keyOf(tab);
    drag.live = `${nm}: מקום ${j + 1} מתוך ${ids.length}`;
    reorder(ids);
    const moved = byKey(drag.focusKey);
    if (moved) moved.focus();
    const l = tabsEl.querySelector('.duo-live');
    if (l) l.textContent = drag.live;
  });
  tab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.x')) return;
    const tabs = [...tabsEl.querySelectorAll(groupSel)];
    if (tabs.length < 2) return;
    const from = tabs.indexOf(tab);
    const startX = e.clientX;
    let rects = null, moved = false, to = from;
    const gap = parseFloat(getComputedStyle(tabsEl).columnGap) || 6;
    const sign = isRtl() ? -1 : 1; // כיוון "מאוחר יותר" על המסך
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (!moved) {
        if (Math.abs(dx) < 5) return;
        moved = true; drag.active = true;
        tab.setPointerCapture(e.pointerId);
        tab.classList.add('lifted');
        rects = tabs.map((t) => t.getBoundingClientRect());
      }
      tab.style.transform = `translateX(${dx}px)`;
      const cx = rects[from].left + rects[from].width / 2 + dx;
      // היעד: כמה מהלשוניות האחרות נמצאות "לפני" מרכז הלשונית הנגררת, לפי כיוון הקריאה
      to = tabs.filter((t, i) => i !== from && (isRtl() ? rects[i].left + rects[i].width / 2 > cx : rects[i].left + rects[i].width / 2 < cx)).length;
      tabs.forEach((t, i) => {
        if (i === from) return;
        let shift = 0;
        if (to < from && i >= to && i < from) shift = sign * (rects[from].width + gap);
        if (to > from && i > from && i <= to) shift = -sign * (rects[from].width + gap);
        t.style.transform = shift ? `translateX(${shift}px)` : '';
      });
    };
    const onUp = () => {
      tab.removeEventListener('pointermove', onMove);
      tab.removeEventListener('pointerup', onUp);
      tab.removeEventListener('pointercancel', onUp);
      for (const t of tabs) { t.style.transform = ''; t.classList.remove('lifted'); }
      if (moved) {
        drag.justDragged = true;
        setTimeout(() => { drag.justDragged = false; }, 0);
        const ids = tabs.map(idOf);
        ids.splice(from, 1); ids.splice(to, 0, idOf(tab));
        drag.active = false;
        if (to !== from) reorder(ids); else if (drag.dirty) renderTabs();
        drag.dirty = false;
      }
    };
    tab.addEventListener('pointermove', onMove);
    tab.addEventListener('pointerup', onUp);
    tab.addEventListener('pointercancel', onUp);
  });
}

// סגירת זוג מהלשונית (T72): אותו שני-צעדים שקט כמו כפתור הסגירה של הלוח. לחיצה ראשונה מכינה (בתוך הלשונית: "לסגור?"), שנייה מאשרת, ואחרי 3 שניות חוזר.
// הסגירה מוחקת את מצב הזוג לתמיד (T55), ולכן אין סגירה בלחיצה אחת. מצב ההכנה שורד בנייה מחדש של השורה.
const pairClose = { id: null, timer: 0 };
function disarmPair() { clearTimeout(pairClose.timer); pairClose.id = null; pairClose.timer = 0; }
function pairCloseClick(d) {
  if (pairClose.id === d.id) {
    disarmPair();
    send({ t: 'duo', op: 'close', duoId: d.id });
    renderTabs();
    return;
  }
  disarmPair();
  pairClose.id = d.id;
  pairClose.timer = setTimeout(() => { disarmPair(); renderTabs(); }, 3000);
  renderTabs();
}
function addPairClose(tab, d) {
  const x = document.createElement('span');
  x.className = 'x' + (pairClose.id === d.id ? ' armed' : '');
  x.setAttribute('role', 'button');
  x.tabIndex = -1;
  x.textContent = pairClose.id === d.id ? 'לסגור?' : '×';
  x.title = pairClose.id === d.id ? 'לחצו שוב לאישור (חוזר אחרי 3 שניות)' : 'סגירת הזוג (הטרמינלים נסגרים, קבצי .duo נשארים): לחיצה ראשונה מבקשת אישור';
  x.setAttribute('aria-label', x.title);
  x.addEventListener('click', (e) => { e.stopPropagation(); pairCloseClick(d); });
  x.addEventListener('pointerdown', (e) => e.stopPropagation()); // לא מתחיל גרירת לשונית
  tab.appendChild(x);
  tab.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); pairCloseClick(d); } });
}

function wireTab(tab, d) {
  tab.dataset.id = d.id;
  tab.addEventListener('click', () => { if (drag.justDragged) return; setView('duo'); selectDuo(d.id); });
  // שינוי שם (T56): לחיצה כפולה או F2 כשהלשונית ממוקדת
  tab.addEventListener('dblclick', (e) => { e.preventDefault(); renameDuo(d, tab.querySelector('.nm')); });
  tab.addEventListener('contextmenu', (e) => { e.preventDefault(); openDuoMenu(d, { point: { x: e.clientX, y: e.clientY } }, tab.querySelector('.nm')); }); // T57
  tab.addEventListener('keydown', (e) => { if (isRenameKey(e)) { e.preventDefault(); renameDuo(d, tab.querySelector('.nm')); } });
  wireReorder(tab, PAIR_SEL, reorderDuos);
}

// לשונית רשת (T60): שם, מספר הטרמינלים, נקודה עם המצב החזק ביותר בתוכה, ו-X שסוגר אותה ואת הטרמינלים שבה. אותה גרירה וסדר מקלדת כמו לשונית זוג
function selectGridTab(id) { setView('grid'); switchTab(id); }
function gridTab(t) {
  const n = t.order.length;
  const st = tabStatus(t);
  const el = document.createElement('div');
  el.className = 'gtab';
  el.dataset.tab = t.id;
  el.dataset.status = st;
  el.tabIndex = 0;
  el.setAttribute('role', 'tab');
  el.setAttribute('aria-selected', String(duoState.view !== 'duo' && t.id === state.activeTabId));
  el.innerHTML = '<i class="dot"></i><span class="nm"></span><span class="pr"></span>' + (state.tabs.length > 1 || n ? '<button type="button" class="x" tabindex="-1"></button>' : '');
  $('.nm', el).textContent = tabName(t);
  $('.pr', el).textContent = n ? String(n) : '';
  $('.dot', el).title = STATUS_TEXT[st];
  el.title = `${tabName(t)} · ${n} ${n === 1 ? 'טרמינל' : 'טרמינלים'} · ${STATUS_TEXT[st]}\nלחיצה כפולה או F2: שינוי שם`;
  const x = $('.x', el);
  if (x) {
    x.textContent = '×';
    x.title = state.tabs.length < 2 ? `ריקון הלשונית: סוגר ${n === 1 ? 'את הטרמינל שבה' : `את ${n} הטרמינלים שבה`} והיא נשארת "ראשי" ריקה (השיחות נשארות בהיסטוריה)` : n ? `סגירת הלשונית וגם ${n === 1 ? 'הטרמינל שבה' : `${n} הטרמינלים שבה`} (השיחות נשארות בהיסטוריה)` : 'סגירת הלשונית';
    x.setAttribute('aria-label', x.title);
    x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(t.id); });
  }
  el.addEventListener('click', (e) => { if (drag.justDragged || e.target.closest('.x')) return; selectGridTab(t.id); });
  el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }); // לחיצת גלגלת סוגרת, כמו ב-Chrome
  el.addEventListener('dblclick', (e) => { if (e.target.closest('.x')) return; e.preventDefault(); renameTab(t, $('.nm', el)); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); openTabMenu(t, { point: { x: e.clientX, y: e.clientY } }, $('.nm', el)); });
  el.addEventListener('keydown', (e) => {
    if (isRenameKey(e)) { e.preventDefault(); renameTab(t, $('.nm', el)); }
    else if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); selectGridTab(t.id); }
  });
  // גרירת כותרת של טרמינל (pane-actions.js) אל לשונית: הלשונית מודגשת, וההשלכה מעבירה את הטרמינל
  el.addEventListener('dragover', (e) => {
    const id = draggedPaneId();
    if (!id || tabOf(id) === t) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-target'); });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    const id = draggedPaneId();
    if (id) moveToTab(id, t.id);
  });
  wireReorder(el, GRID_SEL, reorderTabs);
  return el;
}

// מקרא הנקודות: ארבע שורות קצרות (חמש נקודות), נפתח מה-"?" שבשורת הלשוניות
const LEGEND = [
  ['busy', 'עובד עכשיו', 'אחד הסוכנים מבצע תור'],
  ['idle', 'הכול תקין', 'ממתין למשימה הבאה'],
  ['paused', 'מושהה', 'אף אחד לא יתעורר עד שממשיכים'],
  ['warn', 'מחכה לך', 'סוכן ממתין לאישור, או בעיה שעדיין נכונה'],
  ['danger', 'בעיה', 'סוכן נסגר ואי אפשר להמשיך'],
];
let legendEl = null;
function toggleLegend(btn, force) {
  const open = force != null ? force : !legendEl;
  if (!open) { if (legendEl) { legendEl.remove(); legendEl = null; } btn.setAttribute('aria-expanded', 'false'); return; }
  if (legendEl) return;
  legendEl = document.createElement('div');
  legendEl.className = 'duo-legend';
  legendEl.setAttribute('role', 'dialog');
  legendEl.setAttribute('aria-label', 'מה הנקודות אומרות');
  legendEl.innerHTML = LEGEND.map(([st, t, d2]) => `<div class="lg-row" data-status="${st}"><i class="dot"></i><b>${t}</b><span>${d2}</span></div>`).join('');
  tabsEl.appendChild(legendEl);
  btn.setAttribute('aria-expanded', 'true');
}

// שורת לשוניות אחת (T60): לשוניות הרשת, אחריהן לשוניות הזוגות, ו"+" עם תפריט. מוצגת תמיד (T68): תכונה מוסתרת אי אפשר לגלות, וגם לשונית אחת ("ראשי") עם ה-"+" היא הכניסה ללשונית השנייה
function renderTabs() {
  if (isRenaming()) { afterRename(renderTabs); return; } // השדה יושב על השם בתוך הלשונית: לא בונים אותה מחדש עד שהוא נסגר (T71)
  if (drag.active) { drag.dirty = true; return; } // באמצע גרירה לא בונים מחדש את הלשוניות
  const focusedKey = document.activeElement && tabsEl.contains(document.activeElement) ? keyOf(document.activeElement) : null;
  const prevScroll = (tabsEl.querySelector('.tabs-scroll') || {}).scrollLeft || 0;
  tabsEl.replaceChildren();
  legendEl = null;
  const scroll = document.createElement('div');
  scroll.className = 'tabs-scroll';
  tabsEl.appendChild(scroll);
  const sel = selectedDuo();
  for (const d of duos.values()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'duo-tab';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(duoState.view === 'duo' && !!sel && sel.id === d.id));
    b.dataset.status = duoStatus(d);
    b.innerHTML = `<span class="tab-ic" aria-hidden="true">${icon('duo', 14)}</span><i class="dot"></i><span class="nm"></span><span class="pr"></span>`; // + כפתור X (בשני צעדים) מתווסף למטה // אייקון זוג: מבדיל בין שני סוגי הלשוניות במבט
    $('.nm', b).textContent = duoName(d);
    $('.pr', b).textContent = d.tasks.total ? `${d.tasks.counts.done}/${d.tasks.total}` : '';
    const why = duoReason(d);
    $('.dot', b).title = why;
    b.title = `${why}\n${duoName(d)} · ${d.project}\nלחיצה כפולה או F2: שינוי שם`;
    wireTab(b, d);
    addPairClose(b, d);
    scroll.appendChild(b);
  }
  // לשוניות הרשת אחרי לשוניות הזוגות, כך שלשונית חדשה תמיד נפתחת בסוף השורה. לשונית ריקה ובלי שם שלא פעילה מוסתרת (אין "ראשי" מיותרת)
  for (const tt of state.tabs) {
    if (!tt.order.length && !tt.name && tt === state.tabs[0]) continue; // הלשונית הריקה הראשונה לא מוצגת (גם כשהיא פעילה: מסך ההתחלה עומד בפני עצמו)
    scroll.appendChild(gridTab(tt));
  }
  const live = document.createElement('span');
  live.className = 'duo-live sr-only';
  live.setAttribute('aria-live', 'polite');
  live.textContent = drag.live;
  tabsEl.appendChild(live);
  if (creating()) {
    const wait = document.createElement('div');
    wait.className = 'duo-tab pending';
    wait.setAttribute('role', 'status');
    wait.innerHTML = '<span class="spin" aria-hidden="true"></span><span class="nm"></span>';
    $('.nm', wait).textContent = `יוצר את ${basename(duoState.creating.project) || 'הזוג'}…`;
    tabsEl.appendChild(wait);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'duo-tab duo-tab-new';
  add.textContent = '+';
  add.title = 'לשונית חדשה: מה לפתוח בה (Claude, PowerShell או זוג סוכנים)';
  add.setAttribute('aria-label', add.title);
  add.disabled = state.tabs.length >= MAX_TABS;
  add.addEventListener('click', () => { setView('grid'); newTab(); }); // לשונית ריקה מציגה את מסך הפתיחה שבו בוחרים מה לפתוח (T69)
  tabsEl.appendChild(add);
  const help = document.createElement('button');
  help.type = 'button';
  help.className = 'duo-legend-btn';
  help.textContent = '?';
  help.title = 'מה הנקודות אומרות';
  help.setAttribute('aria-label', 'מה הנקודות אומרות');
  help.setAttribute('aria-expanded', 'false');
  help.addEventListener('click', (e) => { e.stopPropagation(); toggleLegend(help); });
  tabsEl.appendChild(help);
  scroll.scrollLeft = prevScroll; // בנייה מחדש לא מחזירה את הרצועה להתחלה; הלשונית הפעילה תמיד נשארת בטווח הראייה
  const cur = scroll.querySelector('.gtab[aria-selected="true"]');
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const refocus = drag.focusKey || focusedKey;
  if (refocus) { const f = byKey(refocus); if (f) f.focus(); }
  drag.focusKey = null;
}
const creating = () => !!duoState.creating;

export function renderView() {
  const on = duoState.view === 'duo';
  stage.hidden = on;
  viewEl.hidden = !on;
  if (on) for (const p of state.panes.values()) if (!p.duo) pool.setRendering(p, false, true); // הרשת מוסתרת: לא מציירים אותה
  renderTabs();
  if (!on) { scheduleLayout(); mountPanes(); return; }

  const sel = selectedDuo();
  const creating = duoState.creating;
  emptyEl.hidden = duos.size > 0 || !!creating;
  creatingEl.hidden = !(creating && duos.size === 0);
  if (creating) $('.cr-project', creatingEl).textContent = creating.project;
  colsEl.hidden = duos.size === 0;
  renderBoard(boardEl, sel);
  mountPanes();
}

export function initView() {
  // המקרא נסגר בלחיצה בחוץ וב-Esc
  document.addEventListener('click', (e) => { if (legendEl && !e.target.closest('.duo-legend')) { const btn = tabsEl.querySelector('.duo-legend-btn'); if (btn) toggleLegend(btn, false); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && legendEl) { const btn = tabsEl.querySelector('.duo-legend-btn'); if (btn) { toggleLegend(btn, false); btn.focus(); } } });
  $('#duoEmptyCreate').addEventListener('click', () => openCreate());

  // הרבה לשוניות: גלגלת רגילה (אנכית) מעל השורה גוללת אותה הצידה, כי אין פס גלילה
  tabsEl.addEventListener('wheel', (e) => {
    const s = tabsEl.querySelector('.tabs-scroll');
    if (!s || s.scrollWidth <= s.clientWidth || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    s.scrollLeft += (getComputedStyle(s).direction === 'rtl' ? -1 : 1) * e.deltaY; // ב-RTL scrollLeft שלילי
    e.preventDefault();
  }, { passive: false });
  bus.on('tabs', renderTabs);
  // הנקודות והספירה של לשוניות הרשת משתנות עם מצב הטרמינלים: status.js מכריז בכל בדיקה, והשורה נבנית מחדש רק כשמשהו השתנה
  let lastSig = '';
  bus.on('status-tick', () => { const sig = tabsSignature(); if (sig !== lastSig) { lastSig = sig; renderTabs(); } });
  renderTabs();
  bus.on('duo:changed', () => {
    // הזוג האחרון נסגר (או מצב שמור של מסך זוגות בלי זוגות): אין מה להציג שם, חוזרים לרשת (T69)
    if (duoState.view === 'duo' && duos.size === 0 && !duoState.creating && state.synced) { setView('grid'); return; }
    renderView();
  });
  bus.on('duo:selected', renderView);
  bus.on('duo:view', renderView);
  // טרמינל של זוג נוצר/נסגר (panes.js מכריז): מציבים אותו בעמודה שלו
  bus.on('duo-pane', mountPanes);
  bus.on('duo-pane-removed', mountPanes);

  // גודל העמודות משתנה (חלון, תפריט צד): מתאימים את הטרמינלים שבתוכן
  new ResizeObserver(() => { if (duoState.view === 'duo') mountPanes(); }).observe(colsEl);
}

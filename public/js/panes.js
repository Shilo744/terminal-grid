/* ---------- פאנים: יצירה, הסרה, כותרות, וסנכרון עם הרשימה מהשרת ---------- */
import { THEME } from './constants.js';
import { state, bus } from './state.js';
import { $, stage, duoHold } from './dom.js';
import { icon } from './icons.js';
import { send, onMessage } from './connection.js';
import { getSetting } from './settings.js';
import { isFocused, focusTerm, sendView, scheduleLayout, applyView, restoreView, setFocus } from './layout.js';
import { createTerm, wireClipboard } from './pane-terminal.js';
import { wirePane, initPaneActions } from './pane-actions.js';
import { attach as attachRtl } from './rtl.js';
import { pool } from './renderer-pool.js';
import { removePending, clearPending } from './pending.js';
import { basename } from './util.js';
import { releaseImages } from './image-attach.js';

// פלט שמגיע מהשרת נאסף לתור לכל פאן ונכתב לטרמינל פעם אחת בפריים (הפאן הממוקד) או כל ~100ms (פאנים ברקע, אריחים, לשונית מוסתרת).
// כך עשרות הודעות קטנות בשנייה מכל טרמינל רועש הופכות לכתיבה אחת, בלי לשנות את הסדר ובלי לאבד כלום.
const BACKGROUND_FLUSH_MS = 100;
function flushWrite(p) {
  if (p.writeRaf) cancelAnimationFrame(p.writeRaf);
  clearTimeout(p.writeTimer);
  p.writeRaf = 0; p.writeTimer = null;
  const d = p.outQueue;
  p.outQueue = '';
  if (d) p.term.write(d);
}
function queueWrite(p, d) {
  p.outQueue += d;
  if (p.writeRaf || p.writeTimer) return;
  // "חם": הפאן הממוקד, או כזה שהוקלד בו משהו ב-1.5 השניות האחרונות (גם אם המיקוד הגיע אליו במקלדת ולא בלחיצה)
  const hot = p.id === state.focusId || Date.now() - p.lastTyped < 1500;
  if (hot && !document.hidden) p.writeRaf = requestAnimationFrame(() => flushWrite(p));
  else p.writeTimer = setTimeout(() => flushWrite(p), BACKGROUND_FLUSH_MS);
}
// מוותרים על מה שנאסף ועוד לא נכתב (למשל כשמציירים מחדש מתמונת מצב מהשרת)
function dropQueued(p) {
  if (p.writeRaf) cancelAnimationFrame(p.writeRaf);
  clearTimeout(p.writeTimer);
  p.writeRaf = 0; p.writeTimer = null; p.outQueue = '';
}

function addPane(meta, snapshot) {
  if (state.panes.has(meta.id)) return state.panes.get(meta.id);

  const el = document.createElement('section');
  el.className = 'pane';
  el.dataset.id = meta.id;
  el.innerHTML = `
      <header class="pane-head">
        <span class="dot" aria-hidden="true"></span>
        <span class="kind ${meta.kind}"></span>
        <span class="name" title="לחיצה כפולה לשינוי שם" dir="auto"></span>
        <span class="ptitle" dir="auto"></span>
        <span class="pstatus" hidden></span>
        <button class="ph-btn" data-act="menu" type="button" title="פעולות" aria-label="פעולות על הטרמינל" aria-haspopup="menu">${icon('more', 14)}</button>
        <button class="ph-btn" data-act="expand" type="button"></button>
        <button class="ph-btn close" data-act="close" type="button" title="סגירה" aria-label="סגירת הטרמינל">${icon('x', 14)}</button>
      </header>
      <div class="pane-body"><div class="term-host"></div><div class="tile-body" aria-hidden="true"><div class="tl"></div><div class="tl"></div></div><div class="shield"></div>
        <div class="pane-startup" role="status" hidden><span class="spin lg" aria-hidden="true"></span><span class="ps-title">מכין את Claude…</span><span class="ps-dir" dir="auto"></span></div>
        <div class="pane-exit" hidden><div class="pe-box"><div class="pe-title">התהליך הסתיים</div><div class="pe-code" dir="ltr"></div>
          <div class="pe-actions"><button class="btn primary" type="button" data-act="restart">הפעלה מחדש</button><button class="btn" type="button" data-act="close">סגירה</button></div></div></div></div>`;
  $('.kind', el).innerHTML = icon(meta.kind === 'claude' ? 'asterisk' : 'terminal', 15);
  // סגירה מיידית (T55): הטולטיפ אומר מה קורה. שיחת Claude נשמרת בהיסטוריה ואפשר להמשיך אותה
  const closeTip = meta.kind === 'claude' ? 'סגירה (השיחה נשמרת בהיסטוריה)' : 'סגירה';
  $('.ph-btn.close', el).title = closeTip;
  // טרמינל של זוג סוכנים לא נכנס לרשת: הוא מוצב בעמודה שלו במסך הזוגות (duo/view.js), ובינתיים מחכה במחזיק נסתר
  (meta.duo ? duoHold : stage).appendChild(el);
  if (meta.duo) el.dataset.duo = meta.duo.role;

  const host = $('.term-host', el);
  const { term, fit } = createTerm(meta, host, snapshot);

  // שכבת יישור עברית לימין, בלי לגעת באזור ההקלדה. Claude שולח עברית כבר מסודרת חזותית; טרמינל רגיל שולח בסדר לוגי, ולכן logical
  let rtl = null;
  {
    try { rtl = attachRtl(term, { logical: meta.kind !== 'claude', theme: THEME, isOn: () => getSetting('appearance.rtlLayer'), isHot: () => state.focusId === meta.id || Date.now() - (state.panes.get(meta.id) || { lastTyped: 0 }).lastTyped < 1500 }); } catch (e) { console.error('RTL layer', e); }
  }

  const pane = {
    id: meta.id, meta, el, term, fit, host, rtl,
    lastData: 0, dirty: false, waiting: false, status: '',
    lastVW: 0, lastVH: 0, resizeTimer: null,
    rendering: null, webgl: null, focusedAt: 0, tileSig: '',
    outQueue: '', writeRaf: 0, writeTimer: null, lastTyped: 0, lastKey: 0,
  };
  state.panes.set(meta.id, pane);
  // טרמינל של זוג סוכנים ממתין במחזיק הנסתר ולא מצייר עד שמציבים אותו בעמודה; השאר מחליט relayout (אריח או פאן שנראה)
  if (meta.duo) { pane.duo = meta.duo; pool.setRendering(pane, false); } else state.order.push(meta.id);

  term.onData((d) => {
    pane.lastTyped = Date.now();
    if (d !== '\x1b[I' && d !== '\x1b[O') pane.lastKey = Date.now(); // דיווח מיקוד של xterm (כניסה/יציאה) הוא לא הקלדה של המשתמש
    if (pane.outQueue) flushWrite(pane); // הקלדה בפאן שהיה ברקע: מה שנאסף נכתב עכשיו, כדי שהתגובה תופיע בלי עיכוב
    send({ t: 'input', id: pane.id, d });
  });
  term.onResize(({ cols, rows }) => {
    if (cols < MIN_COLS || rows < MIN_ROWS) return; // a pane that is momentarily tiny (layout in progress, hidden holder) must not shrink the agent's terminal: its text would be written a few characters wide
    clearTimeout(pane.resizeTimer);
    pane.resizeTimer = setTimeout(() => send({ t: 'resize', id: pane.id, cols, rows }), 80);
  });
  term.onBell(() => { pane.dirty = true; pane.lastData = 0; if (!isFocused(pane)) pane.waiting = true; });

  wireClipboard(term, host, meta);
  wirePane(pane);

  renderPaneMeta(pane);
  if (pane.duo) bus.emit('duo-pane', pane); // duo/view.js מציב אותו בעמודה
  return pane;
}

const MIN_COLS = 20, MIN_ROWS = 4;

function removePane(id) {
  const p = state.panes.get(id);
  if (!p) return;
  clearTimeout(p.resizeTimer);
  clearInterval(p.startupTimer);
  dropQueued(p);
  releaseImages(p); // כתובות ה-blob של התמונות שהודבקו
  if (p.rtl) p.rtl.dispose();
  pool.release(p);
  try { p.term.dispose(); } catch { /* ignore */ }
  p.el.remove();
  state.panes.delete(id);
  if (p.duo) bus.emit('duo-pane-removed', p);
  for (const t of state.tabs) { // הטרמינל יוצא מהלשונית שלו; ההגדלה והמיקוד של אותה לשונית עוברים הלאה
    if (!t.order.includes(id)) continue;
    t.order = t.order.filter((x) => x !== id);
    if (t.expanded === id) t.expanded = null;
    if (t.focus === id) {
      t.focus = t.order[t.order.length - 1] || null;
      if (t.id === state.activeTabId && t.focus) focusTerm(t.focus);
    }
  }
  sendView();
  scheduleLayout();
}

function paintStartupWait(p) {
  const su = $('.pane-startup', p.el);
  if (!su || !p.startupAt) return;
  const s = Math.floor((Date.now() - p.startupAt) / 1000);
  $('.ps-title', su).textContent = s >= 5 ? `Claude מתחיל… ${s} שניות` : 'מכין את Claude…';
}

function renderPaneMeta(p) {
  const nameEl = $('.name', p.el);
  if (nameEl.getAttribute('contenteditable') == null) nameEl.textContent = p.meta.name;
  // PowerShell מדווח את נתיב ה-exe ככותרת — רעש. אצל Claude הכותרת מציגה מה הסוכן עושה.
  let t = (p.meta.title || '').trim();
  if (/\.exe$/i.test(t)) t = '';
  const titleEl = $('.ptitle', p.el);
  titleEl.textContent = t;
  titleEl.title = t;
  // מצב הסוכן לפי hooks של Claude (status.js משתמש בו; בלעדיו ההיגיון הישן של תזמון פלט)
  if (p.meta.agentSource === 'hooks' && p.meta.agentState) p.el.dataset.agent = p.meta.agentState; else delete p.el.dataset.agent;
  // שלב ההפעלה (T41): שכבה אטומה "מכין את Claude…" עד שהשרת מודיע שהוא מוכן; ההסתרה בדהייה של 150ms
  const su = $('.pane-startup', p.el);
  if (p.meta.startup) {
    su.classList.remove('lifting');
    su.hidden = false;
    $('.ps-dir', su).textContent = basename(p.meta.cwd || '');
    // אחרי 5 שניות: "Claude מתחיל… N שניות", כדי שיהיה ברור שהוא חי ואיטי ולא תקוע (T72)
    if (!p.startupAt) { p.startupAt = Date.now(); p.startupTimer = setInterval(() => paintStartupWait(p), 1000); }
  } else if (p.startupAt) {
    clearInterval(p.startupTimer); p.startupAt = 0;
    $('.ps-title', su).textContent = 'מכין את Claude…';
  }
  if (!p.meta.startup && !su.hidden && !su.classList.contains('lifting')) {
    su.classList.add('lifting');
    setTimeout(() => { if (!p.meta.startup) { su.hidden = true; su.classList.remove('lifting'); } }, 170);
  }
  // טרמינל שהתהליך שלו יצא: שכבה עם קוד היציאה ו"הפעלה מחדש" / "סגירה" (בטרמינל של זוג סוכנים ההפעלה מחדש עוברת דרך הזוג, T51)
  const gone = $('.pane-exit', p.el);
  gone.hidden = !p.meta.exited;
  if (p.meta.exited) {
    $('.pe-code', p.el).textContent = p.meta.exitCode != null ? `exit code ${p.meta.exitCode}` : '';
  }
  const exp = p.el.querySelector('[data-act="expand"]');
  const isExp = state.expandedId === p.id;
  exp.innerHTML = icon(isExp ? 'shrink' : 'expand', 14);
  exp.title = isExp ? 'חזרה לתצוגת רשת' : 'הגדלה';
  exp.setAttribute('aria-label', exp.title);
}

function syncList(list, view) {
  const seen = new Set();
  for (const meta of list) {
    seen.add(meta.id);
    const p = state.panes.get(meta.id);
    if (p) {
      // חיבור מחדש: מציירים את המסך מחדש לפי התמונה מהשרת
      p.meta = { ...p.meta, ...meta };
      dropQueued(p);
      p.term.reset();
      p.term.resize(meta.cols, meta.rows);
      p.term.write(meta.snapshot || '');
      p.lastVW = 0;
      renderPaneMeta(p);
    } else {
      addPane(meta, meta.snapshot || '');
    }
  }
  for (const id of [...state.panes.keys()]) if (!seen.has(id)) removePane(id);
  if (!state.focusId || !state.panes.has(state.focusId)) state.focusId = state.order[0] || null;
  state.synced = true;
  clearPending();
  // בפעם הראשונה מחזירים את הסדר, ההגדלה והמיקוד כפי שהשרת שמר אותם (גם אחרי שהכול נסגר ונפתח מחדש)
  if (!state.restored) { state.restored = true; applyView(view); restoreView(); }
  scheduleLayout();
}

// הודעות מהשרת על טרמינלים
export function initPanes() {
  onMessage('list', (m) => syncList(m.sessions, m.view));
  onMessage('created', (m) => {
    if (m.reqId) removePending(m.reqId); // הכרטיס "פותח את..." מוחלף בטרמינל האמיתי
    const mine = m.reqId && state.reqs.delete(m.reqId);
    const pane = addPane(m.session, '');
    // שכפול: הטרמינל החדש נכנס מיד אחרי המקור בסדר
    const after = m.reqId && state.after.get(m.reqId);
    if (after) {
      state.after.delete(m.reqId);
      const rest = state.order.filter((x) => x !== pane.id);
      const i = rest.indexOf(after);
      if (i >= 0) { rest.splice(i + 1, 0, pane.id); state.order = rest; sendView(); }
    }
    if (mine || m.focus) {
      if (state.expandedId) state.expandedId = pane.id;
      setFocus(pane.id);
    }
    scheduleLayout();
  });
  onMessage('data', (m) => {
    const p = state.panes.get(m.id);
    if (!p) return;
    queueWrite(p, m.d);
    p.lastData = Date.now();
    p.dirty = true;
  });
  onMessage('title', (m) => {
    const p = state.panes.get(m.id);
    if (p) { p.meta.title = m.title; renderPaneMeta(p); }
  });
  onMessage('renamed', (m) => {
    const p = state.panes.get(m.id);
    if (p) { p.meta.name = m.name; renderPaneMeta(p); }
  });
  onMessage('exit', (m) => {
    const p = state.panes.get(m.id);
    if (!p) return;
    p.meta.exited = true;
    p.meta.exitCode = m.code;
    flushWrite(p); // קודם כל מה שנאסף, כדי שהודעת הסיום תופיע אחרי הפלט
    p.term.write(`\r\n\x1b[2m[process exited with code ${m.code}]\x1b[0m\r\n`);
    renderPaneMeta(p);
  });
  onMessage('agent', (m) => {
    const p = state.panes.get(m.id);
    if (!p) return;
    const prev = p.meta.agentState, prevSince = p.meta.agentSince;
    Object.assign(p.meta, { agentState: m.state, agentSince: m.since, agentSource: m.source, agentPending: !!m.pending });
    if (m.state === 'done' && !isFocused(p)) p.waiting = true; // סיים תור ועוד לא הסתכלו בו
    renderPaneMeta(p);
    bus.emit('agent-change', { pane: p, prev, prevSince, state: m.state }); // attention.js: התראות שולחן עבודה
  });
  onMessage('startup', (m) => {
    const p = state.panes.get(m.id);
    if (!p) return;
    p.meta.startup = false;
    p.dirty = false; p.waiting = false; // הפלט של ההפעלה עצמה אינו "פלט שלא ראיתי"
    p.tileSig = ''; // האריח מצייר מחדש את שתי שורות הפלט במקום "מכין..."
    renderPaneMeta(p);
    // 12 שניות בלי סימן חיים: השכבה יורדת (כדי שלא נסתיר משהו שצריך לראות) ובכותרת רמז שקט
    if (m.why === 'timeout') {
      const hint = $('.pstatus', p.el);
      hint.hidden = false;
      hint.className = 'pstatus k-idle';
      hint.textContent = 'הטעינה לוקחת יותר מהרגיל';
      setTimeout(() => { if (hint.textContent === 'הטעינה לוקחת יותר מהרגיל') { hint.textContent = ''; hint.hidden = true; } }, 10000);
    }
  });
  onMessage('cleared', (m) => { const p = state.panes.get(m.id); if (p) { dropQueued(p); p.term.clear(); } });
  onMessage('closed', (m) => removePane(m.id));

  // מיקוד עבר לפאן: מה שהצטבר בו כרגע (תור הרקע) נכתב מיד
  bus.on('focus', () => { const p = state.panes.get(state.focusId); if (p && p.outQueue) flushWrite(p); });

  // ההגדלה השתנתה: מציירים מחדש את הכותרות (אייקון הגדלה/כיווץ)
  bus.on('expanded', () => { for (const q of state.panes.values()) renderPaneMeta(q); });

  initPaneActions();
}

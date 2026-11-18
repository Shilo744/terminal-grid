/* ---------- תפריט צד: שיחות חדשות וישנות, לפי תיקיית פרויקט ---------- */
// כמו ב-Claude Code: כל השיחות השמורות במחשב מקובצות לפי התיקייה שבה הן נפתחו. לחיצה על שיחה פותחת אותה
// כאן עם claude --resume, ו"+" ליד תיקייה פותח שיחה חדשה בה.
import { state, bus, tabOf } from './state.js';
import { tabName } from './tabs.js';
import { store } from './store.js';
import { pickFolder } from './pick-folder.js';
import { getSetting, setSetting, onSetting } from './settings.js';
import { $ } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { onMessage, send } from './connection.js';
import { activate } from './layout.js';
import { relTime } from './util.js';
import { openClaude, setCwd, getCwd } from './launch.js';

const sideEl = $('#side');
const sideBtn = $('#sideBtn');
const sideList = $('#sideList');
const sideQ = $('#sideQ');
import { overlayRename, isRenameKey, isRenaming, afterRename } from './rename.js';
import { openMenu } from './menu.js';
// מפתח הפרויקט כמו בשרת (server.js projectKey): נתיב בלי הבדל אותיות וסוגי לוכסנים
const projectKey = (p) => String(p || '').replace(/[\\/]+/g, '\\').replace(/\\$/, '').toLowerCase();
state.projectNames = state.projectNames || {};
const side = { open: false, projects: [], loaded: false, busy: false, again: false, timer: null, refreshTimer: null, collapsed: store.get('sideCollapsed', {}) };

function openSession(p, s) {
  if (s.open && state.panes.has(s.open)) { activate(s.open); return; }
  // בשתי השניות הראשונות עוד לא ידוע אילו שיחות כבר רצות בחלון אחר; פותחים אחת כזו פעמיים ושוברים אותה
  if (!side.liveReady) { toast('בודק אילו שיחות כבר פתוחות…'); return; }
  if (s.live) { toast('השיחה רצה בחלון אחר. אפשר להביא אותה דרך "ייבוא סוכנים"'); return; }
  if (!p.exists || !p.cwd) { toast('התיקייה של השיחה לא קיימת יותר', 'error'); return; }
  openClaude(p.cwd, s.id);
}

function renderSide() {
  if (isRenaming()) { afterRename(renderSide); return; } // T71
  const q = sideQ.value.trim().toLowerCase();
  const keep = sideList.scrollTop;
  const frag = document.createDocumentFragment();
  side.projects.forEach((p, i) => {
    const key = (p.cwd || p.name).toLowerCase();
    let list = p.sessions;
    if (q) {
      const byFolder = p.name.toLowerCase().includes(q) || (p.cwd || '').toLowerCase().includes(q) || String(state.projectNames[projectKey(p.cwd)] || '').toLowerCase().includes(q);
      if (!byFolder) list = list.filter((s) => s.title.toLowerCase().includes(q));
      if (!list.length) return;
    }
    const hasOpen = p.sessions.some((s) => s.open);
    // ברירת מחדל: הפרויקטים האחרונים ואלה שיש בהם שיחה פתוחה פתוחים, השאר מכווצים. מה שבחרת נשמר.
    const collapsed = q ? false : (key in side.collapsed ? side.collapsed[key] : !(i < 3 || hasOpen));

    const g = document.createElement('div');
    g.className = 'grp' + (collapsed ? ' collapsed' : '') + (p.exists ? '' : ' missing');
    const row = document.createElement('div');
    row.className = 'grp-row';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'grp-head';
    head.setAttribute('aria-expanded', String(!collapsed));
    head.innerHTML = `<span class="grp-chev">${icon('chevron', 14)}</span><span class="grp-ic">${icon('folder', 15)}</span><span class="grp-name" dir="auto"></span><span class="grp-count"></span>`;
    const custom = p.cwd ? state.projectNames[projectKey(p.cwd)] : '';
    $('.grp-name', head).textContent = custom || p.name;
    $('.grp-count', head).textContent = String(p.sessions.length);
    head.title = (custom ? `${custom}\n` : '') + (p.cwd || p.name) + (p.cwd ? '\nלחיצה כפולה או F2: שינוי שם' : '');
    // שינוי שם של הפרויקט (T56): נשמר בשרת לפי הנתיב; שם התיקייה האמיתי נשאר ב-tooltip ובשורת הנתיב. שם שווה לשם התיקייה = חזרה לברירת המחדל
    const liveName = () => document.querySelector(`.grp-head[data-cwd="${CSS.escape(p.cwd || '')}"] .grp-name`);
    if (p.cwd) {
      const nm = $('.grp-name', head);
      head.dataset.cwd = p.cwd;
      const rename = () => overlayRename(nm, { find: liveName, value: custom || p.name, onCommit: (name) => send({ t: 'projectName', path: p.cwd, name: name === p.name ? '' : name }) });
      head.addEventListener('dblclick', (e) => { e.preventDefault(); rename(); });
      head.addEventListener('keydown', (e) => { if (isRenameKey(e)) { e.preventDefault(); rename(); } });
    }
    head.addEventListener('click', () => {
      side.collapsed[key] = !collapsed;
      store.set('sideCollapsed', side.collapsed);
      renderSide();
    });
    row.appendChild(head);
    // קליק ימני על פרויקט (T57): רק פעולות קיימות
    if (p.cwd) row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMenu({ point: { x: e.clientX, y: e.clientY }, label: `פעולות על ${custom || p.name}`, items: [
        { id: 'rename', label: 'שינוי שם', run: () => overlayRename($('.grp-name', head), { find: liveName, value: custom || p.name, onCommit: (name) => send({ t: 'projectName', path: p.cwd, name: name === p.name ? '' : name }) }) },
        { id: 'new', label: 'שיחה חדשה בתיקייה הזאת', run: () => openClaude(p.cwd) },
        { id: 'copy-path', label: 'העתקת נתיב התיקייה', run: () => navigator.clipboard.writeText(p.cwd).then(() => toast('הועתק'), () => toast('אין הרשאה לכתוב ללוח', 'error')) },
      ] });
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'grp-add';
    add.title = 'שיחה חדשה בתיקייה הזאת';
    add.setAttribute('aria-label', 'שיחה חדשה בתיקייה הזאת');
    add.innerHTML = icon('plus', 15);
    add.addEventListener('click', () => openClaude(p.cwd));
    row.appendChild(add);
    g.appendChild(row);

    const path = document.createElement('div');
    path.className = 'grp-path';
    path.textContent = p.parent || '';
    path.title = p.cwd || '';
    g.appendChild(path);

    const body = document.createElement('div');
    body.className = 'grp-body';
    for (const s of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ses' + (s.open ? ' open' : '') + (s.live ? ' live' : '');
      b.innerHTML = '<span class="ses-dot"></span><span class="ses-title" dir="auto"></span><span class="ses-time"></span>';
      $('.ses-title', b).textContent = s.title;
      // שיחה פתוחה: באיזו לשונית רשת היא נמצאת (רק כשיש כמה לשוניות), והלחיצה עליה עוברת אליה (activate)
      const tab = s.open && state.tabs.length > 1 ? tabOf(s.open) : null;
      $('.ses-time', b).textContent = s.open ? (tab ? `פתוחה · ${tabName(tab)}` : 'פתוחה') : (s.live ? 'רצה בחוץ' : relTime(s.last));
      b.title = s.title;
      b.addEventListener('click', () => openSession(p, s));
      body.appendChild(b);
    }
    g.appendChild(body);
    frag.appendChild(g);
  });
  sideList.replaceChildren(frag);
  if (!sideList.children.length) {
    const e = document.createElement('div');
    e.className = 'side-empty';
    e.textContent = q ? 'לא נמצא' : (side.loaded ? 'אין שיחות שמורות' : 'טוען…');
    sideList.appendChild(e);
  }
  sideList.scrollTop = keep;
}

async function loadHistory() {
  if (side.busy) { side.again = true; return; }
  side.busy = true;
  try {
    const j = await (await fetch('/api/history', { method: 'POST' })).json();
    side.projects = j.projects || [];
    side.liveReady = !!j.liveReady;
    sideEl.dataset.liveReady = String(side.liveReady); // סימון לבדיקות: הבדיקה "רצה בחוץ" הסתיימה
    side.loaded = true;
    renderSide();
    if ((!j.liveReady || j.partial) && side.open) setTimeout(loadHistory, 2200); // עוד לא סיימו: הבדיקה "רצה בחוץ" או הסריקה הראשונה של ההיסטוריה
  } catch {
    if (!side.loaded) { side.loaded = true; renderSide(); toast('לא ניתן לטעון את השיחות', 'error'); }
  } finally {
    side.busy = false;
    if (side.again) { side.again = false; loadHistory(); }
  }
}

// טרמינל נפתח/נסגר: מעדכנים את הסימון "פתוחה" (אחרי רגע, כדי לא לטעון שוב על כל הודעה)
function refreshSide() {
  if (!side.open) return;
  clearTimeout(side.refreshTimer);
  side.refreshTimer = setTimeout(loadHistory, 400);
}

function setSide(open) {
  if (side.open === open && !sideEl.hidden === open) return;
  side.open = open;
  sideEl.hidden = !open;
  sideBtn.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('side-open', open);
  setSetting('ui.sideOpen', open);
  clearInterval(side.timer);
  if (open) { renderSide(); loadHistory(); side.timer = setInterval(loadHistory, 20000); }
}

// התפריט נפתח מחדש אם הוא היה פתוח בפעם הקודמת (נקראת פעם אחת מ-main.js)
export function restoreSide() {
  if (getSetting('ui.sideOpen')) setSide(true);
}

export function initSidebar() {
  sideBtn.addEventListener('click', () => setSide(!side.open));
  onSetting('ui.sideOpen', (open) => setSide(open)); // נפתח/נסגר בחלון אחר
  sideQ.addEventListener('input', renderSide);
  bus.on('tabs', () => { if (side.open) renderSide(); }); // טרמינל עבר לשונית, או שם לשונית השתנה

  $('#sideNew').addEventListener('click', async () => {
    const btn = $('#sideNew');
    btn.disabled = true;
    try {
      const picked = await pickFolder(getCwd());
      if (picked) { setCwd(picked); openClaude(picked); }
    } catch {
      toast('לא ניתן לפתוח את בורר התיקיות', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // רשימה, פתיחה וסגירה של טרמינלים משנים את הסימון "פתוחה" (אחרי ש-panes טיפל בהודעה)
  onMessage('list', (m) => { state.projectNames = m.projectNames || {}; renderSide(); refreshSide(); });
  onMessage('projectNames', (m) => { state.projectNames = m.names || {}; renderSide(); });
  onMessage('created', refreshSide);
  onMessage('closed', refreshSide);
}
